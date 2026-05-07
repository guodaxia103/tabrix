import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const declaration = readFileSync(resolve(testDir, '../dist/index.d.ts'), 'utf8');

// These shared surfaces are type/interface contracts, not runtime values.
// The honest contract check is that the package build emits their declarations.
const expectedDeclarationFragments = [
  'type BridgeWsMessage',
  'interface BridgeObservationMessage',
  'type ObservationKind',
  'interface BrowserFactSnapshot',
  'interface BrowserFactSnapshotEnvelope',
  'type ReadPageRequestedLayer',
  'interface ReadPageCompactSnapshot',
  'interface ReadPageVisibleRegionRows',
  'type MemoryPersistenceMode',
  'interface MemorySessionSummary',
  'interface MemoryReadSuccess',
  'interface MemoryReadError',
];

for (const fragment of expectedDeclarationFragments) {
  assert.ok(declaration.includes(fragment), `dist/index.d.ts must include "${fragment}"`);
}

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'declarations',
    checkedFragments: expectedDeclarationFragments.length,
  }),
);
