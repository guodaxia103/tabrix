#!/usr/bin/env node

/**
 * doctor.ts
 *
 * Diagnoses common installation and runtime issues for the Chrome Native Messaging host.
 * Provides checks for manifest files, Node.js path, permissions, and connectivity.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { EXTENSION_ID, HOST_NAME, COMMAND_NAME } from './constant';
import {
  BrowserType,
  detectInstalledBrowsers,
  getBrowserConfig,
  parseBrowserType,
  resolvePreferredBrowserExecutable,
} from './browser-config';
import {
  getBrowserLaunchConfigPath,
  readPersistedBrowserLaunchConfig,
  resolveAndPersistBrowserLaunchConfig,
} from '../browser-launch-config';
import {
  colorText,
  ensureExecutionPermissions,
  tryRegisterUserLevelHost,
  getLogDir,
  discoverLoadedExtensionOrigins,
} from './utils';
import { daemonStart, daemonStatus, daemonStop } from './daemon';
import { collectRuntimeConsistencySnapshot } from './runtime-consistency';
import {
  describeBridgeRecoveryGuidance,
  type BridgeRecoveryGuidance,
} from './bridge-recovery-guidance';
import {
  HTTP_STATUS,
  NATIVE_SERVER_PORT,
  SERVER_CONFIG,
  MCP_AUTH_TOKEN_ENV,
  MCP_HTTP_HOST_ENV,
} from '../constant';

const EXPECTED_PORT = 12306;
const SCHEMA_VERSION = 1;
const MIN_NODE_MAJOR_VERSION = 20;

// ============================================================================
// Types
// ============================================================================

export interface DoctorOptions {
  json?: boolean;
  fix?: boolean;
  browser?: string;
}

export type DoctorStatus = 'ok' | 'warn' | 'error';

export interface DoctorFixAttempt {
  id: string;
  description: string;
  success: boolean;
  error?: string;
}

export interface DoctorCheckResult {
  id: string;
  title: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  schemaVersion: number;
  timestamp: string;
  ok: boolean;
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
  environment: {
    platform: NodeJS.Platform;
    arch: string;
    node: {
      version: string;
      execPath: string;
    };
    package: {
      name: string;
      version: string;
      rootDir: string;
      distDir: string;
    };
    command: {
      canonical: string;
      aliases: string[];
    };
    nativeHost: {
      hostName: string;
      expectedPort: number;
    };
  };
  fixes: DoctorFixAttempt[];
  runtimeConsistency?: Awaited<ReturnType<typeof collectRuntimeConsistencySnapshot>>;
  checks: DoctorCheckResult[];
  nextSteps: string[];
}

interface NodeResolutionResult {
  nodePath?: string;
  source?: string;
  version?: string;
  versionError?: string;
  nodePathFile: {
    path: string;
    exists: boolean;
    value?: string;
    valid?: boolean;
    error?: string;
  };
}

interface SqliteBindingProbeResult {
  ok: boolean;
  packageDir?: string;
  version?: string;
  error?: string;
}

type DoctorBridgeGuidance = BridgeRecoveryGuidance;

// ============================================================================
// Utility Functions
// ============================================================================

function readPackageJson(): Record<string, unknown> {
  try {
    return require('../../package.json') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getCommandInfo(pkg: Record<string, unknown>): { canonical: string; aliases: string[] } {
  const bin = pkg.bin as Record<string, string> | undefined;
  if (!bin || typeof bin !== 'object') {
    return { canonical: COMMAND_NAME, aliases: [] };
  }

  const canonical = COMMAND_NAME;
  const canonicalTarget = bin[canonical];

  const aliases = canonicalTarget
    ? Object.keys(bin).filter((name) => name !== canonical && bin[name] === canonicalTarget)
    : [];

  return { canonical, aliases };
}

function resolveDistDir(): string {
  // __dirname is dist/scripts when running from compiled code
  const candidateFromDistScripts = path.resolve(__dirname, '..');
  const candidateFromSrcScripts = path.resolve(__dirname, '..', '..', 'dist');

  const looksLikeDist = (dir: string): boolean => {
    return (
      fs.existsSync(path.join(dir, 'mcp', 'stdio-config.json')) ||
      fs.existsSync(path.join(dir, 'run_host.sh')) ||
      fs.existsSync(path.join(dir, 'run_host.bat'))
    );
  };

  if (looksLikeDist(candidateFromDistScripts)) return candidateFromDistScripts;
  if (looksLikeDist(candidateFromSrcScripts)) return candidateFromSrcScripts;
  return candidateFromDistScripts;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function detectSqliteBindingIssue(message: string): boolean {
  const patterns = [
    'Could not locate the bindings file',
    'better_sqlite3.node',
    'NODE_MODULE_VERSION',
    'was compiled against a different Node.js version',
  ];
  return patterns.some((pattern) => message.includes(pattern));
}

function probeBetterSqliteBinding(distDir: string): SqliteBindingProbeResult {
  let packageDir: string | undefined;
  try {
    const packageJsonPath = require.resolve('better-sqlite3/package.json', {
      paths: [distDir, process.cwd()],
    });
    packageDir = path.dirname(packageJsonPath);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    const BetterSqlite3 = require('better-sqlite3') as new (filename: string) => {
      prepare: (sqlText: string) => { get: () => unknown };
      close: () => void;
    };
    const db = new BetterSqlite3(':memory:');
    try {
      db.prepare('SELECT 1').get();
    } finally {
      db.close();
    }
    return { ok: true, packageDir, version: packageJson.version };
  } catch (error) {
    return {
      ok: false,
      packageDir,
      error: stringifyError(error),
    };
  }
}

function canExecute(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeComparablePath(filePath: string): string {
  if (process.platform === 'win32') {
    return path.normalize(filePath).toLowerCase();
  }
  return path.normalize(filePath);
}

function stripOuterQuotes(input: string): string {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expandTilde(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function expandWindowsEnvVars(input: string): string {
  if (process.platform !== 'win32') return input;
  return input.replace(/%([^%]+)%/g, (_match, name: string) => {
    const key = String(name);
    return (
      process.env[key] ?? process.env[key.toUpperCase()] ?? process.env[key.toLowerCase()] ?? _match
    );
  });
}

function isWildcardHost(host: string | null | undefined): boolean {
  return host === '0.0.0.0' || host === '::';
}

function getSnapshotHost(snapshot: Record<string, unknown> | undefined): string | null {
  if (!snapshot) return null;
  return typeof snapshot.host === 'string' ? snapshot.host : null;
}

function getSnapshotNetworkAddresses(snapshot: Record<string, unknown> | undefined): string[] {
  if (!snapshot) return [];
  const raw = snapshot.networkAddresses;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function parseVersionFromDirName(dirName: string): number[] | null {
  const cleaned = dirName.trim().replace(/^v/, '');
  if (!/^\d+(\.\d+){0,3}$/.test(cleaned)) return null;
  return cleaned.split('.').map((part) => Number(part));
}

/**
 * Parse Node.js version string from `node -v` output.
 * Handles versions like: v20.10.0, v22.0.0-nightly.2024..., v21.0.0-rc.1
 * Returns major version number or null if parsing fails.
 */
function parseNodeMajorVersion(versionString: string): number | null {
  if (!versionString) return null;
  // Match pattern: v?MAJOR.MINOR.PATCH[-anything]
  const match = versionString.trim().match(/^v?(\d+)(?:\.\d+)*(?:[-+].*)?$/i);
  if (match?.[1]) {
    const major = Number(match[1]);
    return Number.isNaN(major) ? null : major;
  }
  return null;
}

function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export function describeBridgeStatusForDoctor(
  snapshot?: Record<string, unknown>,
): DoctorBridgeGuidance {
  const bridge =
    snapshot && typeof snapshot.bridge === 'object' && snapshot.bridge !== null
      ? (snapshot.bridge as Record<string, unknown>)
      : undefined;
  return describeBridgeRecoveryGuidance(
    {
      bridgeState: typeof bridge?.bridgeState === 'string' ? bridge.bridgeState : undefined,
      lastBridgeErrorCode:
        typeof bridge?.lastBridgeErrorCode === 'string' ? bridge.lastBridgeErrorCode : null,
      commandChannelConnected:
        typeof bridge?.commandChannelConnected === 'boolean'
          ? bridge.commandChannelConnected
          : false,
    },
    typeof bridge?.lastBridgeErrorCode === 'string' ? bridge.lastBridgeErrorCode : null,
  );
}

