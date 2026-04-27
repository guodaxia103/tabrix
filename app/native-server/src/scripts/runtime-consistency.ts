import fs from 'fs';
import path from 'path';
import {
  computeExtensionIdFromKey,
  discoverLoadedExtensionOrigins,
  type DetectedExtensionOrigin,
} from './utils';
import { daemonStatus, getDaemonRuntimePaths } from './daemon';

export type RuntimeConsistencyVerdict = 'consistent' | 'inconsistent' | 'unknown';

/**
 * V26-FIX-09 — flat closed-enum marker that maps {@link RuntimeConsistencyVerdict}
 * onto the vocabulary the v2.6 evidence contract uses
 * (`consistent | stale | unknown`). The original `verdict` enum is
 * retained for backward compatibility with existing doctor / status
 * consumers; `marker` is the field a Gate B consumer should grep for
 * when answering "is the runtime stale?".
 *
 * Mapping is intentionally lossless:
 *   - `verdict='consistent'`   → `marker='consistent'`
 *   - `verdict='inconsistent'` → `marker='stale'`
 *   - `verdict='unknown'`      → `marker='unknown'`
 */
export type RuntimeConsistencyMarker = 'consistent' | 'stale' | 'unknown';

export interface RuntimeConsistencySnapshot {
  verdict: RuntimeConsistencyVerdict;
  /** V26-FIX-09 — flat alias of {@link verdict} using the v2.6 evidence vocabulary. */
  marker: RuntimeConsistencyMarker;
  summary: string;
  reasons: string[];
  cli: {
    sourcePath: string | null;
    workspaceCliPath: string;
    workspaceCliExists: boolean;
    matchesWorkspaceBuild: boolean | null;
  };
  daemon: {
    running: boolean;
    pid: number | null;
    healthy: boolean;
    startedAt: string | null;
    pidFile: string;
    entryPath: string | null;
  };
  nativeDist: {
    cliPath: string;
    exists: boolean;
    modifiedAt: string | null;
  };
  extensionBuild: {
    buildDir: string | null;
    manifestPath: string | null;
    backgroundPath: string | null;
    version: string | null;
    extensionId: string | null;
    buildId: string | null;
    builtAt: string | null;
    loadedPath: string | null;
    loadedMatchesBuild: boolean | null;
  };
}

interface ExtensionBuildInfo {
  buildDir: string | null;
  manifestPath: string | null;
  backgroundPath: string | null;
  version: string | null;
  extensionId: string | null;
  buildId: string | null;
  builtAtMs: number | null;
}

