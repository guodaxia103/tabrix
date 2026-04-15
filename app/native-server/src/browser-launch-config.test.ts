import fs from 'fs';
import os from 'os';
import path from 'path';

describe('browser-launch-config', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('persists resolved browser executable into ~/.tabrix/browser.json', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-browser-config-'));

    jest.doMock('os', () => ({
      ...jest.requireActual('os'),
      homedir: () => tempHome,
    }));
    jest.doMock('./scripts/browser-config', () => ({
      BrowserType: { CHROME: 'chrome', CHROMIUM: 'chromium' },
      resolvePreferredBrowserExecutable: jest.fn(() => ({
        type: 'chrome',
        displayName: 'Chrome',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        source: 'app-path',
      })),
    }));

    jest.isolateModules(() => {
      const mod = require('./browser-launch-config') as typeof import('./browser-launch-config');
      const persisted = mod.resolveAndPersistBrowserLaunchConfig();
      const savedPath = mod.getBrowserLaunchConfigPath();

      expect(persisted).toMatchObject({
        preferredBrowser: 'chrome',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        source: 'app-path',
      });
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(savedPath, 'utf8'))).toMatchObject({
        preferredBrowser: 'chrome',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      });
    });
  });
});