function pickLatestVersionDir(parentDir: string): string | null {
  if (!fs.existsSync(parentDir)) return null;
  const dirents = fs.readdirSync(parentDir, { withFileTypes: true });
  let best: { name: string; version: number[] } | null = null;

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const parsed = parseVersionFromDirName(dirent.name);
    if (!parsed) continue;
    if (!best || compareVersions(parsed, best.version) > 0) {
      best = { name: dirent.name, version: parsed };
    }
  }

  return best ? path.join(parentDir, best.name) : null;
}

function getSecurePreferencesPath(browser: BrowserType): string | null {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const baseDir =
      browser === BrowserType.CHROMIUM
        ? path.join(localAppData, 'Chromium', 'User Data')
        : path.join(localAppData, 'Google', 'Chrome', 'User Data');
    return path.join(baseDir, 'Default', 'Secure Preferences');
  }

  if (process.platform === 'darwin') {
    const baseDir =
      browser === BrowserType.CHROMIUM
        ? path.join(home, 'Library', 'Application Support', 'Chromium')
        : path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    return path.join(baseDir, 'Default', 'Secure Preferences');
  }

  const baseDir =
    browser === BrowserType.CHROMIUM
      ? path.join(home, '.config', 'chromium')
      : path.join(home, '.config', 'google-chrome');
  return path.join(baseDir, 'Default', 'Secure Preferences');
}

function readLoadedExtensionPath(browser: BrowserType): {
  securePreferencesPath: string;
  exists: boolean;
  loadedPath?: string;
  location?: number;
  state?: number;
  manifestVersion?: string;
  matchedExtensionId?: string;
  error?: string;
} {
  const securePreferencesPath = getSecurePreferencesPath(browser);
  if (!securePreferencesPath) {
    return {
      securePreferencesPath: '',
      exists: false,
      error: `Secure Preferences lookup is not supported on ${process.platform}`,
    };
  }

  if (!fs.existsSync(securePreferencesPath)) {
    return {
      securePreferencesPath,
      exists: false,
      error: 'Secure Preferences file not found',
    };
  }

  try {
    const raw = fs.readFileSync(securePreferencesPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const settings = (parsed.extensions as Record<string, unknown> | undefined)?.settings as
      | Record<string, unknown>
      | undefined;

    if (!settings) {
      return {
        securePreferencesPath,
        exists: true,
        error: 'No extension settings found in Secure Preferences',
      };
    }

    const discovered = discoverLoadedExtensionOrigins([browser]).detected.find(
      (entry) => entry.browser === browser,
    );
    const matchedExtensionId = discovered?.id || EXTENSION_ID;
    const extensionEntry = settings[matchedExtensionId] as Record<string, unknown> | undefined;

    if (!extensionEntry) {
      return {
        securePreferencesPath,
        exists: true,
        error: `Extension ${matchedExtensionId} is not present in Secure Preferences`,
      };
    }

    const manifest = extensionEntry.manifest as Record<string, unknown> | undefined;

    return {
      securePreferencesPath,
      exists: true,
      loadedPath: typeof extensionEntry.path === 'string' ? extensionEntry.path : undefined,
      location: typeof extensionEntry.location === 'number' ? extensionEntry.location : undefined,
      state: typeof extensionEntry.state === 'number' ? extensionEntry.state : undefined,
      manifestVersion: typeof manifest?.version === 'string' ? manifest.version : undefined,
      matchedExtensionId,
    };
  } catch (error) {
    return {
      securePreferencesPath,
      exists: true,
      error: stringifyError(error),
    };
  }
}

// ============================================================================
// Node Resolution (mirrors run_host.sh/bat logic)
// ============================================================================

function resolveNodeCandidate(distDir: string): NodeResolutionResult {
  const nodeFileName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodePathFilePath = path.join(distDir, 'node_path.txt');

  const nodePathFile: NodeResolutionResult['nodePathFile'] = {
    path: nodePathFilePath,
    exists: fs.existsSync(nodePathFilePath),
  };

  const consider = (
    source: string,
    rawCandidate?: string,
  ): { nodePath: string; source: string } | null => {
    if (!rawCandidate) return null;
    let candidate = expandTilde(stripOuterQuotes(rawCandidate));

    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        candidate = path.join(candidate, nodeFileName);
      }
    } catch {
      // ignore
    }

    if (canExecute(candidate)) {
      return { nodePath: candidate, source };
    }
    return null;
  };

  // Priority 0: CHROME_MCP_NODE_PATH
  const fromEnv = consider('CHROME_MCP_NODE_PATH', process.env.CHROME_MCP_NODE_PATH);
  if (fromEnv) {
    return { ...fromEnv, nodePathFile };
  }

  // Priority 1: node_path.txt
  if (nodePathFile.exists) {
    try {
      const content = fs.readFileSync(nodePathFilePath, 'utf8').trim();
      nodePathFile.value = content;
      const fromFile = consider('node_path.txt', content);
      nodePathFile.valid = Boolean(fromFile);
      if (fromFile) {
        return { ...fromFile, nodePathFile };
      }
    } catch (e) {
      nodePathFile.error = stringifyError(e);
      nodePathFile.valid = false;
    }
  }

  // Priority 1.5: Relative path fallback (mirrors run_host.sh/bat)
  // Unix: ../../../bin/node (from dist/)
  // Windows: ..\..\..\node.exe (from dist/, no bin/ subdirectory)
  const relativeNodePath =
    process.platform === 'win32'
      ? path.resolve(distDir, '..', '..', '..', nodeFileName)
      : path.resolve(distDir, '..', '..', '..', 'bin', nodeFileName);
  const fromRelative = consider('relative', relativeNodePath);
  if (fromRelative) return { ...fromRelative, nodePathFile };

  // Priority 2: Volta
  const voltaHome = process.env.VOLTA_HOME || path.join(os.homedir(), '.volta');
  const fromVolta = consider('volta', path.join(voltaHome, 'bin', nodeFileName));
  if (fromVolta) return { ...fromVolta, nodePathFile };

  // Priority 3: asdf (cross-platform)
  const asdfDir = process.env.ASDF_DATA_DIR || path.join(os.homedir(), '.asdf');
  const asdfNodejsDir = path.join(asdfDir, 'installs', 'nodejs');
  const latestAsdf = pickLatestVersionDir(asdfNodejsDir);
  if (latestAsdf) {
    const fromAsdf = consider('asdf', path.join(latestAsdf, 'bin', nodeFileName));
    if (fromAsdf) return { ...fromAsdf, nodePathFile };
  }

  // Priority 4: fnm (cross-platform, Windows uses different layout)
  const fnmDir = process.env.FNM_DIR || path.join(os.homedir(), '.fnm');
  const fnmVersionsDir = path.join(fnmDir, 'node-versions');
  const latestFnm = pickLatestVersionDir(fnmVersionsDir);
  if (latestFnm) {
    const fnmNodePath =
      process.platform === 'win32'
        ? path.join(latestFnm, 'installation', nodeFileName)
        : path.join(latestFnm, 'installation', 'bin', nodeFileName);
    const fromFnm = consider('fnm', fnmNodePath);
    if (fromFnm) return { ...fromFnm, nodePathFile };
  }

  // Priority 5: NVM (Unix only)
  if (process.platform !== 'win32') {
    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
    const nvmDefaultAlias = path.join(nvmDir, 'alias', 'default');
    try {
      if (fs.existsSync(nvmDefaultAlias)) {
        const stat = fs.lstatSync(nvmDefaultAlias);
        const maybeVersion = stat.isSymbolicLink()
          ? fs.readlinkSync(nvmDefaultAlias).trim()
          : fs.readFileSync(nvmDefaultAlias, 'utf8').trim();
        const fromDefault = consider(
          'nvm-default',
          path.join(nvmDir, 'versions', 'node', maybeVersion, 'bin', 'node'),
        );
        if (fromDefault) return { ...fromDefault, nodePathFile };
      }
    } catch {
      // ignore
    }

    const latestNvm = pickLatestVersionDir(path.join(nvmDir, 'versions', 'node'));
    if (latestNvm) {
      const fromNvm = consider('nvm-latest', path.join(latestNvm, 'bin', 'node'));
      if (fromNvm) return { ...fromNvm, nodePathFile };
    }
  }

  // Priority 6: Common paths
  const commonPaths =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
          path.join(
            process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
            'nodejs',
            'node.exe',
          ),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
        ].filter((p) => path.isAbsolute(p))
      : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'];
  for (const common of commonPaths) {
    const resolved = consider('common', common);
    if (resolved) return { ...resolved, nodePathFile };
  }

  // Priority 7: PATH
  const pathEnv = process.env.PATH || '';
  for (const rawDir of pathEnv.split(path.delimiter)) {
    const dir = stripOuterQuotes(rawDir);
    if (!dir) continue;
    const candidate = path.join(dir, nodeFileName);
    if (canExecute(candidate)) {
      return { nodePath: candidate, source: 'PATH', nodePathFile };
    }
  }

  return { nodePathFile };
}

