import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  type BrowserExecutableResolution,
  type BrowserType,
  resolvePreferredBrowserExecutable,
} from './scripts/browser-config';

const CONFIG_DIR = path.join(os.homedir(), '.tabrix');
const CONFIG_FILE = path.join(CONFIG_DIR, 'browser.json');

export interface PersistedBrowserLaunchConfig {
  preferredBrowser: BrowserType;
  executablePath: string;
  source: BrowserExecutableResolution['source'];
  detectedAt: string;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function isUsableExecutablePath(executablePath: string | undefined): executablePath is string {
  if (!executablePath) return false;
  if (!path.isAbsolute(executablePath)) return true;
  return fs.existsSync(executablePath);
}

export function getBrowserLaunchConfigPath(): string {
  return CONFIG_FILE;
}

export function readPersistedBrowserLaunchConfig(): PersistedBrowserLaunchConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedBrowserLaunchConfig;
    if (!parsed?.preferredBrowser || !isUsableExecutablePath(parsed.executablePath)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedBrowserLaunchConfig(
  resolution: BrowserExecutableResolution,
): PersistedBrowserLaunchConfig {
  ensureConfigDir();
  const config: PersistedBrowserLaunchConfig = {
    preferredBrowser: resolution.type,
    executablePath: resolution.executablePath,
    source: resolution.source,
    detectedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

export function resolveAndPersistBrowserLaunchConfig(
  targetBrowsers?: BrowserType[],
): PersistedBrowserLaunchConfig | null {
  const resolution = resolvePreferredBrowserExecutable(targetBrowsers);
  if (!resolution) return null;
  return writePersistedBrowserLaunchConfig(resolution);
}
