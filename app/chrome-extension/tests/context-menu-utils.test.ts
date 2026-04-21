import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureContextMenuItem,
  removeContextMenu,
} from '@/entrypoints/background/utils/context-menu';

describe('context-menu utils', () => {
  const createMock = vi.fn();
  const updateMock = vi.fn();
  const removeMock = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();

    Object.defineProperty(globalThis.chrome.runtime, 'lastError', {
      configurable: true,
      get: () => undefined,
    });

    createMock.mockImplementation((_props, callback) => callback?.());
    updateMock.mockImplementation((_id, _props, callback) => callback?.());
    removeMock.mockImplementation((_id, callback) => callback?.());

    (globalThis.chrome as unknown as { contextMenus: unknown }).contextMenus = {
      ...(globalThis.chrome.contextMenus || {}),
      create: createMock,
      update: updateMock,
      remove: removeMock,
      onClicked: globalThis.chrome.contextMenus.onClicked,
    };
  });

  it('updates an existing menu item when create reports duplicate id', async () => {
    createMock.mockImplementation((_props, callback) => {
      Object.defineProperty(globalThis.chrome.runtime, 'lastError', {
        configurable: true,
        get: () => ({ message: 'Cannot create item with duplicate id sample_menu_item' }),
      });
      callback?.();
      Object.defineProperty(globalThis.chrome.runtime, 'lastError', {
        configurable: true,
        get: () => undefined,
      });
    });

    await ensureContextMenuItem('sample_menu_item', {
      title: 'Toggle',
      contexts: ['all'],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      'sample_menu_item',
      { title: 'Toggle', contexts: ['all'] },
      expect.any(Function),
    );
  });

  it('ignores missing-item errors during remove', async () => {
    removeMock.mockImplementation((_id, callback) => {
      Object.defineProperty(globalThis.chrome.runtime, 'lastError', {
        configurable: true,
        get: () => ({ message: 'Cannot find menu item with id sample_menu_item' }),
      });
      callback?.();
      Object.defineProperty(globalThis.chrome.runtime, 'lastError', {
        configurable: true,
        get: () => undefined,
      });
    });

    await expect(removeContextMenu('sample_menu_item')).resolves.toBeUndefined();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});