// ============================================================================
// Browser Resolution
// ============================================================================

function resolveTargetBrowsers(browserArg: string | undefined): BrowserType[] | undefined {
  if (!browserArg) return undefined;
  const normalized = browserArg.toLowerCase();
  if (normalized === 'all') return [BrowserType.CHROME, BrowserType.CHROMIUM];
  if (normalized === 'detect' || normalized === 'auto') return undefined;
  const parsed = parseBrowserType(normalized);
  if (!parsed) {
    throw new Error(`Invalid browser: ${browserArg}. Use 'chrome', 'chromium', or 'all'`);
  }
  return [parsed];
}

function resolveBrowsersToCheck(requested: BrowserType[] | undefined): BrowserType[] {
  if (requested && requested.length > 0) return requested;
  const detected = detectInstalledBrowsers();
  if (detected.length > 0) return detected;
  return [BrowserType.CHROME, BrowserType.CHROMIUM];
}

// ============================================================================
// Windows Registry Check
// ============================================================================

type RegistryValueType = 'REG_SZ' | 'REG_EXPAND_SZ';

function queryWindowsRegistryDefaultValue(registryKey: string): {
  value?: string;
  valueType?: RegistryValueType;
  error?: string;
} {
  try {
    const output = execFileSync('reg', ['query', registryKey, '/ve'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2500,
      windowsHide: true,
    });
    const lines = output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const match = line.match(/\b(REG_SZ|REG_EXPAND_SZ)\b\s+(.*)$/i);
      if (match?.[2]) {
        const valueType = match[1].toUpperCase() as RegistryValueType;
        return { value: match[2].trim(), valueType };
      }
    }
    return { error: 'No REG_SZ/REG_EXPAND_SZ default value found' };
  } catch (e) {
    return { error: stringifyError(e) };
  }
}

// ============================================================================
// Fix Attempts
// ============================================================================

async function attemptFixes(
  enabled: boolean,
  silent: boolean,
  distDir: string,
  targetBrowsers: BrowserType[] | undefined,
): Promise<DoctorFixAttempt[]> {
  if (!enabled) return [];

  const fixes: DoctorFixAttempt[] = [];
  const logDir = getLogDir();
  const nodePathFile = path.join(distDir, 'node_path.txt');

  const withMutedConsole = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!silent) return await fn();
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
    }
  };

  const attempt = async (id: string, description: string, action: () => Promise<void> | void) => {
    try {
      await withMutedConsole(async () => {
        await action();
      });
      fixes.push({ id, description, success: true });
    } catch (e) {
      fixes.push({ id, description, success: false, error: stringifyError(e) });
    }
  };

  await attempt('logs', 'Ensure logs directory exists', async () => {
    fs.mkdirSync(logDir, { recursive: true });
  });

  await attempt('node_path', 'Write node_path.txt for run_host scripts', async () => {
    fs.writeFileSync(nodePathFile, process.execPath, 'utf8');
  });

  await attempt('permissions', 'Fix execution permissions for native host files', async () => {
    await ensureExecutionPermissions();
  });

  await attempt('browser.launch-config', 'Detect and persist browser executable path', async () => {
    const persisted = resolveAndPersistBrowserLaunchConfig(targetBrowsers);
    if (!persisted) {
      throw new Error('No supported Chrome/Chromium executable detected');
    }
  });

  const sqliteProbe = probeBetterSqliteBinding(distDir);
  if (!sqliteProbe.ok) {
    await attempt('native.sqlite', 'Rebuild better-sqlite3 native binding', async () => {
      if (!sqliteProbe.packageDir) {
        throw new Error(
          `Cannot locate better-sqlite3 package directory. Original error: ${sqliteProbe.error ?? 'unknown'}`,
        );
      }
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      execFileSync(npmCmd, ['run', 'install'], {
        cwd: sqliteProbe.packageDir,
        stdio: silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        timeout: 120_000,
        windowsHide: true,
      });

      const afterProbe = probeBetterSqliteBinding(distDir);
      if (!afterProbe.ok) {
        throw new Error(afterProbe.error ?? 'better-sqlite3 binding check still failed');
      }
    });
  }

  await attempt('register', 'Re-register Native Messaging host (user-level)', async () => {
    const ok = await tryRegisterUserLevelHost(targetBrowsers);
    if (!ok) {
      throw new Error('User-level registration failed');
    }
  });

  const stdioConfigFixPath = path.resolve(distDir, 'mcp', 'stdio-config.json');
  if (fs.existsSync(stdioConfigFixPath)) {
    await attempt('port', 'Fix stdio-config.json port to match NATIVE_SERVER_PORT', async () => {
      const raw = fs.readFileSync(stdioConfigFixPath, 'utf8');
      const cfg = JSON.parse(raw);
      if (cfg.url) {
        const url = new URL(cfg.url);
        const expected = String(NATIVE_SERVER_PORT);
        if (url.port !== expected) {
          url.port = expected;
          cfg.url = url.toString();
          fs.writeFileSync(stdioConfigFixPath, JSON.stringify(cfg, null, 4), 'utf8');
        }
      }
    });
  }
  await attempt('daemon', 'Ensure standalone daemon is running', async () => {
    const before = await daemonStatus();

    if (before.running && before.healthy) {
      return;
    }

    if (before.running && !before.healthy) {
      await daemonStop();
    }

    await daemonStart();

    const after = await daemonStatus();
    if (!after.running || !after.healthy) {
      throw new Error('Daemon is still unavailable after start attempt');
    }
  });
  return fixes;
}

// ============================================================================
// JSON File Reading
// ============================================================================

function readJsonFile(
  filePath: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: stringifyError(e) };
  }
}

// ============================================================================
// Connectivity Check
// ============================================================================

type FetchFn = typeof globalThis.fetch;

function resolveFetch(): FetchFn | null {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as FetchFn;
  }
  try {
    const mod = require('node-fetch');
    return (mod.default ?? mod) as FetchFn;
  } catch {
    return null;
  }
}

