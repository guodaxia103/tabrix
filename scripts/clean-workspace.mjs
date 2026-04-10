/* global console, process */

import fs from 'node:fs';
import path from 'node:path';

const MODE_TARGETS = {
  dist: ['dist', '.turbo'],
  modules: ['node_modules'],
};

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!mode || !(mode in MODE_TARGETS)) {
    throw new Error(`Usage: node scripts/clean-workspace.mjs <${Object.keys(MODE_TARGETS).join('|')}> [--root <path>]`);
  }

  let rootDir = process.cwd();
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--root') {
      rootDir = path.resolve(rest[index + 1] ?? '');
      index += 1;
    }
  }

  return { mode, rootDir };
}

function getWorkspaceDirs(rootDir) {
  const workspaceDirs = [rootDir];

  for (const parent of ['app', 'packages']) {
    const parentDir = path.join(rootDir, parent);
    if (!fs.existsSync(parentDir)) continue;

    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        workspaceDirs.push(path.join(parentDir, entry.name));
      }
    }
  }

  return workspaceDirs;
}

function removeDir(targetDir) {
  if (!fs.existsSync(targetDir)) return { status: 'missing' };

  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { status: 'removed' };
  } catch (error) {
    return { status: 'failed', error };
  }
}

function main() {
  const { mode, rootDir } = parseArgs(process.argv.slice(2));
  const targets = MODE_TARGETS[mode];
  const workspaceDirs = getWorkspaceDirs(rootDir);
  const removed = [];
  const failed = [];

  for (const workspaceDir of workspaceDirs) {
    for (const target of targets) {
      const targetDir = path.join(workspaceDir, target);
      const result = removeDir(targetDir);
      if (result.status === 'removed') {
        removed.push(path.relative(rootDir, targetDir) || '.');
      } else if (result.status === 'failed') {
        failed.push({
          target: path.relative(rootDir, targetDir) || '.',
          error: result.error,
        });
      }
    }
  }

  if (removed.length === 0) {
    console.log(`[clean-workspace] No ${mode} directories found under ${rootDir}`);
    return;
  }

  for (const target of removed) {
    console.log(`[clean-workspace] Removed ${target}`);
  }

  for (const entry of failed) {
    const message = entry.error instanceof Error ? entry.error.message : String(entry.error);
    console.warn(`[clean-workspace] Skipped ${entry.target}: ${message}`);
  }
}

main();
