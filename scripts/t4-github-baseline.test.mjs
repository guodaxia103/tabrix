import test from 'node:test';
import assert from 'node:assert/strict';

import {
  estimateTokensFromBytes,
  normalizeWorkflowRunUrl,
  parseCliArgs,
  parseTabrixJsonOutput,
  evaluateSemanticSignal,
  shouldRecoverForcedTabNavigation,
  shouldRetryWorkflowRunDetailShell,
  shouldRetryRepoHomeSnapshot,
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

test('normalizeWorkflowRunUrl accepts absolute and relative workflow run links', () => {
  assert.equal(
    normalizeWorkflowRunUrl('https://github.com/guodaxia103/tabrix/actions/runs/24601534712'),
    'https://github.com/guodaxia103/tabrix/actions/runs/24601534712',
  );
  assert.equal(
    normalizeWorkflowRunUrl('/guodaxia103/tabrix/actions/runs/24601534712'),
    'https://github.com/guodaxia103/tabrix/actions/runs/24601534712',
  );
  assert.equal(normalizeWorkflowRunUrl('https://github.com/guodaxia103/tabrix/actions'), null);
});

test('shouldRecoverForcedTabNavigation only recovers forced new-window reuse onto an existing tab', () => {
  assert.equal(
    shouldRecoverForcedTabNavigation({ usedExistingTab: true }, 123, true),
    true,
  );
  assert.equal(
    shouldRecoverForcedTabNavigation({ usedExistingTab: false }, 123, true),
    false,
  );
  assert.equal(
    shouldRecoverForcedTabNavigation({ usedExistingTab: true }, null, true),
    false,
  );
  assert.equal(
    shouldRecoverForcedTabNavigation({ usedExistingTab: true }, 123, false),
    false,
  );
});

test('shouldRetryWorkflowRunDetailShell detects workflow detail shell snapshots before semantic sampling', () => {
  assert.equal(
    shouldRetryWorkflowRunDetailShell(
      {
        summary: { primaryRegion: 'workflow_run_shell' },
        interactiveElements: [{ name: 'Filter workflow runs' }],
      },
      /summary|show all jobs|jobs/i,
    ),
    true,
  );
  assert.equal(
    shouldRetryWorkflowRunDetailShell(
      {
        summary: { primaryRegion: 'workflow_run_summary' },
        interactiveElements: [{ name: 'Summary' }, { name: 'Jobs' }],
      },
      /summary|show all jobs|jobs/i,
    ),
    false,
  );
});

test('evaluateSemanticSignal does not allow highValueObjects or L0 to loosen the main gate', () => {
  const result = evaluateSemanticSignal(
    {
      interactiveElements: [{ ref: 'ref_noise', role: 'link', name: 'Repository' }],
      candidateActions: [{ actionType: 'click', matchReason: 'interactive clickable candidate from structured snapshot' }],
      highValueObjects: [{ label: 'Summary' }, { label: 'Show all jobs' }],
      L0: { summary: 'monitor view for workflow_run_detail in workflow_run_summary; focus on Summary, Show all jobs.' },
    },
    /summary|show all jobs|jobs/i,
  );

  assert.equal(result.matched, false);
  assert.deepEqual(result.highValueHead, ['Summary', 'Show all jobs']);
  assert.match(result.l0Summary, /Summary/);
});

test('shouldRetryRepoHomeSnapshot detects sparse repo shell captures', () => {
  assert.equal(
    shouldRetryRepoHomeSnapshot({
      page: { title: '提交 · guodaxia103/tabrix' },
      summary: { pageRole: 'repo_home', primaryRegion: 'repo_shell', quality: 'sparse' },
      interactiveElements: [{ role: 'generic', name: '' }],
    }),
    true,
  );
  assert.equal(
    shouldRetryRepoHomeSnapshot({
      page: { title: 'guodaxia103/tabrix' },
      summary: { pageRole: 'repo_home', primaryRegion: 'repo_primary_nav', quality: 'usable' },
      interactiveElements: [{ name: 'Issues' }, { name: 'Pull requests' }, { name: 'Actions' }],
    }),
    false,
  );
});
