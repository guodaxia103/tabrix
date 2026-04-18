import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateTokensFromBytes,
  parseCliArgs,
  parseTabrixJsonOutput,
  summarizeInteractiveElements,
  validateStableSnapshotContract,
} from './t4-github-baseline.mjs';

test('estimateTokensFromBytes rounds up with 4-byte heuristic', () => {
  assert.equal(estimateTokensFromBytes(0), 0);
  assert.equal(estimateTokensFromBytes(1), 1);
  assert.equal(estimateTokensFromBytes(4), 1);
  assert.equal(estimateTokensFromBytes(5), 2);
});

test('validateStableSnapshotContract accepts minimal stable schema', () => {
  const result = validateStableSnapshotContract(
    {
      mode: 'compact',
      page: { url: 'https://example.com', title: 'Example', pageType: 'web_page' },
      summary: { pageRole: 'unknown', primaryRegion: 'main', quality: 'usable' },
      interactiveElements: [],
      artifactRefs: [],
    },
    'compact',
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test('validateStableSnapshotContract reports missing required fields', () => {
  const result = validateStableSnapshotContract(
    {
      mode: 'normal',
      page: { url: '', title: 123, pageType: '' },
      summary: null,
      interactiveElements: 'x',
      artifactRefs: {},
    },
    'compact',
  );
  assert.equal(result.passed, false);
  assert.ok(result.failures.some((item) => item.includes('mode mismatch')));
  assert.ok(result.failures.some((item) => item.includes('page.url')));
  assert.ok(result.failures.some((item) => item.includes('interactiveElements')));
});

test('summarizeInteractiveElements extracts names and fallback roles', () => {
  const names = summarizeInteractiveElements(
    {
      interactiveElements: [
        { name: 'Issues' },
        { role: 'button' },
        { name: 'Actions' },
      ],
    },
    2,
  );
  assert.deepEqual(names, ['Issues', 'button']);
});

test('parseTabrixJsonOutput supports prefixed stdout', () => {
  const parsed = parseTabrixJsonOutput('debug\n{\"ok\":true,\"value\":1}\n');
  assert.deepEqual(parsed, { ok: true, value: 1 });
});

test('parseCliArgs keeps defaults and supports non-strict flag', () => {
  const parsed = parseCliArgs(['--owner', 'guodaxia103', '--repo', 'tabrix', '--non-strict']);
  assert.equal(parsed.owner, 'guodaxia103');
  assert.equal(parsed.repo, 'tabrix');
  assert.equal(parsed.strict, false);
});
