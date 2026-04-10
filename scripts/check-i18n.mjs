import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EN_PATH = path.join(ROOT, 'app', 'chrome-extension', '_locales', 'en', 'messages.json');
const ZH_PATH = path.join(ROOT, 'app', 'chrome-extension', '_locales', 'zh_CN', 'messages.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getSortedKeys(obj) {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

function toSet(arr) {
  return new Set(arr);
}

function hasCjk(text) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/u.test(text);
}

function getArgIndexes(message) {
  return [...message.matchAll(/\$ARG(\d+)\$/g)].map((m) => Number(m[1]));
}

function fail(errors) {
  console.error('i18n check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const en = readJson(EN_PATH);
const zh = readJson(ZH_PATH);

const errors = [];
const enKeys = getSortedKeys(en);
const zhKeys = getSortedKeys(zh);
const enKeySet = toSet(enKeys);
const zhKeySet = toSet(zhKeys);

for (const key of enKeys) {
  if (!zhKeySet.has(key)) errors.push(`Missing in zh_CN: ${key}`);
}
for (const key of zhKeys) {
  if (!enKeySet.has(key)) errors.push(`Missing in en: ${key}`);
}

for (const key of enKeys) {
  const enEntry = en[key] || {};
  const zhEntry = zh[key] || {};

  const enMessage = typeof enEntry.message === 'string' ? enEntry.message : '';
  const zhMessage = typeof zhEntry.message === 'string' ? zhEntry.message : '';

  if (!enMessage) errors.push(`Empty en message: ${key}`);
  if (!zhMessage) errors.push(`Empty zh_CN message: ${key}`);

  if (enMessage === key) errors.push(`en message equals key (placeholder leak): ${key}`);
  if (zhMessage === key) errors.push(`zh_CN message equals key (placeholder leak): ${key}`);

  if (hasCjk(enMessage)) errors.push(`CJK chars found in en message: ${key}`);

  const argIndexes = getArgIndexes(enMessage);
  if (argIndexes.length > 0) {
    const placeholders = enEntry.placeholders || {};
    const maxIndex = Math.max(...argIndexes);
    for (let i = 1; i <= maxIndex; i += 1) {
      if (!placeholders[`arg${i}`]) {
        errors.push(`en placeholders missing arg${i}: ${key}`);
      }
    }
  }

  const zhArgIndexes = getArgIndexes(zhMessage);
  if (zhArgIndexes.length > 0) {
    const placeholders = zhEntry.placeholders || {};
    const maxIndex = Math.max(...zhArgIndexes);
    for (let i = 1; i <= maxIndex; i += 1) {
      if (!placeholders[`arg${i}`]) {
        errors.push(`zh_CN placeholders missing arg${i}: ${key}`);
      }
    }
  }
}

if (errors.length > 0) fail(errors);
console.log(`i18n check passed. keys=${enKeys.length}`);
