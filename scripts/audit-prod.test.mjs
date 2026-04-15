import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSeverity } from './audit-prod.mjs';

test('parseSeverity prefers database_specific severity when present', () => {
  assert.equal(
    parseSeverity({
      database_specific: { severity: 'critical' },
      severity: [{ type: 'CVSS_V3', score: '5.0' }],
    }),
    'CRITICAL',
  );
});

test('parseSeverity falls back to numeric OSV severity entries', () => {
  assert.equal(
    parseSeverity({
      severity: [{ type: 'CVSS_V4', score: '9.8' }],
    }),
    'CRITICAL',
  );
  assert.equal(
    parseSeverity({
      severity: [{ type: 'CVSS_V4', score: '7.1' }],
    }),
    'HIGH',
  );
});

test('parseSeverity fails closed when OSV severity exists but cannot be parsed numerically', () => {
  assert.equal(
    parseSeverity({
      severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
    }),
    'HIGH',
  );
});
