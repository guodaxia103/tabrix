/**
 * Unit tests for V24-01 additions to {@link ExperienceRepository}.
 *
 * Scope of THIS file: `findActionPathById` only. The rest of the
 * repository is exercised through `experience-aggregator.test.ts` and
 * `experience-suggest.test.ts`.
 *
 * SoT: `docs/B_EXPERIENCE_REPLAY_BRIEF_V1.md` §7 + plan commit 2.
 */

import { openMemoryDb } from '../db/client';
import { ExperienceRepository } from './experience-repository';

interface RepoFixture {
  repo: ExperienceRepository;
  close: () => void;
}

function fresh(): RepoFixture {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  return { repo: new ExperienceRepository(db), close: () => db.close() };
}

const VALID_ID_A = 'action_path_' + 'a'.repeat(64);
const VALID_ID_B = 'action_path_' + 'b'.repeat(64);

function seedRow(repo: ExperienceRepository, id: string, lastUsedAt = '2026-04-22T00:00:00.000Z') {
  repo.upsertActionPath({
    actionPathId: id,
    pageRole: 'issues_list',
    intentSignature: 'open issues',
    stepSequence: [
      { toolName: 'chrome_click_element', status: 'ok', historyRef: 'h_step_1' },
      { toolName: 'chrome_fill_or_select', status: 'ok', historyRef: 'h_step_2' },
    ],
    successDelta: 3,
    failureDelta: 1,
    lastUsedAt,
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: lastUsedAt,
  });
}

describe('ExperienceRepository#findActionPathById (V24-01)', () => {
  it('returns the row matching an existing actionPathId', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row).toBeDefined();
      expect(row?.actionPathId).toBe(VALID_ID_A);
      expect(row?.pageRole).toBe('issues_list');
      expect(row?.intentSignature).toBe('open issues');
      expect(row?.successCount).toBe(3);
      expect(row?.failureCount).toBe(1);
      expect(row?.stepSequence).toHaveLength(2);
      expect(row?.stepSequence[0]).toEqual({
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h_step_1',
      });
      expect(row?.lastUsedAt).toBe('2026-04-22T00:00:00.000Z');
    } finally {
      fx.close();
    }
  });

  it('returns undefined for a non-existent actionPathId (stale-id safe)', () => {
    const fx = fresh();
    try {
      // Empty DB.
      expect(fx.repo.findActionPathById(VALID_ID_A)).toBeUndefined();

      // Populated DB but mismatched id.
      seedRow(fx.repo, VALID_ID_A);
      expect(fx.repo.findActionPathById(VALID_ID_B)).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it('does not match by partial / prefix string (point-lookup, not LIKE)', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      // Prefix should not match.
      expect(fx.repo.findActionPathById('action_path_')).toBeUndefined();
      // Truncated id should not match.
      expect(fx.repo.findActionPathById(VALID_ID_A.slice(0, -1))).toBeUndefined();
      // SQL-injection-ish placeholder; must not return anything.
      expect(fx.repo.findActionPathById("' OR 1=1 --")).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it('reflects compounded counters after a subsequent upsert (used by replay-session aggregator)', () => {
    const fx = fresh();
    try {
      seedRow(fx.repo, VALID_ID_A);
      // Simulate an aggregator pass projecting a successful replay
      // back to the original row (brief §7).
      fx.repo.upsertActionPath({
        actionPathId: VALID_ID_A,
        pageRole: 'issues_list',
        intentSignature: 'open issues',
        stepSequence: [
          { toolName: 'chrome_click_element', status: 'ok', historyRef: 'h_step_1' },
          { toolName: 'chrome_fill_or_select', status: 'ok', historyRef: 'h_step_2' },
        ],
        successDelta: 1,
        failureDelta: 0,
        lastUsedAt: '2026-04-23T00:00:00.000Z',
        createdAt: '2026-04-20T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      });
      const row = fx.repo.findActionPathById(VALID_ID_A);
      expect(row?.successCount).toBe(4);
      expect(row?.failureCount).toBe(1);
      expect(row?.lastUsedAt).toBe('2026-04-23T00:00:00.000Z');
    } finally {
      fx.close();
    }
  });
});
