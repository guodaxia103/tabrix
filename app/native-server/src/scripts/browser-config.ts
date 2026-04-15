import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { HOST_NAME } from './constant';

export enum BrowserType {
  CHROME = 'chrome',
  CHROMIUM = 'chromium',
}

export interface BrowserConfig {
  type: BrowserType;
  displayName: string;
  userManifestPath: string;
  systemManifestPath: string;
  registryKey?: string; // Windows only
  systemRegistryKey?: string; // Windows only
}

export interface BrowserExecutableResolution {
  type: BrowserType;
  displayName: string;
  executablePath: string;
  source: 'app-path' | 'install-dir' | 'path' | 'mac-app' | 'linux-which';
}

/**
 * Get the user-level manifest path for a specific browser
 */
function getUserManifestPathForBrowser(browser: BrowserType): string {
  const platform = os.platform();

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    switch (browser) {
      case BrowserType.CHROME:
        return path.join(appData, 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
      case BrowserType.CHROMIUM:
        return path.join(appData, 'Chromium', 'NativeMessagingHosts', `${HOST_NAME}.json`);
      default:
        return path.join(appData, 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
    }
  } else if (platform === 'darwin') {
    const home = os.homedir();
    switch (browser) {
      case BrowserType.CHROME:
        return path.join(
          home,
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      case BrowserType.CHROMIUM:
        return path.join(
          home,
          'Library',
          'Application Support',
          'Chromium',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          home,
          'Library',
          'Application Support',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else {
    // Linux
    const home = os.homedir();
    switch (browser) {
      case BrowserType.CHROME:
        return path.join(
          home,
          '.config',
          'google-chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      case BrowserType.CHROMIUM:
        return path.join(home, '.config', 'chromium', 'NativeMessagingHosts', `${HOST_NAME}.json`);
      default:
        return path.join(
          home,
          '.config',
          'google-chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  }
}

/**
 * Get the system-level manifest path for a specific browser
 */
function getSystemManifestPathForBrowser(browser: BrowserType): string {
  const platform = os.platform();

  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    switch (browser) {
      case BrowserType.CHROME:
        return path.join(
          programFiles,
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      case BrowserType.CHROMIUM:
        return path.join(programFiles, 'Chromium', 'NativeMessagingHosts', `${HOST_NAME}.json`);
      default:
        return path.join(
          programFiles,
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else if (platform === 'darwin') {
    switch (browser) {
      case BrowserType.CHROME:
        return path.join(
          '/Library',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      case BrowserType.CHROMIUM:
        return path.join(
          '/Library',
          'Application Support',
          'Chromium',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
      default:
        return path.join(
          '/Library',
          'Google',
          'Chrome',
          'NativeMessagingHosts',
          `${HOST_NAME}.json`,
        );
    }
  } else {
    // Linux
    switch (browser) {
      case BrowserType.CHROME:
        return path.join('/etc', 'opt', 'chrome', 'native-messaging-hosts', `${HOST_NAME}.json`);
      case BrowserType.CHROMIUM:
        return path.join('/etc', 'chromium', 'native-messaging-hosts', `${HOST_NAME}.json`);
      default:
        return path.join('/etc', 'opt', 'chrome', 'native-messaging-hosts', `${HOST_NAME}.json`);
    }
  }
}

/**
 * Get Windows registry keys for a browser
 */
function getRegistryKeys(browser: BrowserType): { user: string; system: string } | undefined {
  if (os.platform() !== 'win32') return undefined;

  const browserPaths: Record<BrowserType, { user: string; system: string }> = {
    [BrowserType.CHROME]: {
      user: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      system: `HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    },
    [BrowserType.CHROMIUM]: {
      user: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
      system: `HKLM\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
    },
  };

  return browserPaths[browser];
}

/**
 * Get browser configuration
 */
export function getBrowserConfig(browser: BrowserType): BrowserConfig {
  const registryKeys = getRegistryKeys(browser);

  return {
    type: browser,
    displayName: browser.charAt(0).toUpperCase() + browser.slice(1),
    userManifestPath: getUserManifestPathForBrowser(browser),
    systemManifestPath: getSystemManifestPathForBrowser(browser),
    registryKey: registryKeys?.user,
    systemRegistryKey: registryKeys?.system,
  };
}

function tryExecFile(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2500,
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function parseRegistryDefaultValue(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/\bREG_(?:SZ|EXPAND_SZ)\b\s+(.*)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function expandWindowsEnvVars(raw: string): string {
  return raw.replace(/%([^%]+)%/g, (_match, key: string) => {
    return (
      process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()] ?? _match
    );
  });
}

function getWindowsAppPathCandidates(browser: BrowserType): string[] {
  const exeName = browser === BrowserType.CHROMIUM ? 'chromium.exe' : 'chrome.exe';
  const keys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
  ];

  const results: string[] = [];
  for (const key of keys) {
    const output = tryExecFile('reg', ['query', key, '/ve']);
    if (!output) continue;
    const parsed = parseRegistryDefaultValue(output);
    if (!parsed) continue;
    const expanded = expandWindowsEnvVars(parsed.replace(/^"(.*)"$/, '$1'));
    results.push(expanded);
  }
  return results;
}

function getWindowsInstallDirCandidates(browser: BrowserType): string[] {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  if (browser === BrowserType.CHROMIUM) {
    return [
      path.join(programFiles, 'Chromium', 'Application', 'chromium.exe'),
      path.join(programFilesX86, 'Chromium', 'Application', 'chromium.exe'),
      path.join(localAppData, 'Chromium', 'Application', 'chromium.exe'),
    ];
  }

  return [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
}

function uniquePaths(candidates: string[]): string[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = path.normalize(candidate).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveBrowserExecutable(browser: BrowserType): BrowserExecutableResolution | null {
  const config = getBrowserConfig(browser);

  if (os.platform() === 'win32') {
    for (const executablePath of uniquePaths(getWindowsAppPathCandidates(browser))) {
      if (fs.existsSync(executablePath)) {
        return {
          type: browser,
          displayName: config.displayName,
          executablePath,
          source: 'app-path',
        };
      }
    }
    for (const executablePath of uniquePaths(getWindowsInstallDirCandidates(browser))) {
      if (fs.existsSync(executablePath)) {
        return {
          type: browser,
          displayName: config.displayName,
          executablePath,
          source: 'install-dir',
        };
      }
    }
    const exeName = browser === BrowserType.CHROMIUM ? 'chromium.exe' : 'chrome.exe';
    const fromPath = tryExecFile('where', [exeName]);
    if (fromPath) {
      const executablePath = fromPath
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim();
      if (executablePath) {
        return {
          type: browser,
          displayName: config.displayName,
          executablePath,
          source: 'path',
        };
      }
    }
    return null;
  }

  if (os.platform() === 'darwin') {
    const executablePath =
      browser === BrowserType.CHROMIUM
        ? '/Applications/Chromium.app/Contents/MacOS/Chromium'
        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(executablePath)) {
      return {
        type: browser,
        displayName: config.displayName,
        executablePath,
        source: 'mac-app',
      };
    }
    return null;
  }

  const commands =
    browser === BrowserType.CHROMIUM
      ? ['chromium', 'chromium-browser']
      : ['google-chrome', 'google-chrome-stable'];
  for (const command of commands) {
    const executablePath = tryExecFile('which', [command]);
    if (executablePath) {
      return {
        type: browser,
        displayName: config.displayName,
        executablePath: executablePath.split(/\r?\n/)[0].trim(),
        source: 'linux-which',
      };
    }
  }
  return null;
}

export function resolvePreferredBrowserExecutable(
  targetBrowsers?: BrowserType[],
): BrowserExecutableResolution | null {
  const preferredOrder =
    targetBrowsers && targetBrowsers.length > 0
      ? targetBrowsers
      : [BrowserType.CHROME, BrowserType.CHROMIUM];

  for (const browser of preferredOrder) {
    const resolved = resolveBrowserExecutable(browser);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * Detect installed browsers on the system
 */
export function detectInstalledBrowsers(): BrowserType[] {
  return [BrowserType.CHROME, BrowserType.CHROMIUM].filter(
    (browser) => resolveBrowserExecutable(browser) !== null,
  );
}

/**
 * Get all supported browser configs
 */
export function getAllBrowserConfigs(): BrowserConfig[] {
  return Object.values(BrowserType).map((browser) => getBrowserConfig(browser));
}

/**
 * Parse browser type from string
 */
export function parseBrowserType(browserStr: string): BrowserType | undefined {
  const normalized = browserStr.toLowerCase();
  return Object.values(BrowserType).find((type) => type === normalized);
}
