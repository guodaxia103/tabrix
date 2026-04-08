#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');
const examplePath = path.join(projectRoot, '.env.example');
const marker = 'CHROME_EXTENSION_KEY=';

function loadExistingKey() {
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(marker) && !entry.includes('YOUR_PRIVATE_KEY_HERE'));
  if (!line) return null;
  const value = line.slice(marker.length).trim();
  return value || null;
}

function generateKey() {
  return crypto.randomBytes(96).toString('base64');
}

function ensureEnvFile() {
  if (fs.existsSync(envPath)) return;
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    return;
  }
  fs.writeFileSync(envPath, `${marker}YOUR_PRIVATE_KEY_HERE\n`, 'utf8');
}

function writeKey(key) {
  ensureEnvFile();
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.trim().startsWith(marker)) {
      replaced = true;
      return `${marker}${key}`;
    }
    return line;
  });

  if (!replaced) {
    updated.push(`${marker}${key}`);
  }

  fs.writeFileSync(envPath, `${updated.filter((line) => line !== undefined).join('\n').trim()}\n`, 'utf8');
}

function main() {
  const existing = loadExistingKey();
  if (existing) {
    console.log('Chrome extension key already present');
    return;
  }

  const key = generateKey();
  writeKey(key);
  console.log(`Generated local CHROME_EXTENSION_KEY at ${envPath}`);
}

main();