async function checkConnectivity(
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    return { ok: false, error: 'fetch is not available (requires Node.js >=18 or node-fetch)' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // Prevent timeout from keeping the process alive
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const res = await fetchFn(url, { method: 'GET', signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    const errName = e instanceof Error ? e.name : '';
    if (errName === 'AbortError' || errMessage.toLowerCase().includes('abort')) {
      return { ok: false, error: `Timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: errMessage };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<{
  ok: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
}> {
  const fetchFn = resolveFetch();
  if (!fetchFn) {
    return { ok: false, error: 'fetch is not available (requires Node.js >=18 or node-fetch)' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const res = await fetchFn(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });

    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return { ok: res.ok, status: res.status, headers, body };
  } catch (e: unknown) {
    const errMessage = e instanceof Error ? e.message : String(e);
    const errName = e instanceof Error ? e.name : '';
    if (errName === 'AbortError' || errMessage.toLowerCase().includes('abort')) {
      return { ok: false, error: `Timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: errMessage };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMcpJsonPayload(body: unknown): { payload?: any; error?: string } {
  if (body && typeof body === 'object') {
    return { payload: body };
  }

  if (typeof body !== 'string') {
    return { error: 'MCP response body is empty' };
  }

  const trimmed = body.trim();
  if (!trimmed) {
    return { error: 'MCP response body is empty' };
  }

  if (trimmed.startsWith('{')) {
    try {
      return { payload: JSON.parse(trimmed) };
    } catch (error) {
      return {
        error: `Failed to parse MCP JSON body: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  const latest = dataLines[dataLines.length - 1];
  if (!latest) {
    return { error: 'MCP response did not contain a data payload' };
  }

  try {
    return { payload: JSON.parse(latest) };
  } catch (error) {
    return {
      error: `Failed to parse MCP stream payload: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkRuntimeStatus(baseUrl: URL): Promise<{
  ok: boolean;
  status?: number;
  snapshot?: Record<string, unknown>;
  error?: string;
}> {
  const statusUrl = new URL('/status', baseUrl);
  const response = await fetchJson(statusUrl.toString(), { method: 'GET' }, 1500);
  const payload =
    response.body && typeof response.body === 'object'
      ? (response.body as { data?: Record<string, unknown> })
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    snapshot: payload?.data,
    error: response.error,
  };
}

async function checkMcpInitialize(baseUrl: URL): Promise<{
  ok: boolean;
  status?: number;
  sessionId?: string;
  error?: string;
}> {
  const mcpUrl = new URL('/mcp', baseUrl);
  const response = await fetchJson(
    mcpUrl.toString(),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: {
            name: 'doctor',
            version: '1.0.0',
          },
        },
      }),
    },
    2500,
  );

  const sessionId = response.headers?.['mcp-session-id'];
  if (!response.ok || !sessionId) {
    return {
      ok: false,
      status: response.status,
      error:
        response.error ||
        (response.ok ? 'Initialize succeeded but no mcp-session-id was returned' : undefined),
    };
  }

  const deleteResponse = await fetchJson(
    mcpUrl.toString(),
    {
      method: 'DELETE',
      headers: {
        'mcp-session-id': sessionId,
      },
    },
    1500,
  );

  return {
    ok: deleteResponse.ok || deleteResponse.status === HTTP_STATUS.NO_CONTENT,
    status: response.status,
    sessionId,
    error: deleteResponse.ok
      ? undefined
      : deleteResponse.error || `DELETE /mcp returned ${deleteResponse.status}`,
  };
}

async function checkMcpToolCall(baseUrl: URL): Promise<{
  ok: boolean;
  status?: number;
  sessionId?: string;
  error?: string;
}> {
  const mcpUrl = new URL('/mcp', baseUrl);

  const initResponse = await fetchJson(
    mcpUrl.toString(),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: {
            name: 'doctor',
            version: '1.0.0',
          },
        },
      }),
    },
    2500,
  );

  const sessionId = initResponse.headers?.['mcp-session-id'];
  if (!initResponse.ok || !sessionId) {
    return {
      ok: false,
      status: initResponse.status,
      error:
        initResponse.error ||
        (initResponse.ok ? 'Initialize succeeded but no mcp-session-id was returned' : undefined),
    };
  }

  const callResponse = await fetchJson(
    mcpUrl.toString(),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_windows_and_tabs',
          arguments: {},
        },
      }),
    },
    3500,
  );

  const deleteResponse = await fetchJson(
    mcpUrl.toString(),
    {
      method: 'DELETE',
      headers: {
        'mcp-session-id': sessionId,
      },
    },
    1500,
  );

  const deleteOk = deleteResponse.ok || deleteResponse.status === HTTP_STATUS.NO_CONTENT;
  if (!deleteOk) {
    return {
      ok: false,
      status: callResponse.status,
      sessionId,
      error: deleteResponse.error || `DELETE /mcp returned ${deleteResponse.status}`,
    };
  }

  if (!callResponse.ok) {
    return {
      ok: false,
      status: callResponse.status,
      sessionId,
      error: callResponse.error || `POST /mcp tools/call returned ${callResponse.status}`,
    };
  }

  const parsed = parseMcpJsonPayload(callResponse.body);
  if (!parsed.payload) {
    return {
      ok: false,
      status: callResponse.status,
      sessionId,
      error: parsed.error || 'Unable to parse tools/call payload',
    };
  }

  if (parsed.payload.error) {
    return {
      ok: false,
      status: callResponse.status,
      sessionId,
      error: String(parsed.payload.error.message || parsed.payload.error),
    };
  }

  const result = parsed.payload.result;
  if (result?.isError) {
    const toolText = Array.isArray(result.content)
      ? result.content.find((item: any) => item?.type === 'text')?.text
      : undefined;
    return {
      ok: false,
      status: callResponse.status,
      sessionId,
      error: toolText ? String(toolText) : 'tools/call returned isError=true',
    };
  }

  return {
    ok: true,
    status: callResponse.status,
    sessionId,
  };
}

// ============================================================================
// Summary Computation
// ============================================================================

function computeSummary(checks: DoctorCheckResult[]): { ok: number; warn: number; error: number } {
  let ok = 0;
  let warn = 0;
  let error = 0;
  for (const check of checks) {
    if (check.status === 'ok') ok++;
    else if (check.status === 'warn') warn++;
    else error++;
  }
  return { ok, warn, error };
}

function getCheckPriority(id: string): number {
  if (id === 'installation') return 10;
  if (id === 'host.files') return 20;
  if (id === 'node') return 30;
  if (id === 'native.sqlite') return 35;
  if (id.startsWith('manifest.')) return 40;
  if (id.startsWith('active-origin.')) return 45;
  if (id.startsWith('registry.')) return 50;
  if (id.startsWith('extension-path.')) return 60;
  if (id === 'port.config' || id === 'port.constant') return 70;
  if (id === 'connectivity') return 80;
  if (id === 'runtime.status') return 90;
  if (id === 'runtime.consistency') return 92;
  if (id === 'daemon.status') return 93;
  if (id === 'remote.lan') return 95;
  if (id === 'mcp.initialize') return 100;
  if (id === 'mcp.toolcall') return 101;
  if (id === 'security.auth') return 110;
  if (id === 'logs') return 120;
  return 1000;
}

function sortChecks(checks: DoctorCheckResult[]): DoctorCheckResult[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => {
      const priorityDelta = getCheckPriority(a.check.id) - getCheckPriority(b.check.id);
      if (priorityDelta !== 0) return priorityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.check);
}

function statusBadge(status: DoctorStatus): string {
  if (status === 'ok') return colorText('[OK]', 'green');
  if (status === 'warn') return colorText('[WARN]', 'yellow');
  return colorText('[ERROR]', 'red');
}

// ============================================================================
// Main Doctor Function
// ============================================================================

/**
 * Collect doctor report without outputting to console.
 * Used by both runDoctor and report command.
 */
