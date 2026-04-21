// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mergeClickSignals,
  observeNewTabUntil,
  type ClickPageSignals,
} from '@/entrypoints/background/tools/browser/interaction';

const clickHelperSource = readFileSync(
  resolve(process.cwd(), 'inject-scripts/click-helper.js'),
  'utf8',
);

type RuntimeListener = (
  request: Record<string, unknown>,
  sender: unknown,
  sendResponse: (payload: unknown) => void,
) => boolean | void;

let messageListener: RuntimeListener | null = null;
const OriginalMouseEvent = globalThis.MouseEvent;
const OriginalPointerEvent = (
  globalThis as typeof globalThis & { PointerEvent?: typeof MouseEvent }
).PointerEvent;

function installClickHelper() {
  messageListener = null;
  delete (window as Window & { __CLICK_HELPER_INITIALIZED__?: boolean })
    .__CLICK_HELPER_INITIALIZED__;
  (
    window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> }
  ).__claudeElementMap = {};

  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((listener: RuntimeListener) => {
    messageListener = listener;
  }) as typeof runtime.onMessage.addListener;

  window.eval(clickHelperSource);

  if (!messageListener) {
    throw new Error('click-helper listener did not register');
  }
}

function setRect(element: Element, rect: Partial<DOMRect> = {}) {
  const resolved = {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    width: rect.width ?? 100,
    height: rect.height ?? 32,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 32),
    toJSON: () => ({}),
  } satisfies DOMRect;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => resolved,
  });
}

async function sendClickRequest(request: Record<string, unknown>) {
  if (!messageListener) {
    throw new Error('click-helper listener is unavailable');
  }
  return await new Promise<any>((resolve) => {
    messageListener?.(request, {}, resolve);
  });
}

