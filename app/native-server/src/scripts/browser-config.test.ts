jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}));

import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { BrowserType, detectInstalledBrowsers, resolveBrowserExecutable } from './browser-config';

function withMockedPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return run();
  } finally {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  }
}

describe('browser-config executable resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('prefers Windows App Paths registry values when available', () => {
    (execFileSync as jest.Mock).mockImplementation((_command: string, args: string[]) => {
      const key = String(args[1] || '');
      if (key.includes('chrome.exe')) {
        return '\n(Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n';
      }
      throw new Error('not found');
    });
    (fs.existsSync as jest.Mock).mockImplementation((candidate: fs.PathLike) =>
      String(candidate).includes('Google\\Chrome\\Application\\chrome.exe'),
    );

    const resolved = withMockedPlatform('win32', () =>
      resolveBrowserExecutable(BrowserType.CHROME),
    );

    expect(resolved).toMatchObject({
      type: BrowserType.CHROME,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      source: 'app-path',
    });
  });

  it('only reports browsers that have a usable executable path', () => {
    (execFileSync as jest.Mock).mockImplementation((_command: string, args: string[]) => {
      const key = String(args[1] || '');
      if (key.includes('chrome.exe')) {
        return '\n(Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\n';
      }
      throw new Error('not found');
    });
    (fs.existsSync as jest.Mock).mockImplementation((candidate: fs.PathLike) =>
      String(candidate).includes('Google\\Chrome\\Application\\chrome.exe'),
    );

    const detected = withMockedPlatform('win32', () => detectInstalledBrowsers());

    expect(detected).toEqual([BrowserType.CHROME]);
  });
});