function normalizeComparablePath(filePath: string): string {
  let resolvedPath = filePath;
  try {
    resolvedPath =
      typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native(filePath)
        : fs.realpathSync(filePath);
  } catch {
    resolvedPath = filePath;
  }

  const normalized = path.normalize(resolvedPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toIsoOrNull(value: number | null | undefined): string | null {
  if (!Number.isFinite(value)) return null;
  return new Date(Number(value)).toISOString();
}

function parseExtensionBuildInfo(): ExtensionBuildInfo {
  const candidateBuildDirs = Array.from(
    new Set(
      [
        path.resolve(__dirname, '..', '..', '..', 'chrome-extension', '.output', 'chrome-mv3'),
        path.resolve(process.cwd(), 'app', 'chrome-extension', '.output', 'chrome-mv3'),
        path.resolve(process.cwd(), 'chrome-extension', '.output', 'chrome-mv3'),
      ].map((entry) => path.resolve(entry)),
    ),
  );

  for (const buildDir of candidateBuildDirs) {
    const manifestPath = path.join(buildDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      const version = typeof manifest.version === 'string' ? manifest.version : null;
      const key = typeof manifest.key === 'string' ? manifest.key : null;
      const extensionId = key ? computeExtensionIdFromKey(key) : null;

      const backgroundPath = path.join(buildDir, 'background.js');
      const manifestMtime = fs.statSync(manifestPath).mtimeMs;
      const backgroundMtime = fs.existsSync(backgroundPath)
        ? fs.statSync(backgroundPath).mtimeMs
        : 0;
      const builtAtMs = Math.max(manifestMtime, backgroundMtime || 0);
      const buildId = `${version || 'unknown'}-${(extensionId || 'unknown').slice(0, 8)}-${Math.floor(builtAtMs)}`;

      return {
        buildDir,
        manifestPath,
        backgroundPath: fs.existsSync(backgroundPath) ? backgroundPath : null,
        version,
        extensionId,
        buildId,
        builtAtMs: Number.isFinite(builtAtMs) ? builtAtMs : null,
      };
    } catch {
      // Try next candidate.
    }
  }

  return {
    buildDir: null,
    manifestPath: null,
    backgroundPath: null,
    version: null,
    extensionId: null,
    buildId: null,
    builtAtMs: null,
  };
}

function resolveLoadedExtensionPath(buildInfo: ExtensionBuildInfo): DetectedExtensionOrigin | null {
  const discovered = discoverLoadedExtensionOrigins().detected;
  if (discovered.length === 0) return null;
  if (buildInfo.extensionId) {
    const exact = discovered.find((entry) => entry.id === buildInfo.extensionId);
    if (exact) return exact;
  }
  return discovered[0] || null;
}

export async function collectRuntimeConsistencySnapshot(): Promise<RuntimeConsistencySnapshot> {
  const daemon = await daemonStatus();
  const daemonPaths = getDaemonRuntimePaths();
  const buildInfo = parseExtensionBuildInfo();
  const loaded = resolveLoadedExtensionPath(buildInfo);

  const cliSourcePath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  const workspaceCliPath = path.resolve(process.cwd(), 'app', 'native-server', 'dist', 'cli.js');
  const workspaceCliExists = fs.existsSync(workspaceCliPath);
  const cliMatchesWorkspaceBuild =
    workspaceCliExists && cliSourcePath
      ? normalizeComparablePath(cliSourcePath) === normalizeComparablePath(workspaceCliPath)
      : null;

  const nativeDistCliPath = path.resolve(__dirname, '..', 'cli.js');
  const nativeDistExists = fs.existsSync(nativeDistCliPath);
  const nativeDistModifiedAt = nativeDistExists
    ? toIsoOrNull(fs.statSync(nativeDistCliPath).mtimeMs)
    : null;

  const loadedPath = loaded?.path ? path.resolve(loaded.path) : null;
  const loadedMatchesBuild =
    buildInfo.buildDir && loadedPath
      ? normalizeComparablePath(loadedPath).startsWith(normalizeComparablePath(buildInfo.buildDir))
      : null;

  const reasons: string[] = [];
  if (cliMatchesWorkspaceBuild === false) {
    reasons.push('CLI source path does not match workspace dist/cli.js');
  }
  if (loadedMatchesBuild === false) {
    reasons.push('Loaded extension path does not match current workspace build output');
  }

  let verdict: RuntimeConsistencyVerdict = 'unknown';
  if (reasons.length > 0) {
    verdict = 'inconsistent';
  } else {
    const cliVerified = workspaceCliExists ? cliMatchesWorkspaceBuild === true : false;
    const extensionVerified = buildInfo.buildDir ? loadedMatchesBuild === true : false;
    if (cliVerified && extensionVerified) {
      verdict = 'consistent';
    }
  }

  const summary =
    verdict === 'consistent'
      ? 'Runtime instance matches current workspace build.'
      : verdict === 'inconsistent'
        ? 'Runtime instance does not match current workspace build.'
        : 'Runtime consistency cannot be fully verified (missing workspace/runtime markers).';

  const marker: RuntimeConsistencyMarker =
    verdict === 'consistent' ? 'consistent' : verdict === 'inconsistent' ? 'stale' : 'unknown';

  return {
    verdict,
    marker,
    summary,
    reasons,
    cli: {
      sourcePath: cliSourcePath,
      workspaceCliPath,
      workspaceCliExists,
      matchesWorkspaceBuild: cliMatchesWorkspaceBuild,
    },
    daemon: {
      running: daemon.running,
      pid: daemon.pid,
      healthy: daemon.healthy,
      startedAt: toIsoOrNull(daemon.startedAt),
      pidFile: daemonPaths.pidFile,
      entryPath: daemon.entryPath || daemonPaths.entryPath,
    },
    nativeDist: {
      cliPath: nativeDistCliPath,
      exists: nativeDistExists,
      modifiedAt: nativeDistModifiedAt,
    },
    extensionBuild: {
      buildDir: buildInfo.buildDir,
      manifestPath: buildInfo.manifestPath,
      backgroundPath: buildInfo.backgroundPath,
      version: buildInfo.version,
      extensionId: buildInfo.extensionId,
      buildId: buildInfo.buildId,
      builtAt: toIsoOrNull(buildInfo.builtAtMs),
      loadedPath,
      loadedMatchesBuild,
    },
  };
}