describe('mergeClickSignals (pure function)', () => {
  const zeroPage: ClickPageSignals = {
    beforeUnloadFired: false,
    urlBefore: 'https://example.com/a',
    urlAfter: 'https://example.com/a',
    hashBefore: '',
    hashAfter: '',
    domChanged: false,
    domAddedDialog: false,
    domAddedMenu: false,
    focusChanged: false,
    targetStateDelta: null,
  };

  it('forbidden combination: success=true with no_observed_change is unreachable', () => {
    const merged = mergeClickSignals(true, zeroPage, { newTabOpened: false });
    expect(merged.observedOutcome).toBe('no_observed_change');
    expect(merged.success).toBe(false);
    expect(merged.verification.navigationOccurred).toBe(false);
  });

  it('beforeunload → cross_document_navigation, success=true', () => {
    const merged = mergeClickSignals(
      true,
      { ...zeroPage, beforeUnloadFired: true },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('cross_document_navigation');
    expect(merged.success).toBe(true);
    expect(merged.verification.navigationOccurred).toBe(true);
  });

  it('new tab created during window → new_tab_opened, success=true', () => {
    const merged = mergeClickSignals(true, zeroPage, { newTabOpened: true });
    expect(merged.observedOutcome).toBe('new_tab_opened');
    expect(merged.success).toBe(true);
    expect(merged.verification.newTabOpened).toBe(true);
  });

  it('location.href path change (same host, no unload) → spa_route_change', () => {
    const merged = mergeClickSignals(
      true,
      {
        ...zeroPage,
        urlBefore: 'https://example.com/a',
        urlAfter: 'https://example.com/b',
      },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('spa_route_change');
    expect(merged.success).toBe(true);
    expect(merged.verification.urlChanged).toBe(true);
  });

  it('only hash changed → hash_change', () => {
    const merged = mergeClickSignals(
      true,
      {
        ...zeroPage,
        urlBefore: 'https://example.com/a',
        urlAfter: 'https://example.com/a#top',
        hashBefore: '',
        hashAfter: '#top',
      },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('hash_change');
    expect(merged.success).toBe(true);
  });

  it('dialog appeared in DOM → dialog_opened', () => {
    const merged = mergeClickSignals(
      true,
      { ...zeroPage, domChanged: true, domAddedDialog: true },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('dialog_opened');
    expect(merged.success).toBe(true);
  });

  it('menu appeared in DOM → menu_opened', () => {
    const merged = mergeClickSignals(
      true,
      { ...zeroPage, domChanged: true, domAddedMenu: true },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('menu_opened');
  });

  it('aria-expanded delta → state_toggled', () => {
    const merged = mergeClickSignals(
      true,
      {
        ...zeroPage,
        targetStateDelta: { ariaExpanded: { before: 'false', after: 'true' } },
      },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('state_toggled');
    expect(merged.success).toBe(true);
    expect(merged.verification.stateChanged).toBe(true);
  });

  it('dispatch failed → no_observed_change, success=false, verification all false', () => {
    const merged = mergeClickSignals(false, null, { newTabOpened: false });
    expect(merged.observedOutcome).toBe('no_observed_change');
    expect(merged.success).toBe(false);
    expect(merged.verification.navigationOccurred).toBe(false);
    expect(merged.verification.urlChanged).toBe(false);
    expect(merged.verification.domChanged).toBe(false);
  });

  it('dispatch ok but page signals missing → verification_unavailable, success=false', () => {
    const merged = mergeClickSignals(true, null, { newTabOpened: false });
    expect(merged.observedOutcome).toBe('verification_unavailable');
    expect(merged.success).toBe(false);
  });

  it('priority: newTab wins over beforeunload wins over state change', () => {
    const merged = mergeClickSignals(
      true,
      {
        ...zeroPage,
        beforeUnloadFired: true,
        targetStateDelta: { foo: { before: 'a', after: 'b' } },
      },
      { newTabOpened: true },
    );
    expect(merged.observedOutcome).toBe('new_tab_opened');
  });

  it('dom-only change (no state, no dialog, no nav) → dom_changed', () => {
    const merged = mergeClickSignals(
      true,
      { ...zeroPage, domChanged: true },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('dom_changed');
    expect(merged.success).toBe(true);
  });

  it('focus-only change → focus_changed', () => {
    const merged = mergeClickSignals(
      true,
      { ...zeroPage, focusChanged: true },
      { newTabOpened: false },
    );
    expect(merged.observedOutcome).toBe('focus_changed');
    expect(merged.success).toBe(true);
  });
});

describe('observeNewTabUntil', () => {
  let createdListeners: Array<(tab: chrome.tabs.Tab) => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    createdListeners = [];
    chrome.tabs.onCreated.addListener = vi.fn((listener: (tab: chrome.tabs.Tab) => void) => {
      createdListeners.push(listener);
    }) as any;
    chrome.tabs.onCreated.removeListener = vi.fn((listener: (tab: chrome.tabs.Tab) => void) => {
      createdListeners = createdListeners.filter((entry) => entry !== listener);
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the listener armed until the interaction promise settles, even past the old fixed window', async () => {
    let resolveInteraction!: () => void;
    const interactionPromise = new Promise<void>((resolve) => {
      resolveInteraction = resolve;
    });
    const observedPromise = observeNewTabUntil(7, interactionPromise, 50);

    await vi.advanceTimersByTimeAsync(500);
    expect(createdListeners).toHaveLength(1);

    createdListeners[0]!({ windowId: 7 } as chrome.tabs.Tab);
    resolveInteraction();
    await Promise.resolve();
    expect(createdListeners).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(50);
    await expect(observedPromise).resolves.toEqual({ newTabOpened: true });
    expect(createdListeners).toHaveLength(0);
  });

  it('captures a late onCreated event during the post-result drain window', async () => {
    const interactionPromise = Promise.resolve();
    const observedPromise = observeNewTabUntil(9, interactionPromise, 50);

    await Promise.resolve();
    expect(createdListeners).toHaveLength(1);

    createdListeners[0]!({ windowId: 9 } as chrome.tabs.Tab);

    await vi.advanceTimersByTimeAsync(50);
    await expect(observedPromise).resolves.toEqual({ newTabOpened: true });
    expect(createdListeners).toHaveLength(0);
  });

  it('ignores tabs created in a different window', async () => {
    const interactionPromise = Promise.resolve();
    const observedPromise = observeNewTabUntil(3, interactionPromise, 20);

    await Promise.resolve();
    expect(createdListeners).toHaveLength(1);

    createdListeners[0]!({ windowId: 4 } as chrome.tabs.Tab);

    await vi.advanceTimersByTimeAsync(20);
    await expect(observedPromise).resolves.toEqual({ newTabOpened: false });
  });
});

describe('click-helper signals (end-to-end through jsdom)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.elementFromPoint = vi.fn(() => null);
    Element.prototype.scrollIntoView = vi.fn();
    class TestMouseEvent extends Event {
      clientX: number;
      clientY: number;
      button: number;
      buttons: number;
      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type, {
          bubbles: init.bubbles !== false,
          cancelable: init.cancelable !== false,
        });
        this.clientX = Number(init.clientX || 0);
        this.clientY = Number(init.clientY || 0);
        this.button = Number(init.button || 0);
        this.buttons = Number(init.buttons || 0);
      }
    }
    (globalThis as typeof globalThis & { MouseEvent: typeof OriginalMouseEvent }).MouseEvent =
      TestMouseEvent as unknown as typeof OriginalMouseEvent;
    (globalThis as typeof globalThis & { PointerEvent: typeof TestMouseEvent }).PointerEvent =
      TestMouseEvent;
    installClickHelper();
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { MouseEvent: typeof OriginalMouseEvent }).MouseEvent =
      OriginalMouseEvent;
    (globalThis as typeof globalThis & { PointerEvent?: typeof MouseEvent }).PointerEvent =
      OriginalPointerEvent;
  });

  it('no-op click emits zero page-local signals (raw)', async () => {
    document.body.innerHTML = '<button id="btn">No-op</button>';
    const button = document.getElementById('btn') as HTMLButtonElement;
    setRect(button, { left: 20, top: 30, width: 120, height: 32 });
    document.elementFromPoint = vi.fn(() => button);

    const response = await sendClickRequest({
      action: 'clickElement',
      selector: '#btn',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(response.dispatchSucceeded).toBe(true);
    expect(response.signals.beforeUnloadFired).toBe(false);
    expect(response.signals.urlBefore).toBe(response.signals.urlAfter);
    expect(response.signals.targetStateDelta).toBeNull();

    const merged = mergeClickSignals(response.dispatchSucceeded, response.signals, {
      newTabOpened: false,
    });
    expect(merged.observedOutcome).toBe('no_observed_change');
    expect(merged.success).toBe(false);
  });

  it('aria-expanded toggle surfaces in targetStateDelta', async () => {
    document.body.innerHTML = '<button id="btn" aria-expanded="false">Toggle</button>';
    const button = document.getElementById('btn') as HTMLButtonElement;
    setRect(button, { left: 20, top: 30, width: 120, height: 32 });
    document.elementFromPoint = vi.fn(() => button);
    button.addEventListener('click', () => {
      button.setAttribute('aria-expanded', 'true');
    });

    const response = await sendClickRequest({
      action: 'clickElement',
      selector: '#btn',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(response.dispatchSucceeded).toBe(true);
    expect(response.signals.targetStateDelta).not.toBeNull();
    expect(response.signals.targetStateDelta.ariaExpanded).toEqual({
      before: 'false',
      after: 'true',
    });

    const merged = mergeClickSignals(response.dispatchSucceeded, response.signals, {
      newTabOpened: false,
    });
    expect(merged.observedOutcome).toBe('state_toggled');
    expect(merged.success).toBe(true);
  });

  it('dialog appearance surfaces via domAddedDialog', async () => {
    document.body.innerHTML = '<button id="btn">Open dialog</button>';
    const button = document.getElementById('btn') as HTMLButtonElement;
    setRect(button, { left: 20, top: 30, width: 120, height: 32 });
    document.elementFromPoint = vi.fn(() => button);
    button.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.id = 'dialog';
      dialog.textContent = 'hello';
      document.body.appendChild(dialog);
    });

    const response = await sendClickRequest({
      action: 'clickElement',
      selector: '#btn',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(response.signals.domChanged).toBe(true);
    expect(response.signals.domAddedDialog).toBe(true);

    const merged = mergeClickSignals(response.dispatchSucceeded, response.signals, {
      newTabOpened: false,
    });
    expect(merged.observedOutcome).toBe('dialog_opened');
    expect(merged.success).toBe(true);
  });
});
