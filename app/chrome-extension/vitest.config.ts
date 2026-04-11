import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Match WXT's path aliases from .wxt/tsconfig.json
      '@': rootDir,
      '~': rootDir,
      // Mock hnswlib-wasm-static to avoid native module issues in tests
      'hnswlib-wasm-static': `${rootDir}/tests/__mocks__/hnswlib-wasm-static.ts`,
      // Mock transformers to avoid pulling in sharp/native runtime dependencies in unit tests
      '@xenova/transformers': `${rootDir}/tests/__mocks__/transformers.ts`,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', '.output', 'dist', '.wxt'],
    setupFiles: ['tests/vitest.setup.ts'],
    environmentOptions: {
      jsdom: {
        // Provide a stable URL for anchor/href tests
        url: 'https://example.com/',
      },
    },
    // Auto-cleanup mocks between tests
    clearMocks: true,
    restoreMocks: true,
    // TypeScript support via esbuild (faster than ts-jest)
    typecheck: {
      enabled: false, // Run separately with vue-tsc
    },
    onConsoleLog(log) {
      const expectedNoiseMarkers = [
        '[AgentServer] SSE error:',
        '[AgentServer] Reconnecting in',
        'Failed to connect to native host',
        'Native connection disconnected',
        '[RecordingSession] Unknown step type',
        '[NativeHost]',
        '[Recovery]',
      ];
      if (expectedNoiseMarkers.some((marker) => log.includes(marker))) {
        return false;
      }
    },
  },
});
