/**
 * V27-03 — extension-side test for the action-outcome observer
 * SINGLETON SEAM. The full producer is exercised in
 * the extension observer tests; this file pins the
 * minimal contract that browser tools (e.g. `chrome_click_element`)
 * rely on:
 *
 *   - `armActionOutcome()` returns a no-op handle when no observer is
 *     wired (silent degrade — must not throw, must not emit).
 *   - After `setActionOutcomeObserverHandle(handle)`, calling
 *     `armActionOutcome()` arms a real observation that emits an
 *     `ActionOutcomeEventEnvelope` over the bridge.
 *   - `pushSignal()` from the tool path is folded into the timeline.
 *   - Errors thrown by `observe()` degrade to a no-op handle (caller
 *     never sees them).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetActionOutcomeObserverHandleForTests,
  armActionOutcome,
  setActionOutcomeObserverHandle,
} from '@/entrypoints/background/observers/action-outcome-singleton';
import {
  attachActionOutcomeObserver,
  type ActionOutcomeObserverContext,
} from '@/entrypoints/background/observers/action-outcome';
import type { BridgeObservationMessage } from '@tabrix/shared';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  __resetActionOutcomeObserverHandleForTests();
});

afterEach(() => {
  vi.useRealTimers();
  __resetActionOutcomeObserverHandleForTests();
});

describe('action-outcome-singleton', () => {
  it('returns a no-op handle when no observer is wired', () => {
    const handle = armActionOutcome({
      actionId: 'a-1',
      actionKind: 'click',
      tabId: 1,
      urlPattern: 'example.com/x',
    });
    expect(typeof handle.pushSignal).toBe('function');
    expect(typeof handle.flush).toBe('function');
    expect(typeof handle.dispose).toBe('function');
    // None of these should throw.
    handle.pushSignal({ kind: 'dom_region_changed' });
    handle.flush();
    handle.dispose();
  });

  it('arms a real observation and emits an action_outcome envelope', () => {
    const sent: BridgeObservationMessage[] = [];
    // Stub chrome event hooks the observer binds to (mirrors the
    // observer test). The full vitest setup already provides the chrome
    // global; we just neutralise addListener so binding does not throw.
    const wn = (globalThis as any).chrome.webNavigation;
    wn.onCommitted.addListener = vi.fn();
    wn.onCommitted.removeListener = vi.fn();
    const tabs = (globalThis as any).chrome.tabs;
    tabs.onCreated.addListener = vi.fn();
    tabs.onCreated.removeListener = vi.fn();
    const wr = (globalThis as any).chrome.webRequest;
    wr.onCompleted.addListener = vi.fn();
    wr.onCompleted.removeListener = vi.fn();

    const context: ActionOutcomeObserverContext = {
      send: (msg) => {
        sent.push(msg);
      },
      getConnectionId: () => 'conn-test',
      getExtensionId: () => 'ext-test',
      now: () => Date.now(),
    };
    const observer = attachActionOutcomeObserver(context);
    setActionOutcomeObserverHandle(observer);

    const handle = armActionOutcome({
      actionId: 'click-tab-7-12345',
      actionKind: 'click',
      tabId: 7,
      urlPattern: 'example.com/list',
    });
    handle.pushSignal({ kind: 'dom_region_changed' });
    handle.flush();

    expect(sent).toHaveLength(1);
    const msg = sent[0];
    expect(msg.type).toBe('observation');
    expect(msg.kind).toBe('action_outcome');
    if (msg.payload.kind !== 'action_outcome') throw new Error('payload kind');
    const env = msg.payload.data;
    expect(env.actionId).toBe('click-tab-7-12345');
    expect(env.actionKind).toBe('click');
    expect(env.tabId).toBe(7);
    expect(env.urlPattern).toBe('example.com/list');
    expect(env.signals.map((s) => s.kind)).toEqual(['dom_region_changed']);

    observer.detach();
  });

  it('returns a no-op handle when observe() throws', () => {
    setActionOutcomeObserverHandle({
      observe: () => {
        throw new Error('boom');
      },
      detach: () => undefined,
    });
    const handle = armActionOutcome({
      actionId: 'b-1',
      actionKind: 'click',
      tabId: 2,
      urlPattern: null,
    });
    // No throw, no observable side effect.
    handle.pushSignal({ kind: 'dom_region_changed' });
    handle.flush();
    handle.dispose();
  });
});
