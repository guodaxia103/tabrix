import { readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const self = basename(fileURLToPath(import.meta.url));
const testFiles = readdirSync(testDir)
  .filter((name) => name.endsWith('.mjs') && name !== self)
  .sort();

for (const testFile of testFiles) {
  await import(pathToFileURL(resolve(testDir, testFile)).href);
}

console.log(
  JSON.stringify({
    status: 'PASS',
    contractFiles: testFiles,
  }),
);
