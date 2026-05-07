#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = [
  'app/native-server/src/server',
  'app/native-server/src/runtime',
  'app/native-server/src/mcp',
  'app/native-server/src/memory',
];
const CONSOLE_PATTERN = /\bconsole\.(log|warn|error|debug)\b/;

function listTypeScriptFiles(dir) {
  const absoluteDir = path.join(ROOT, dir);
  const files = [];

  for (const entry of readdirSync(absoluteDir)) {
    const absolutePath = path.join(absoluteDir, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(path.relative(ROOT, absolutePath)));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

const violations = [];

for (const dir of TARGET_DIRS) {
  for (const file of listTypeScriptFiles(dir)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (CONSOLE_PATTERN.test(line)) {
        violations.push({
          file: path.relative(ROOT, file).replaceAll(path.sep, '/'),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Bare console.* is not allowed in native-server production paths:');
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: ${violation.text}`);
  }
  process.exit(1);
}

console.log('Console governance check passed: no bare console.* in native-server production paths.');
