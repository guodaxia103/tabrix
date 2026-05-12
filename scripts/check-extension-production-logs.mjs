#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'app/chrome-extension/.output/chrome-mv3');
const GENERATED_DIRS_TO_CHECK = ['content-scripts', 'inject-scripts'];
const GENERATED_ROOT_FILES_TO_CHECK = ['background.js'];
const SOURCE_DIRS_TO_CHECK = ['app/chrome-extension/inject-scripts'];
const VIOLATION_PATTERN =
  /\bconsole\.(log|info|warn|error|debug|trace|table|group|groupCollapsed|groupEnd)\s*\(|\bdebugger\s*;/;

function listJavaScriptFiles(dir, predicate = () => true) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...listJavaScriptFiles(absolutePath, predicate));
      continue;
    }
    if (entry.endsWith('.js') && predicate(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

function shouldCheckGeneratedFile(file) {
  const relativePath = path.relative(OUTPUT_DIR, file).replaceAll(path.sep, '/');
  if (GENERATED_ROOT_FILES_TO_CHECK.includes(relativePath)) {
    return true;
  }
  return GENERATED_DIRS_TO_CHECK.some((dir) => relativePath.startsWith(`${dir}/`));
}

const violations = [];

if (!existsSync(OUTPUT_DIR)) {
  console.error(
    'Extension production output not found. Run `pnpm -C app/chrome-extension build` first.',
  );
  process.exit(1);
}

const filesToCheck = [
  ...listJavaScriptFiles(OUTPUT_DIR, shouldCheckGeneratedFile),
  ...SOURCE_DIRS_TO_CHECK.flatMap((dir) => {
    const absoluteDir = path.join(ROOT, dir);
    return existsSync(absoluteDir) ? listJavaScriptFiles(absoluteDir) : [];
  }),
];

for (const file of filesToCheck) {
  const relativePath = path.relative(ROOT, file).replaceAll(path.sep, '/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (VIOLATION_PATTERN.test(line)) {
      violations.push({
        file: relativePath,
        line: index + 1,
        text: line.trim().slice(0, 240),
      });
    }
  });
}

if (violations.length > 0) {
  console.error('Extension production paths contain executable console/debugger statements:');
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log('Extension production log check passed: no console.* or debugger statements found.');