export async function collectDoctorReport(options: DoctorOptions): Promise<DoctorReport> {
  const pkg = readPackageJson();
  const distDir = resolveDistDir();
  const rootDir = path.resolve(distDir, '..');
  const packageName = typeof pkg.name === 'string' ? pkg.name : 'tabrix';
  const packageVersion = typeof pkg.version === 'string' ? pkg.version : 'unknown';
  const commandInfo = getCommandInfo(pkg);

  const targetBrowsers = resolveTargetBrowsers(options.browser);
  const browsersToCheck = resolveBrowsersToCheck(targetBrowsers);

  const wrapperScriptName = process.platform === 'win32' ? 'run_host.bat' : 'run_host.sh';
  const wrapperPath = path.resolve(distDir, wrapperScriptName);
  const nodeScriptPath = path.resolve(distDir, 'index.js');
  const logDir = getLogDir();
  const stdioConfigPath = path.resolve(distDir, 'mcp', 'stdio-config.json');

  // Run fixes if requested
  const fixes = await attemptFixes(
    Boolean(options.fix),
    Boolean(options.json),
    distDir,
    targetBrowsers,
  );

  const checks: DoctorCheckResult[] = [];
  const nextSteps: string[] = [];
  const manifestOriginsByBrowser = new Map<
    BrowserType,
    { path: string; origins: string[]; issues: string[] }
  >();
  let runtimeSnapshot: Record<string, unknown> | undefined;
  let runtimeConsistency: Awaited<ReturnType<typeof collectRuntimeConsistencySnapshot>> | undefined;

  // Check 1: Installation info
  checks.push({
    id: 'installation',
    title: 'Installation',
    status: 'ok',
    message: `${packageName}@${packageVersion}, ${process.platform}-${process.arch}, node ${process.version}`,
    details: {
      packageRoot: rootDir,
      distDir,
      execPath: process.execPath,
      aliases: commandInfo.aliases,
    },
  });

  // Check 2: Host files
  const missingHostFiles: string[] = [];
  if (!fs.existsSync(wrapperPath)) missingHostFiles.push(wrapperPath);
  if (!fs.existsSync(nodeScriptPath)) missingHostFiles.push(nodeScriptPath);
  if (!fs.existsSync(stdioConfigPath)) missingHostFiles.push(stdioConfigPath);

  if (missingHostFiles.length > 0) {
    checks.push({
      id: 'host.files',
      title: 'Host files',
      status: 'error',
      message: `Missing required files (${missingHostFiles.length})`,
      details: { missing: missingHostFiles },
    });
    nextSteps.push(`Reinstall: npm install -g ${COMMAND_NAME}`);
  } else {
    checks.push({
      id: 'host.files',
      title: 'Host files',
      status: 'ok',
      message: `Wrapper: ${wrapperPath}`,
      details: { wrapperPath, nodeScriptPath, stdioConfigPath },
    });
  }

  // Check 3: Permissions (Unix only)
  if (process.platform !== 'win32' && fs.existsSync(wrapperPath)) {
    const executable = canExecute(wrapperPath);
    checks.push({
      id: 'host.permissions',
      title: 'Host permissions',
      status: executable ? 'ok' : 'error',
      message: executable ? 'run_host.sh is executable' : 'run_host.sh is not executable',
      details: {
        path: wrapperPath,
        fix: executable
          ? undefined
          : [`${COMMAND_NAME} fix-permissions`, `chmod +x "${wrapperPath}"`],
      },
    });
    if (!executable) nextSteps.push(`${COMMAND_NAME} fix-permissions`);
  } else {
    checks.push({
      id: 'host.permissions',
      title: 'Host permissions',
      status: 'ok',
      message: process.platform === 'win32' ? 'Not applicable on Windows' : 'N/A',
    });
  }

  // Check 4: Node resolution
  const nodeResolution = resolveNodeCandidate(distDir);
  if (nodeResolution.nodePath) {
    try {
      nodeResolution.version = execFileSync(nodeResolution.nodePath, ['-v'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2500,
        windowsHide: true,
      }).trim();
    } catch (e) {
      nodeResolution.versionError = stringifyError(e);
    }
  }

  // Parse Node version and check if it meets minimum requirement
  const nodeMajorVersion = parseNodeMajorVersion(nodeResolution.version || '');
  const nodeVersionTooOld = nodeMajorVersion !== null && nodeMajorVersion < MIN_NODE_MAJOR_VERSION;

  const nodePathWarn =
    Boolean(nodeResolution.nodePath) &&
    (!nodeResolution.nodePathFile.exists || nodeResolution.nodePathFile.valid === false) &&
    !process.env.CHROME_MCP_NODE_PATH;

  // Determine node check status: error if not found or version too old, warn if path issue
  let nodeStatus: DoctorStatus = 'ok';
  let nodeMessage: string;
  let nodeFix: string[] | undefined;

  if (!nodeResolution.nodePath) {
    nodeStatus = 'error';
    nodeMessage = 'Node.js executable not found by wrapper search order';
    nodeFix = [
      `${COMMAND_NAME} doctor --fix`,
      `Or set CHROME_MCP_NODE_PATH to an absolute node path`,
    ];
    nextSteps.push(`${COMMAND_NAME} doctor --fix`);
  } else if (nodeResolution.versionError) {
    nodeStatus = 'error';
    nodeMessage = `Found ${nodeResolution.source}: ${nodeResolution.nodePath} but failed to run "node -v" (${nodeResolution.versionError})`;
    nodeFix = [
      `Verify the executable: "${nodeResolution.nodePath}" -v`,
      `Reinstall/repair Node.js`,
    ];
    nextSteps.push(`Verify Node.js: "${nodeResolution.nodePath}" -v`);
  } else if (nodeVersionTooOld) {
    nodeStatus = 'error';
    nodeMessage = `Node.js ${nodeResolution.version} is too old (requires >= ${MIN_NODE_MAJOR_VERSION}.0.0)`;
    nodeFix = [`Upgrade Node.js to version ${MIN_NODE_MAJOR_VERSION} or higher`];
    nextSteps.push(`Upgrade Node.js to version ${MIN_NODE_MAJOR_VERSION}+`);
  } else if (nodePathWarn) {
    nodeStatus = 'warn';
    nodeMessage = `Using ${nodeResolution.source}: ${nodeResolution.nodePath}${nodeResolution.version ? ` (${nodeResolution.version})` : ''}`;
    nodeFix = [
      `${COMMAND_NAME} doctor --fix`,
      `Or set CHROME_MCP_NODE_PATH to an absolute node path`,
    ];
  } else {
    nodeStatus = 'ok';
    nodeMessage = `Using ${nodeResolution.source}: ${nodeResolution.nodePath}${nodeResolution.version ? ` (${nodeResolution.version})` : ''}`;
  }

  checks.push({
    id: 'node',
    title: 'Node executable',
    status: nodeStatus,
    message: nodeMessage,
    details: {
      resolved: nodeResolution.nodePath
        ? {
            source: nodeResolution.source,
            path: nodeResolution.nodePath,
            version: nodeResolution.version,
            versionError: nodeResolution.versionError,
            majorVersion: nodeMajorVersion,
          }
        : undefined,
      nodePathFile: nodeResolution.nodePathFile,
      minRequired: `>=${MIN_NODE_MAJOR_VERSION}.0.0`,
      fix: nodeFix,
    },
  });

  // Check 4.1: Native sqlite binding for agent database
  const sqliteProbe = probeBetterSqliteBinding(distDir);
  const sqliteIssue =
    !sqliteProbe.ok && typeof sqliteProbe.error === 'string'
      ? detectSqliteBindingIssue(sqliteProbe.error)
      : false;
  const sqliteFix = sqliteProbe.packageDir
    ? [`${COMMAND_NAME} doctor --fix`, `npm --prefix "${sqliteProbe.packageDir}" run install`]
    : [`${COMMAND_NAME} doctor --fix`, `npm i -g @tabrix/tabrix@latest --force`];

  checks.push({
    id: 'native.sqlite',
    title: 'Native sqlite binding',
    status: sqliteProbe.ok ? 'ok' : 'error',
    message: sqliteProbe.ok
      ? `better-sqlite3 is ready${sqliteProbe.version ? ` (v${sqliteProbe.version})` : ''}`
      : sqliteIssue
        ? 'better-sqlite3 binding is missing or incompatible'
        : `better-sqlite3 check failed: ${sqliteProbe.error ?? 'unknown error'}`,
    details: {
      packageDir: sqliteProbe.packageDir,
      version: sqliteProbe.version,
      error: sqliteProbe.error,
      fix: sqliteProbe.ok ? undefined : sqliteFix,
    },
  });
  if (!sqliteProbe.ok) {
    nextSteps.push(`${COMMAND_NAME} doctor --fix`);
  }

  // Check 5: Manifest checks per browser
  const preferredBrowserExecutable = resolvePreferredBrowserExecutable(browsersToCheck);
  const persistedBrowserExecutable = readPersistedBrowserLaunchConfig();
  checks.push({
    id: 'browser.executable',
    title: 'Browser executable',
    status: preferredBrowserExecutable ? 'ok' : 'error',
    message: preferredBrowserExecutable
      ? `${preferredBrowserExecutable.executablePath} (${preferredBrowserExecutable.source})`
      : 'No supported Chrome/Chromium executable detected',
    details: {
      persisted: persistedBrowserExecutable,
      persistedPath: getBrowserLaunchConfigPath(),
      fix: preferredBrowserExecutable
        ? undefined
        : ['Install Chrome/Chromium, then run tabrix register or tabrix doctor --fix'],
    },
  });
  if (!preferredBrowserExecutable) {
    nextSteps.push('Install Chrome/Chromium');
    nextSteps.push(`${COMMAND_NAME} doctor --fix`);
  }

  const discoveredOrigins = discoverLoadedExtensionOrigins(browsersToCheck);
  const fallbackOrigin = `chrome-extension://${EXTENSION_ID}/`;
  const expectedOrigins =
    discoveredOrigins.origins.length > 0
      ? Array.from(new Set(discoveredOrigins.origins))
      : [fallbackOrigin];
  const expectedOrigin = expectedOrigins[0];
  for (const browser of browsersToCheck) {
    const config = getBrowserConfig(browser);
    const candidates = [config.userManifestPath, config.systemManifestPath];
    const found = candidates.find((p) => fs.existsSync(p));

    if (!found) {
      checks.push({
        id: `manifest.${browser}`,
        title: `${config.displayName} manifest`,
        status: 'error',
        message: 'Manifest not found',
        details: {
          expected: candidates,
          fix: [
            `${COMMAND_NAME} register --browser ${browser}`,
            `${COMMAND_NAME} register --detect`,
          ],
        },
      });
      nextSteps.push(`${COMMAND_NAME} register --detect`);
      continue;
    }

    const parsed = readJsonFile(found);
    if (!parsed.ok) {
      checks.push({
        id: `manifest.${browser}`,
        title: `${config.displayName} manifest`,
        status: 'error',
        message: `Failed to parse manifest: ${parsed.error}`,
        details: { path: found, fix: [`${COMMAND_NAME} register --browser ${browser}`] },
      });
      nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
      continue;
    }

    const manifest = parsed.value as Record<string, unknown>;
    const issues: string[] = [];
    if (manifest.name !== HOST_NAME) issues.push(`name != ${HOST_NAME}`);
    if (manifest.type !== 'stdio') issues.push(`type != stdio`);
    if (typeof manifest.path !== 'string') issues.push('path is missing');
    if (typeof manifest.path === 'string') {
      const actual = normalizeComparablePath(manifest.path);
      const expected = normalizeComparablePath(wrapperPath);
      if (actual !== expected) issues.push('path does not match installed wrapper');
      if (!fs.existsSync(manifest.path)) issues.push('path target does not exist');
    }
    const allowedOrigins = manifest.allowed_origins;
    const manifestOrigins = Array.isArray(allowedOrigins)
      ? allowedOrigins.filter((value): value is string => typeof value === 'string')
      : [];
    const missingOrigins = expectedOrigins.filter((origin) => !manifestOrigins.includes(origin));
    if (missingOrigins.length > 0) {
      issues.push(`allowed_origins missing ${missingOrigins.join(', ')}`);
    }
    manifestOriginsByBrowser.set(browser, {
      path: found,
      origins: manifestOrigins,
      issues,
    });

    checks.push({
      id: `manifest.${browser}`,
      title: `${config.displayName} manifest`,
      status: issues.length === 0 ? 'ok' : 'error',
      message: issues.length === 0 ? found : `Invalid manifest (${issues.join('; ')})`,
      details: {
        path: found,
        expectedWrapperPath: wrapperPath,
        expectedOrigin,
        expectedOrigins,
        manifestOrigins,
        discoveredOrigins: discoveredOrigins.detected,
        fix: issues.length === 0 ? undefined : [`${COMMAND_NAME} register --browser ${browser}`],
      },
    });
    if (issues.length > 0) nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
  }

  // Check 5.1: Active extension ID origin alignment
  for (const browser of browsersToCheck) {
    const config = getBrowserConfig(browser);
    const loaded = discoveredOrigins.detected.find((entry) => entry.browser === browser);
    const manifestInfo = manifestOriginsByBrowser.get(browser);

    if (!loaded) {
      checks.push({
        id: `active-origin.${browser}`,
        title: `${config.displayName} active extension origin`,
        status: 'warn',
        message: 'Unable to detect currently loaded extension ID',
        details: {
          hint: 'Load/reload unpacked extension in chrome://extensions/, then re-run doctor.',
        },
      });
      continue;
    }

    if (!manifestInfo) {
      const loadedOrigin = `chrome-extension://${loaded.id}/`;
      checks.push({
        id: `active-origin.${browser}`,
        title: `${config.displayName} active extension origin`,
        status: 'error',
        message: 'Manifest could not be validated, cannot confirm active origin authorization',
        details: {
          loadedExtensionId: loaded.id,
          loadedOrigin,
          fix: [`${COMMAND_NAME} register --browser ${browser}`],
        },
      });
      nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
      continue;
    }

    const loadedOrigin = `chrome-extension://${loaded.id}/`;
    const currentOriginAllowed = manifestInfo.origins.includes(loadedOrigin);
    checks.push({
      id: `active-origin.${browser}`,
      title: `${config.displayName} active extension origin`,
      status: currentOriginAllowed ? 'ok' : 'error',
      message: currentOriginAllowed
        ? `Loaded origin is authorized: ${loadedOrigin}`
        : `Loaded origin is missing in allowed_origins: ${loadedOrigin}`,
      details: {
        loadedExtensionId: loaded.id,
        loadedOrigin,
        manifestPath: manifestInfo.path,
        manifestOrigins: manifestInfo.origins,
        fix: currentOriginAllowed ? undefined : [`${COMMAND_NAME} register --browser ${browser}`],
      },
    });
    if (!currentOriginAllowed) nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
  }

  // Check 6: Windows registry (Windows only)
  if (process.platform === 'win32') {
    for (const browser of browsersToCheck) {
      const config = getBrowserConfig(browser);
      const keySpecs = [
        config.registryKey ? { key: config.registryKey, expected: config.userManifestPath } : null,
        config.systemRegistryKey
          ? { key: config.systemRegistryKey, expected: config.systemManifestPath }
          : null,
      ].filter(Boolean) as Array<{ key: string; expected: string }>;
      if (keySpecs.length === 0) continue;

      let anyValue = false;
      let anyExistingTarget = false;
      let anyMissingTarget = false;
      let anyMismatch = false;

      const results: Array<{
        key: string;
        expected: string;
        value?: string;
        valueType?: string;
        expandedValue?: string;
        exists?: boolean;
        matchesExpected?: boolean;
        error?: string;
      }> = [];

      for (const spec of keySpecs) {
        const res = queryWindowsRegistryDefaultValue(spec.key);
        if (!res.value) {
          results.push({ key: spec.key, expected: spec.expected, error: res.error });
          continue;
        }

        anyValue = true;
        // Expand environment variables for REG_EXPAND_SZ values
        const expandedValue = expandWindowsEnvVars(stripOuterQuotes(res.value));
        const exists = fs.existsSync(expandedValue);
        const matchesExpected =
          normalizeComparablePath(expandedValue) === normalizeComparablePath(spec.expected);

        if (exists) {
          anyExistingTarget = true;
          if (!matchesExpected) anyMismatch = true;
        } else {
          anyMissingTarget = true;
        }

        results.push({
          key: spec.key,
          expected: spec.expected,
          value: res.value,
          valueType: res.valueType,
          expandedValue: expandedValue !== res.value ? expandedValue : undefined,
          exists,
          matchesExpected,
        });
      }

      let status: DoctorStatus = 'error';
      let message = 'Registry entry not found';
      if (!anyValue) {
        status = 'error';
        message = 'Registry entry not found';
      } else if (!anyExistingTarget) {
        status = 'error';
        message = 'Registry entry points to missing manifest';
      } else if (anyMissingTarget || anyMismatch) {
        status = 'warn';
        message = 'Registry entry found but inconsistent';
      } else {
        status = 'ok';
        message = 'Registry entry points to manifest';
      }

      checks.push({
        id: `registry.${browser}`,
        title: `${config.displayName} registry`,
        status,
        message,
        details: {
          keys: keySpecs.map((s) => s.key),
          results,
          fix: status === 'ok' ? undefined : [`${COMMAND_NAME} register --browser ${browser}`],
        },
      });
      if (status !== 'ok') nextSteps.push(`${COMMAND_NAME} register --browser ${browser}`);
    }
  }

  // Check 7: Loaded extension path
  for (const browser of browsersToCheck) {
    const config = getBrowserConfig(browser);
    const extension = readLoadedExtensionPath(browser);
    const browserOrigins = discoveredOrigins.detected.filter((entry) => entry.browser === browser);
    const detectedLoadedPath = browserOrigins[0]?.path;
    const metadataLooksComplete =
      Boolean(extension.loadedPath || detectedLoadedPath) && typeof extension.location === 'number';
    const extensionStatus: DoctorStatus =
      extension.loadedPath || detectedLoadedPath ? (metadataLooksComplete ? 'ok' : 'warn') : 'warn';
    const extensionMessage =
      extension.loadedPath || detectedLoadedPath
        ? metadataLooksComplete
          ? extension.loadedPath || detectedLoadedPath
          : `${extension.loadedPath || detectedLoadedPath} (reload unpacked extension to refresh runtime metadata)`
        : extension.error || 'Unable to detect loaded extension path';

    checks.push({
      id: `extension-path.${browser}`,
      title: `${config.displayName} extension path`,
      status: extensionStatus,
      message: extensionMessage,
      details: {
        securePreferencesPath: extension.securePreferencesPath,
        loadedPath: extension.loadedPath || detectedLoadedPath,
        detectedIds: browserOrigins.map((entry) => entry.id),
        expectedOrigins: expectedOrigins.filter((origin) =>
          browserOrigins.some((entry) => origin === `chrome-extension://${entry.id}/`),
        ),
        location: extension.location,
        state: extension.state,
        manifestVersion: extension.manifestVersion,
        hint: extension.loadedPath
          ? metadataLooksComplete
            ? 'If builds seem stale, make sure Chrome is loading this unpacked directory.'
            : 'Chrome knows the unpacked directory, but some optional metadata is incomplete. Reload the unpacked extension in chrome://extensions/ if behavior looks stale.'
          : 'Load or reload the unpacked extension in Chrome, then re-run doctor.',
      },
    });
  }

  // Check 8: Port configuration
  if (fs.existsSync(stdioConfigPath)) {
    const cfg = readJsonFile(stdioConfigPath);
    if (!cfg.ok) {
      checks.push({
        id: 'port.config',
        title: 'Port config',
        status: 'error',
        message: `Failed to parse stdio-config.json: ${cfg.error}`,
      });
    } else {
      try {
        const configValue = cfg.value as Record<string, unknown>;
        const url = new URL(configValue.url as string);
        const port = Number(url.port);
        const portOk = port === EXPECTED_PORT;
        checks.push({
          id: 'port.config',
          title: 'Port config',
          status: portOk ? 'ok' : 'error',
          message: configValue.url as string,
          details: {
            expectedPort: EXPECTED_PORT,
            actualPort: port,
            fix: portOk ? undefined : [`${COMMAND_NAME} update-port ${EXPECTED_PORT}`],
          },
        });
        if (!portOk) nextSteps.push(`${COMMAND_NAME} update-port ${EXPECTED_PORT}`);

        // Check constant consistency
        const nativePortOk = NATIVE_SERVER_PORT === EXPECTED_PORT;
        checks.push({
          id: 'port.constant',
          title: 'Port constant',
          status: nativePortOk ? 'ok' : 'warn',
          message: `NATIVE_SERVER_PORT=${NATIVE_SERVER_PORT}`,
          details: { expectedPort: EXPECTED_PORT },
        });

        // Connectivity check
        const pingUrl = new URL('/ping', url);
        const ping = await checkConnectivity(pingUrl.toString(), 1500);
        checks.push({
          id: 'connectivity',
          title: 'Connectivity',
          status: ping.ok ? 'ok' : 'warn',
          message: ping.ok
            ? `GET ${pingUrl} -> ${ping.status}`
            : `GET ${pingUrl} failed (${ping.error || 'unknown error'})`,
          details: {
            hint: 'If the server is not running, click "Connect" in the extension and retry.',
          },
        });
        if (!ping.ok) nextSteps.push('Click "Connect" in the extension, then re-run doctor');

        const runtimeStatus = await checkRuntimeStatus(url);
        runtimeSnapshot = runtimeStatus.snapshot;
        const bridgeGuidance = describeBridgeStatusForDoctor(runtimeSnapshot);
        checks.push({
          id: 'runtime.status',
          title: 'Runtime status',
          status: runtimeStatus.ok ? 'ok' : 'warn',
          message: runtimeStatus.ok
            ? `GET ${new URL('/status', url)} -> ${runtimeStatus.status}; ${bridgeGuidance.summary}`
            : `GET ${new URL('/status', url)} failed (${runtimeStatus.error || 'unknown error'})`,
          details: {
            snapshot: runtimeStatus.snapshot,
            hint: `${bridgeGuidance.hint} Use "tabrix status" for a concise runtime summary.`,
            fix: bridgeGuidance.fix.length > 0 ? bridgeGuidance.fix : undefined,
          },
        });
        nextSteps.push(...bridgeGuidance.nextSteps);

        if (ping.ok) {
          const initialize = await checkMcpInitialize(url);
          checks.push({
            id: 'mcp.initialize',
            title: 'MCP initialize',
            status: initialize.ok ? 'ok' : 'warn',
            message: initialize.ok
              ? `POST /mcp initialize -> ${initialize.status} (session ${initialize.sessionId})`
              : `POST /mcp initialize failed (${initialize.error || initialize.status || 'unknown error'})`,
            details: {
              sessionId: initialize.sessionId,
              hint: initialize.ok
                ? 'A real MCP initialize call succeeded and the session cleaned up correctly.'
                : 'If this fails while /ping is healthy, the transport/session layer likely needs attention.',
            },
          });

          if (!initialize.ok) {
            nextSteps.push('Check transport/session logs or run tabrix report --include-logs tail');
          } else {
            const toolCall = await checkMcpToolCall(url);
            checks.push({
              id: 'mcp.toolcall',
              title: 'MCP tool call (browser control readiness)',
              status: toolCall.ok ? 'ok' : 'warn',
              message: toolCall.ok
                ? `POST /mcp tools/call get_windows_and_tabs -> ${toolCall.status}`
                : `POST /mcp tools/call failed (${toolCall.error || toolCall.status || 'unknown error'})`,
              details: {
                sessionId: toolCall.sessionId,
                hint: toolCall.ok ? 'Browser control bridge is ready.' : bridgeGuidance.hint,
                fix: toolCall.ok
                  ? undefined
                  : [
                      ...bridgeGuidance.fix,
                      `${COMMAND_NAME} doctor --fix`,
                      `${COMMAND_NAME} smoke`,
                    ].filter((value, index, array) => array.indexOf(value) === index),
              },
            });

            if (!toolCall.ok) {
              nextSteps.push(...bridgeGuidance.nextSteps);
              nextSteps.push(`${COMMAND_NAME} smoke`);
            }
          }
        }
      } catch (e) {
        checks.push({
          id: 'port.config',
          title: 'Port config',
          status: 'error',
          message: `Invalid URL in stdio-config.json: ${stringifyError(e)}`,
        });
      }
    }
  }

  // Check 9: Standalone daemon status
  try {
    const daemon = await daemonStatus();
    checks.push({
      id: 'daemon.status',
      title: 'Standalone daemon',
      status: daemon.running ? (daemon.healthy ? 'ok' : 'warn') : 'warn',
      message: daemon.running
        ? `running (pid=${daemon.pid ?? 'unknown'}, ${daemon.healthy ? 'healthy' : 'unhealthy'})`
        : 'stopped',
      details: {
        pid: daemon.pid,
        healthy: daemon.healthy,
        fix: daemon.running
          ? undefined
          : [`${COMMAND_NAME} daemon start`, `${COMMAND_NAME} daemon install-autostart`],
      },
    });
    if (!daemon.running) {
      nextSteps.push(`${COMMAND_NAME} daemon start`);
      nextSteps.push(`${COMMAND_NAME} daemon install-autostart`);
    }
  } catch (e) {
    checks.push({
      id: 'daemon.status',
      title: 'Standalone daemon',
      status: 'warn',
      message: `Unable to query daemon status (${stringifyError(e)})`,
      details: { fix: [`${COMMAND_NAME} daemon status`] },
    });
  }

  // Check 10: Runtime instance consistency (防止“改了代码但没跑到”)
  try {
    runtimeConsistency = await collectRuntimeConsistencySnapshot();
    const consistencyStatus: DoctorStatus =
      runtimeConsistency.verdict === 'consistent'
        ? 'ok'
        : runtimeConsistency.verdict === 'inconsistent'
          ? 'warn'
          : 'warn';
    const consistencyFix =
      runtimeConsistency.verdict === 'consistent'
        ? undefined
        : [
            `${COMMAND_NAME} daemon restart`,
            `${COMMAND_NAME} status`,
            'Reload unpacked extension in chrome://extensions/ if extension build is stale',
          ];
    checks.push({
      id: 'runtime.consistency',
      title: 'Runtime consistency',
      status: consistencyStatus,
      message: runtimeConsistency.summary,
      details: {
        verdict: runtimeConsistency.verdict,
        reasons: runtimeConsistency.reasons,
        cliSourcePath: runtimeConsistency.cli.sourcePath,
        workspaceCliPath: runtimeConsistency.cli.workspaceCliPath,
        daemon: runtimeConsistency.daemon,
        nativeDist: runtimeConsistency.nativeDist,
        extensionBuild: runtimeConsistency.extensionBuild,
        fix: consistencyFix,
      },
    });
    if (runtimeConsistency.verdict !== 'consistent') {
      nextSteps.push(`${COMMAND_NAME} daemon restart`);
      nextSteps.push(`${COMMAND_NAME} status`);
    }
  } catch (error) {
    checks.push({
      id: 'runtime.consistency',
      title: 'Runtime consistency',
      status: 'warn',
      message: `Runtime consistency check failed (${stringifyError(error)})`,
      details: {
        fix: [`${COMMAND_NAME} status`],
      },
    });
    nextSteps.push(`${COMMAND_NAME} status`);
  }

  // Check 11: Logs directory
  checks.push({
    id: 'logs',
    title: 'Logs',
    status: fs.existsSync(logDir) ? 'ok' : 'warn',
    message: logDir,
    details: {
      hint: 'Wrapper logs are created when Chrome launches the native host.',
    },
  });

  // Check 12: Remote access security
  const isRemoteListening = SERVER_CONFIG.HOST === '0.0.0.0' || SERVER_CONFIG.HOST === '::';
  const hasAuthToken = !!process.env[MCP_AUTH_TOKEN_ENV];
  if (isRemoteListening && !hasAuthToken) {
    const tokenFilePath = path.join(os.homedir(), '.tabrix', 'auth-token.json');
    const hasTokenFile = fs.existsSync(tokenFilePath);
    if (!hasTokenFile) {
      checks.push({
        id: 'security.auth',
        title: 'Remote access security',
        status: 'warn',
        message: 'Remote access enabled — token will be auto-generated on first server start',
        details: {
          host: SERVER_CONFIG.HOST,
          fix: ['Start the server once to auto-generate a token, or set MCP_AUTH_TOKEN env var'],
        },
      });
      nextSteps.push('Start the server to auto-generate auth token, or set MCP_AUTH_TOKEN');
    } else {
      checks.push({
        id: 'security.auth',
        title: 'Remote access security',
        status: 'ok',
        message: 'Remote access enabled with persisted token authentication',
        details: { tokenFile: tokenFilePath },
      });
    }
  } else if (isRemoteListening && hasAuthToken) {
    checks.push({
      id: 'security.auth',
      title: 'Remote access security',
      status: 'ok',
      message: 'Remote access enabled with environment variable token',
    });
  }

  // Check 13: Remote LAN readiness (host/networkAddresses)
  const runtimeHost = getSnapshotHost(runtimeSnapshot);
  const runtimeNetworkAddresses = getSnapshotNetworkAddresses(runtimeSnapshot);
  const envHost = process.env[MCP_HTTP_HOST_ENV];

  if (runtimeHost) {
    if (isWildcardHost(runtimeHost)) {
      if (runtimeNetworkAddresses.length > 0) {
        checks.push({
          id: 'remote.lan',
          title: 'Remote LAN readiness',
          status: 'ok',
          message: `Remote host listening on ${runtimeHost}; detected LAN IP ${runtimeNetworkAddresses[0]}`,
          details: {
            host: runtimeHost,
            networkAddresses: runtimeNetworkAddresses,
          },
        });
      } else {
        checks.push({
          id: 'remote.lan',
          title: 'Remote LAN readiness',
          status: 'warn',
          message: `Runtime host is ${runtimeHost} but no LAN IPv4 was detected`,
          details: {
            host: runtimeHost,
            networkAddresses: runtimeNetworkAddresses,
            fix: ['Use ipconfig/ifconfig to pick a reachable LAN IP manually in client config'],
          },
        });
      }
    } else {
      checks.push({
        id: 'remote.lan',
        title: 'Remote LAN readiness',
        status: 'ok',
        message: `Runtime host is ${runtimeHost} (local-only mode)`,
        details: {
          host: runtimeHost,
          hint: `Set ${MCP_HTTP_HOST_ENV}=0.0.0.0 and restart Chrome to enable LAN clients`,
          fix: [
            `Set ${MCP_HTTP_HOST_ENV}=0.0.0.0, restart Chrome, then re-run ${COMMAND_NAME} status`,
          ],
        },
      });
    }
  } else if (envHost && isWildcardHost(envHost)) {
    checks.push({
      id: 'remote.lan',
      title: 'Remote LAN readiness',
      status: 'warn',
      message: `${MCP_HTTP_HOST_ENV}=${envHost}, but runtime status is unavailable`,
      details: {
        hint: 'Start/reconnect extension first, then re-run doctor to confirm LAN IP detection.',
      },
    });
  }

  // Compute summary
  const orderedChecks = sortChecks(checks);
  const summary = computeSummary(orderedChecks);
  const ok = summary.error === 0;

  const report: DoctorReport = {
    schemaVersion: SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    ok,
    summary,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: { version: process.version, execPath: process.execPath },
      package: { name: packageName, version: packageVersion, rootDir, distDir },
      command: { canonical: commandInfo.canonical, aliases: commandInfo.aliases },
      nativeHost: { hostName: HOST_NAME, expectedPort: EXPECTED_PORT },
    },
    fixes,
    ...(runtimeConsistency ? { runtimeConsistency } : {}),
    checks: orderedChecks,
    nextSteps: Array.from(new Set(nextSteps)).slice(0, 10),
  };

  return report;
}

