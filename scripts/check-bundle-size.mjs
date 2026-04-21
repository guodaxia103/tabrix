#!/usr/bin/env node
/**
 * Sidepanel bundle-size gate (B-007).
 *
 * Reads the latest sidepanel bundle from the WXT output directory and
 * fails the CI job when its size exceeds the configured hard threshold.
 * A soft threshold is also checked — when exceeded, the script warns but
 * still exits 0, so size drifts become visible before they hurt.
 *
 * Thresholds are pinned in this file on purpose. Raising them requires
 * a human-reviewed commit that updates the constants below, which
 * matches the workflow in `AGENTS.md` for any size-impacting change.
 *
 * Baselines (do not edit without updating the threshold):
 * - Post-B-006 sidepanel-*.js  : 21.00 kB
 * - Post-B-006 sidepanel-*.css : 18.24 kB
 *
 * Headroom = hard threshold − post-B-006 baseline. Keep it tight: every
 * ~5 kB of unnoticed growth is ~100ms extra cold start on a slow laptop.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUTPUT_ROOT = resolve(
  process.cwd(),
  'app/chrome-extension/.output/chrome-mv3/chunks',
);

const HARD_LIMIT_BYTES = 40 * 1024;
const SOFT_LIMIT_BYTES = 25 * 1024;

const SIDEPANEL_PREFIX = 'sidepanel-';
const SIDEPANEL_SUFFIX = '.js';

function findLatestSidepanel(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { error: `cannot list ${dir}: ${error.message}` };
  }
  const matches = entries.filter(
    (name) => name.startsWith(SIDEPANEL_PREFIX) && name.endsWith(SIDEPANEL_SUFFIX),
  );
  if (matches.length === 0) {
    return { error: `no sidepanel-*.js bundle under ${dir} — did you run pnpm build?` };
  }
  // WXT emits a hash in the filename; when many builds stack up (common
  // locally) keep only the most recently-mtime'd file.
  let winner = null;
  let winnerMtime = 0;
  for (const name of matches) {
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.mtimeMs > winnerMtime) {
      winner = full;
      winnerMtime = stats.mtimeMs;
    }
  }
  if (!winner) {
    return { error: 'no sidepanel bundle found (internal error)' };
  }
  return { path: winner, size: statSync(winner).size };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

const result = findLatestSidepanel(OUTPUT_ROOT);

if (result.error) {
  console.error(`size:check error: ${result.error}`);
  process.exit(2);
}

const { path: bundlePath, size } = result;
const rel = bundlePath.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');

console.log(
  `sidepanel bundle: ${rel} — ${formatBytes(size)} ` +
    `(soft ${formatBytes(SOFT_LIMIT_BYTES)}, hard ${formatBytes(HARD_LIMIT_BYTES)})`,
);

if (size > HARD_LIMIT_BYTES) {
  console.error(
    `size:check FAIL — ${rel} is ${formatBytes(size)}, which exceeds the ` +
      `hard threshold of ${formatBytes(HARD_LIMIT_BYTES)}. Either trim the ` +
      `bundle or update HARD_LIMIT_BYTES in scripts/check-bundle-size.mjs ` +
      `in a reviewed commit (see AGENTS.md).`,
  );
  process.exit(1);
}

if (size > SOFT_LIMIT_BYTES) {
  console.warn(
    `size:check WARN — ${rel} is ${formatBytes(size)}, which exceeds the ` +
      `soft threshold of ${formatBytes(SOFT_LIMIT_BYTES)}. Not failing the ` +
      `build yet, but investigate before size creeps past the hard limit.`,
  );
}

process.exit(0);
