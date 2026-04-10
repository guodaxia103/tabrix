/* global console, process */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SOURCE_DIR = path.resolve('packages/wasm-simd/pkg');
const DEFAULT_TARGET_DIR = path.resolve('app/chrome-extension/workers');
const FILES = ['simd_math.js', 'simd_math_bg.wasm'];

function main() {
  const sourceDir = path.resolve(process.argv[2] ?? DEFAULT_SOURCE_DIR);
  const targetDir = path.resolve(process.argv[3] ?? DEFAULT_TARGET_DIR);

  fs.mkdirSync(targetDir, { recursive: true });

  for (const fileName of FILES) {
    const sourceFile = path.join(sourceDir, fileName);
    const targetFile = path.join(targetDir, fileName);

    if (!fs.existsSync(sourceFile)) {
      throw new Error(`[copy-wasm] Missing source artifact: ${sourceFile}`);
    }

    fs.copyFileSync(sourceFile, targetFile);
    console.log(`[copy-wasm] Copied ${path.relative(process.cwd(), sourceFile)} -> ${path.relative(process.cwd(), targetFile)}`);
  }
}

main();
