import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyExceptionCategory,
  isBlockingStatus,
  parseRepositoryFromGitRemote,
  parseRunIdFromDetailsUrl,
} from './t4-post-submit-tracker.mjs';

test('parseRepositoryFromGitRemote supports https and ssh style urls', () => {
  assert.deepEqual(parseRepositoryFromGitRemote('https://github.com/guodaxia103/tabrix.git'), {
    owner: 'guodaxia103',
    repo: 'tabrix',
  });
  assert.deepEqual(parseRepositoryFromGitRemote('git@github.com:guodaxia103/tabrix.git'), {
    owner: 'guodaxia103',
    repo: 'tabrix',
  });
});

test('isBlockingStatus treats non-success completed checks as blocking', () => {
  assert.equal(isBlockingStatus('completed', 'success'), false);
  assert.equal(isBlockingStatus('completed', 'skipped'), false);
  assert.equal(isBlockingStatus('completed', 'failure'), true);
  assert.equal(isBlockingStatus('in_progress', null), true);
});

test('classifyExceptionCategory routes quality and product checks', () => {
  assert.equal(classifyExceptionCategory('quality', 'failure'), 'quality');
  assert.equal(classifyExceptionCategory('typecheck', 'failure'), 'quality');
  assert.equal(classifyExceptionCategory('github-baseline-smoke', 'failure'), 'product');
  assert.equal(classifyExceptionCategory('quality', 'timed_out'), 'environment');
});

test('parseRunIdFromDetailsUrl extracts workflow run id', () => {
  assert.equal(
    parseRunIdFromDetailsUrl('https://github.com/guodaxia103/tabrix/actions/runs/24599433506/job/71935477938'),
    24599433506,
  );
  assert.equal(parseRunIdFromDetailsUrl('https://github.com/guodaxia103/tabrix/pull/1'), null);
});
