#!/usr/bin/env node
/**
 * Sidepanel bundle-size gate (B-007 + B-021).
 *
 * Reads the latest `sidepanel-*.{js,css}` bundles from the WXT output
 * directory and fails the CI job when any exceeds its configured hard
 * threshold. A soft threshold is also checked — when exceeded, the
 * script warns but still exits 0, so size drifts become visible before
 * they hurt.
 *
 * Thresholds are pinned in this file on purpose. Raising them requires
 * a human-reviewed commit that updates the constants below, which
 * matches the workflow in `AGENTS.md` for any size-impacting change.
 *
 * Baselines (do not edit without updating the threshold):
 * - Post-B-006 sidepanel-*.js  : 21.00 kB  (hard 40, soft 25)
 * - Post-B-006 sidepanel-*.css : 18.24 kB  (hard 22, soft 20)
 *
 * Headroom = hard threshold − post-B-006 baseline. Keep it tight: every
 * ~5 kB of unnoticed growth is ~100ms extra cold start on a slow laptop.
 * CSS has a tighter cap because it renders on the critical path and
 * because post-B-006 has already absorbed the filter/search styles.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUTPUT_ROOT = resolve(process.cwd(), 'app/chrome-extension/.output/chrome-mv3');

/**
 * @typedef {Object} Target
 * @property {string} label       human-readable name in logs
 * @property {string} subdir      subdirectory under `.output/chrome-mv3/` (WXT
 *                                splits JS into `chunks/` and CSS into
 *                                `assets/` — see the build log)
 * @property {string} prefix      filename prefix
 * @property {string} suffix      filename suffix
 * @property {number} softLimit   soft threshold in bytes
 * @property {number} hardLimit   hard threshold in bytes
 */

/** @type {readonly Target[]} */
const TARGETS = [
  {
    label: 'sidepanel-*.js',
    subdir: 'chunks',
    prefix: 'sidepanel-',
    suffix: '.js',
    softLimit: 25 * 1024,
    hardLimit: 40 * 1024,
  },
  {
    label: 'sidepanel-*.css',
    subdir: 'assets',
    prefix: 'sidepanel-',
    suffix: '.css',
    softLimit: 20 * 1024,
    hardLimit: 22 * 1024,
  },
];

function findLatestBundle(dir, prefix, suffix) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (error) {
    return { error: `cannot list ${dir}: ${error.message}` };
  }
  const matches = entries.filter((name) => name.startsWith(prefix) && name.endsWith(suffix));
  if (matches.length === 0) {
    return {
      error: `no ${prefix}*${suffix} bundle under ${dir} — did you run pnpm build?`,
    };
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
    return { error: `no ${prefix}*${suffix} bundle found (internal error)` };
  }
  return { path: winner, size: statSync(winner).size };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function relative(full) {
  return full.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
}

let exitCode = 0;

for (const target of TARGETS) {
  const dir = join(OUTPUT_ROOT, target.subdir);
  const result = findLatestBundle(dir, target.prefix, target.suffix);
  if (result.error) {
    console.error(`size:check error (${target.label}): ${result.error}`);
    exitCode = Math.max(exitCode, 2);
    continue;
  }
  const { path: bundlePath, size } = result;
  const rel = relative(bundlePath);
  console.log(
    `[${target.label}] ${rel} — ${formatBytes(size)} ` +
      `(soft ${formatBytes(target.softLimit)}, hard ${formatBytes(target.hardLimit)})`,
  );

  if (size > target.hardLimit) {
    console.error(
      `size:check FAIL — ${rel} is ${formatBytes(size)}, which exceeds the ` +
        `hard threshold of ${formatBytes(target.hardLimit)} for ${target.label}. ` +
        `Either trim the bundle or update the threshold in scripts/check-bundle-size.mjs ` +
        `in a reviewed commit (see AGENTS.md).`,
    );
    exitCode = Math.max(exitCode, 1);
    continue;
  }

  if (size > target.softLimit) {
    console.warn(
      `size:check WARN — ${rel} is ${formatBytes(size)}, which exceeds the ` +
        `soft threshold of ${formatBytes(target.softLimit)} for ${target.label}. ` +
        `Not failing the build yet, but investigate before size creeps past the hard limit.`,
    );
  }
}

process.exit(exitCode);
