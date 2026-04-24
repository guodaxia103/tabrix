// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeListener = (
  request: Record<string, unknown>,
  sender: unknown,
  sendResponse: (payload: unknown) => void,
) => boolean | void;

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

function installInjectedHelper(sourcePath: string, initializedKey: string): RuntimeListener {
  let listener: RuntimeListener | null = null;
  delete (window as Window & Record<string, unknown>)[initializedKey];

  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((entry: RuntimeListener) => {
    listener = entry;
  }) as typeof runtime.onMessage.addListener;

  window.eval(readFileSync(resolve(process.cwd(), sourcePath), 'utf8'));
  if (!listener) throw new Error(`${sourcePath} listener did not register`);
  return listener;
}

async function sendRequest(listener: RuntimeListener, request: Record<string, unknown>) {
  return await new Promise<any>((resolve) => {
    listener(request, {}, resolve);
  });
}

describe('injected state-driven waits', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = vi.fn(() => null);
  });

  it('fill scroll readiness returns before the 150ms cap when the element is already stable', async () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    const input = document.getElementById('name') as HTMLInputElement;
    setRect(input, { left: 20, top: 30, width: 180, height: 28 });
    document.elementFromPoint = vi.fn(() => input);

    const listener = installInjectedHelper(
      'inject-scripts/fill-helper.js',
      '__FILL_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'fillElement',
      selector: '#name',
      value: 'Tabrix',
    });

    expect(response.success).toBe(true);
    expect(response.elementInfo.waitDiagnostics.scroll.reason).toBe('ready');
    expect(response.elementInfo.waitDiagnostics.scroll.waitedMs).toBeLessThan(150);
  });

  it('keyboard focus readiness returns immediately once focus is observable', async () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    const input = document.getElementById('name') as HTMLInputElement;
    setRect(input, { left: 20, top: 30, width: 180, height: 28 });

    const listener = installInjectedHelper(
      'inject-scripts/keyboard-helper.js',
      '__KEYBOARD_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'simulateKeyboard',
      selector: '#name',
      keys: '',
      delay: 0,
    });

    expect(response.success).toBe(true);
    expect(response.targetElement.waitDiagnostics.focus.ready).toBe(true);
    expect(response.targetElement.waitDiagnostics.focus.waitedMs).toBeLessThan(100);
  });
});