/**
 * Run doctor command with console output.
 */
export async function runDoctor(options: DoctorOptions): Promise<number> {
  const report = await collectDoctorReport(options);
  const packageVersion = report.environment.package.version;

  // Output
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`${COMMAND_NAME} doctor v${packageVersion}\n`);
    for (const check of report.checks) {
      console.log(`${statusBadge(check.status)}    ${check.title}: ${check.message}`);
      const fix = (check.details as Record<string, unknown> | undefined)?.fix as
        | string[]
        | undefined;
      if (check.status !== 'ok' && fix && fix.length > 0) {
        console.log(`        Fix: ${fix[0]}`);
      }
    }
    if (report.fixes.length > 0) {
      console.log('\nFix attempts:');
      for (const f of report.fixes) {
        const badge = f.success ? colorText('[OK]', 'green') : colorText('[ERROR]', 'red');
        console.log(`${badge} ${f.description}${f.success ? '' : ` (${f.error})`}`);
      }
    }
    if (options.fix) {
      const verdict = report.runtimeConsistency?.verdict ?? 'unknown';
      const summary = report.runtimeConsistency?.summary ?? 'Runtime consistency unavailable';
      const badge =
        verdict === 'consistent'
          ? colorText('[OK]', 'green')
          : verdict === 'inconsistent'
            ? colorText('[WARN]', 'yellow')
            : colorText('[WARN]', 'yellow');
      console.log(`\n${badge} Runtime consistency after --fix: ${verdict}`);
      console.log(`        ${summary}`);
      if (report.runtimeConsistency?.reasons?.length) {
        for (const reason of report.runtimeConsistency.reasons) {
          console.log(`        Reason: ${reason}`);
        }
      }
    }
    if (report.nextSteps.length > 0) {
      console.log('\nNext steps:');
      report.nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      if (!options.fix) {
        console.log(
          colorText(
            `\nTip: run "${COMMAND_NAME} doctor --fix" to auto-repair these issues.`,
            'yellow',
          ),
        );
      }
    }
  }

  return report.ok ? 0 : 1;
}
