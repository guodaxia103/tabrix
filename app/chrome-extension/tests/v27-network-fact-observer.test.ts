/**
 * V27-02 — Network Fact Observer (extension side) tests.
 *
 * Drives synthetic `chrome.webRequest.*` events and asserts the
 * observer:
 *   - filters non-XHR / fetch resource types,
 *   - drops events while the bridge connectionId is unset,
 *   - emits brand-neutral envelopes (host / pathPattern / queryKeys
 *     only — never raw URL, never headers, never bodies),
 *   - computes timingMs from the start/end pair when available,
 *   - never panics when an `onErrorOccurred` arrives without a matching
 *     `onCompleted`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachNetworkFactObserver,
  summariseUrl,
} from '@/entrypoints/background/observers/network-fact';
import type { BridgeObservationMessage } from '@tabrix/shared';

interface ListenerStore {
  onBeforeRequest: Array<(details: any) => void>;
  onCompleted: Array<(details: any) => void>;
  onErrorOccurred: Array<(details: any) => void>;
}

function installWebRequestStubs(): ListenerStore {
  const store: ListenerStore = {
    onBeforeRequest: [],
    onCompleted: [],
    onErrorOccurred: [],
  };
  const make = (bucket: ((details: any) => void)[]) => ({
    addListener: vi.fn((listener: (details: any) => void) => {
      bucket.push(listener);
    }),
    removeListener: vi.fn((listener: (details: any) => void) => {
      const idx = bucket.indexOf(listener);
      if (idx >= 0) bucket.splice(idx, 1);
    }),
  });
  (chrome as any).webRequest = {
    onBeforeRequest: make(store.onBeforeRequest),
    onCompleted: make(store.onCompleted),
    onErrorOccurred: make(store.onErrorOccurred),
  };
  return store;
}

describe('summariseUrl', () => {
  it('extracts host, path-only pattern, and sorted query keys', () => {
    const out = summariseUrl('https://Api.Example.com/api/v1/items?page=2&q=foo&page=3#frag');
    expect(out).not.toBeNull();
    expect(out!.host).toBe('api.example.com');
    expect(out!.pathPattern).toBe('/api/v1/items');
    // Sorted, deduplicated.
    expect(out!.queryKeys).toEqual(['page', 'q']);
    expect(out!.urlPattern).toBe('api.example.com/api/v1/items');
  });
  it('returns null for non-http schemes / malformed input', () => {
    expect(summariseUrl('chrome://extensions')).toBeNull();
    expect(summariseUrl('not a url')).toBeNull();
    expect(summariseUrl('')).toBeNull();
    expect(summariseUrl(null)).toBeNull();
  });
});

describe('attachNetworkFactObserver — synthetic flow', () => {
  let store: ListenerStore;
  let sent: BridgeObservationMessage[];

  beforeEach(() => {
    store = installWebRequestStubs();
    sent = [];
  });

  function attach(connectionId: string | null = 'conn-1') {
    return attachNetworkFactObserver({
      send: (msg) => {
        sent.push(msg);
      },
      getConnectionId: () => connectionId,
      getExtensionId: () => 'ext-test',
      getFactSnapshotId: (tabId) => `tab:${tabId}`,
      getSessionId: () => 'sess-1',
    });
  }

  it('drops events while connectionId is null', () => {
    attach(null);
    store.onCompleted[0]?.({
      requestId: 'r1',
      tabId: 7,
      url: 'https://e.com/api/x?q=1',
      method: 'GET',
      type: 'xmlhttprequest',
      statusCode: 200,
      timeStamp: 1100,
    });
    expect(sent).toHaveLength(0);
  });

  it('ignores main_frame and sub_frame requests', () => {
    attach();
    store.onCompleted[0]?.({
      requestId: 'r1',
      tabId: 7,
      url: 'https://e.com/page',
      method: 'GET',
      type: 'main_frame',
      statusCode: 200,
      timeStamp: 1100,
    });
    store.onCompleted[0]?.({
      requestId: 'r2',
      tabId: 7,
      url: 'https://e.com/iframe',
      method: 'GET',
      type: 'sub_frame',
      statusCode: 200,
      timeStamp: 1100,
    });
    expect(sent).toHaveLength(0);
  });

  it('emits a fact_snapshot for an XHR with timing computed from before+complete', () => {
    attach();
    store.onBeforeRequest[0]?.({
      requestId: 'r1',
      tabId: 7,
      url: 'https://api.e.com/items?page=2&q=foo',
      method: 'GET',
      type: 'xmlhttprequest',
      timeStamp: 1000,
    });
    store.onCompleted[0]?.({
      requestId: 'r1',
      tabId: 7,
      url: 'https://api.e.com/items?page=2&q=foo',
      method: 'GET',
      type: 'xmlhttprequest',
      statusCode: 200,
      timeStamp: 1042.7,
    });
    expect(sent).toHaveLength(1);
    const msg = sent[0];
    expect(msg.type).toBe('observation');
    expect(msg.kind).toBe('fact_snapshot');
    if (msg.payload.kind !== 'fact_snapshot') throw new Error('expected fact_snapshot payload');
    const env = msg.payload.data;
    expect(env.factSnapshotId).toBe('tab:7');
    expect(env.payload.eventKind).toBe('network_request');
    if (env.payload.eventKind !== 'network_request') throw new Error('eventKind');
    const fact = env.payload.fact;
    expect(fact.method).toBe('GET');
    expect(fact.host).toBe('api.e.com');
    expect(fact.pathPattern).toBe('/items');
    expect(fact.queryKeys).toEqual(['page', 'q']);
    expect(fact.status).toBe(200);
    expect(fact.timingMs).toBe(43);
    // Producer side does not include raw URL, headers, or bodies on
    // any field of the wire envelope. Spot-check a few exclusion
    // properties to keep the contract loud:
    expect((fact as any).url).toBeUndefined();
    expect((fact as any).body).toBeUndefined();
    expect((fact as any).requestHeaders).toBeUndefined();
  });

  it('falls back to timingMs:null when onBeforeRequest never fired', () => {
    attach();
    store.onCompleted[0]?.({
      requestId: 'r-late',
      tabId: 7,
      url: 'https://api.e.com/items',
      method: 'GET',
      type: 'fetch',
      statusCode: 200,
      timeStamp: 1100,
    });
    expect(sent).toHaveLength(1);
    if (sent[0].payload.kind !== 'fact_snapshot') throw new Error('payload');
    const env = sent[0].payload.data;
    if (env.payload.eventKind !== 'network_request') throw new Error('eventKind');
    expect(env.payload.fact.timingMs).toBeNull();
  });

  it('clears the in-flight start map on onErrorOccurred without crashing', () => {
    attach();
    store.onBeforeRequest[0]?.({
      requestId: 'r-err',
      tabId: 7,
      url: 'https://api.e.com/x',
      method: 'GET',
      type: 'fetch',
      timeStamp: 1000,
    });
    store.onErrorOccurred[0]?.({
      requestId: 'r-err',
      tabId: 7,
      url: 'https://api.e.com/x',
      method: 'GET',
      type: 'fetch',
      error: 'net::ERR_FAILED',
      timeStamp: 1010,
    });
    expect(sent).toHaveLength(0);
    // A subsequent successful request still emits without timing because
    // the prior start was cleared.
    store.onCompleted[0]?.({
      requestId: 'r-err',
      tabId: 7,
      url: 'https://api.e.com/x',
      method: 'GET',
      type: 'fetch',
      statusCode: 200,
      timeStamp: 1020,
    });
    expect(sent).toHaveLength(1);
  });

  it('detach() removes every chrome.webRequest listener it installed', () => {
    const handle = attach();
    expect(store.onBeforeRequest.length).toBe(1);
    expect(store.onCompleted.length).toBe(1);
    expect(store.onErrorOccurred.length).toBe(1);
    handle.detach();
    expect(store.onBeforeRequest.length).toBe(0);
    expect(store.onCompleted.length).toBe(0);
    expect(store.onErrorOccurred.length).toBe(0);
  });
});
