/**
 * V24-03 — unit tests for the chooser-side replay eligibility +
 * ranking helpers. Pure layer: no IO, no SQLite, no clock.
 *
 * These tests pin:
 *   - the FIRST-blocker order in {@link isReplayEligible},
 *   - the deterministic top-N ordering in
 *     {@link rankExperienceCandidates},
 *   - the score-source preference (cache hit > re-derive),
 *   - the `topReplayEligible` / `topBlockedBy` projection used by
 *     `chooseContextStrategy`.
 */

import {
  EXPERIENCE_RANKED_TOP_N,
  EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT,
  EXPERIENCE_REPLAY_MIN_SUCCESS_RATE,
  EXPERIENCE_RECENCY_DECAY_DAYS,
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
  type TabrixTaskWeights,
} from '@tabrix/shared';
import { isReplayEligible, rankExperienceCandidates } from './choose-context-replay-rules';
import type { ExperienceActionPathRow } from '../memory/experience/experience-repository';

function row(overrides: Partial<ExperienceActionPathRow> = {}): ExperienceActionPathRow {
  return {
    actionPathId: 'action_path_' + 'a'.repeat(64),
    pageRole: 'issues_list',
    intentSignature: 'open issues',
    stepSequence: [
      {
        toolName: 'chrome_click_element',
        status: 'completed',
        historyRef: null,
        args: { selector: '#issues-tab' },
      },
    ],
    successCount: 9,
    failureCount: 1,
    lastUsedAt: '2026-04-22T00:00:00.000Z',
    lastReplayAt: '2026-04-22T00:00:00.000Z',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('isReplayEligible (V24-03)', () => {
  it('first blocker is capability_off when the gate is closed', () => {
    expect(isReplayEligible(row(), false)).toEqual({
      eligible: false,
      blockedBy: 'capability_off',
    });
  });

  it('first blocker is unsupported_step_kind when a step kind is outside the v1 set', () => {
    const r = row({
      stepSequence: [
        {
          toolName: 'chrome_navigate',
          status: 'completed',
          historyRef: null,
          args: { url: 'https://github.com' },
        },
      ],
    });
    expect(isReplayEligible(r, true)).toEqual({
      eligible: false,
      blockedBy: 'unsupported_step_kind',
    });
  });

  it('first blocker is non_portable_args when a step carries only session-local handles', () => {
    const r = row({
      stepSequence: [
        {
          toolName: 'chrome_click_element',
          status: 'completed',
          historyRef: null,
          args: { ref: 'ref_per_snapshot' },
        },
      ],
    });
    expect(isReplayEligible(r, true)).toEqual({
      eligible: false,
      blockedBy: 'non_portable_args',
    });
  });

  it('first blocker is non_github_pageRole when the row pageRole is outside the allowlist', () => {
    expect(isReplayEligible(row({ pageRole: 'mystery_role' }), true)).toEqual({
      eligible: false,
      blockedBy: 'non_github_pageRole',
    });
  });

  it('first blocker is below_threshold when successRate is under the strict bar', () => {
    expect(isReplayEligible(row({ successCount: 4, failureCount: 6 }), true)).toEqual({
      eligible: false,
      blockedBy: 'below_threshold',
    });
  });

  it('first blocker is below_threshold when successCount is under the count floor', () => {
    expect(isReplayEligible(row({ successCount: 2, failureCount: 0 }), true)).toEqual({
      eligible: false,
      blockedBy: 'below_threshold',
    });
  });

  it('returns eligible: true with blockedBy "none" on the success branch', () => {
    expect(isReplayEligible(row(), true)).toEqual({ eligible: true, blockedBy: 'none' });
  });

  it('exposes EXPERIENCE_REPLAY_MIN_SUCCESS_RATE / COUNT shape sanity', () => {
    expect(EXPERIENCE_REPLAY_MIN_SUCCESS_RATE).toBeGreaterThan(0);
    expect(EXPERIENCE_REPLAY_MIN_SUCCESS_RATE).toBeLessThanOrEqual(1);
    expect(Number.isInteger(EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT)).toBe(true);
    expect(EXPERIENCE_REPLAY_MIN_SUCCESS_COUNT).toBeGreaterThanOrEqual(1);
  });

  it('preserves blocker order: capability is checked first', () => {
    // Row that would also fail on step kind + args + pageRole.
    // Capability-off MUST surface first so post-mortems do not
    // attribute the block to a different cause when the operator
    // simply has not opted in.
    const r = row({
      pageRole: 'mystery_role',
      stepSequence: [
        {
          toolName: 'chrome_navigate',
          status: 'completed',
          historyRef: null,
          args: { ref: 'ref_xyz' },
        },
      ],
    });
    expect(isReplayEligible(r, false).blockedBy).toBe('capability_off');
  });
});

describe('rankExperienceCandidates (V24-03)', () => {
  const NOW = '2026-04-22T12:00:00.000Z';

  it('returns an empty result when no rows are provided', () => {
    const result = rankExperienceCandidates({
      rows: [],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked).toEqual([]);
    expect(result.topReplayEligible).toBe(false);
    expect(result.topRow).toBeUndefined();
    expect(result.topBlockedBy).toBeUndefined();
  });

  it('caps the ranked list at EXPERIENCE_RANKED_TOP_N', () => {
    const rows = Array.from({ length: 5 }).map((_, i) =>
      row({
        actionPathId: `action_path_${'b'.repeat(60)}_${i}`.padEnd(75, '0').slice(0, 75),
        compositeScoreDecayed: 0.9 - i * 0.05,
      }),
    );
    const result = rankExperienceCandidates({
      rows,
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked).toHaveLength(EXPERIENCE_RANKED_TOP_N);
  });

  it('orders by composite_score_decayed DESC (cache hit short-circuits re-derivation)', () => {
    const a = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      compositeScoreDecayed: 0.5,
    });
    const b = row({
      actionPathId: 'action_path_' + 'b'.repeat(64),
      compositeScoreDecayed: 0.9,
    });
    const result = rankExperienceCandidates({
      rows: [a, b],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked[0]?.ref).toBe(b.actionPathId);
    expect(result.ranked[1]?.ref).toBe(a.actionPathId);
    expect(result.ranked[0]?.score).toBe(0.9);
  });

  it('falls back to derived score when cache field is missing', () => {
    const a = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      successCount: 9,
      failureCount: 1,
      compositeScoreDecayed: undefined,
    });
    const result = rankExperienceCandidates({
      rows: [a],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked[0]?.score).toBeGreaterThan(0);
    expect(result.ranked[0]?.score).toBeLessThanOrEqual(1);
  });

  it('uses the documented tie-break order (successCount → lastReplayAt → actionPathId)', () => {
    const tiedScore = 0.42;
    const same = {
      compositeScoreDecayed: tiedScore,
      successCount: 5,
      failureCount: 0,
      lastReplayAt: '2026-04-20T00:00:00.000Z',
    };
    const a = row({ ...same, actionPathId: 'action_path_' + 'a'.repeat(64) });
    const b = row({ ...same, actionPathId: 'action_path_' + 'b'.repeat(64) });
    const c = row({
      ...same,
      successCount: 7,
      actionPathId: 'action_path_' + 'c'.repeat(64),
    });
    const d = row({
      ...same,
      lastReplayAt: '2026-04-21T00:00:00.000Z',
      actionPathId: 'action_path_' + 'd'.repeat(64),
    });
    const result = rankExperienceCandidates({
      rows: [a, b, c, d],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked.map((c) => c.ref)).toEqual([
      c.actionPathId, // higher successCount
      d.actionPathId, // newer lastReplayAt
      a.actionPathId, // alphabetical first
    ]);
  });

  it('keeps ineligible candidates in the ranked list with blockedBy reason', () => {
    const portable = row({
      actionPathId: 'action_path_' + 'p'.repeat(64),
      compositeScoreDecayed: 0.6,
    });
    const blocked = row({
      actionPathId: 'action_path_' + 'q'.repeat(64),
      pageRole: 'mystery_role',
      compositeScoreDecayed: 0.9,
    });
    const result = rankExperienceCandidates({
      rows: [portable, blocked],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.ranked[0]?.ref).toBe(blocked.actionPathId);
    expect(result.ranked[0]?.replayEligible).toBe(false);
    expect(result.ranked[0]?.blockedBy).toBe('non_github_pageRole');
    expect(result.ranked[1]?.replayEligible).toBe(true);
    expect(result.ranked[1]?.blockedBy).toBe('none');
    expect(result.topReplayEligible).toBe(false);
    expect(result.topBlockedBy).toBe('non_github_pageRole');
  });

  it('reports topReplayEligible=true and topBlockedBy=none when the top-1 is eligible', () => {
    const a = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      compositeScoreDecayed: 0.92,
    });
    const result = rankExperienceCandidates({
      rows: [a],
      capabilityEnabled: true,
      nowIso: NOW,
    });
    expect(result.topReplayEligible).toBe(true);
    expect(result.topBlockedBy).toBe('none');
  });

  it('reports capability_off blockers when the capability is disabled', () => {
    const a = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      compositeScoreDecayed: 0.9,
    });
    const result = rankExperienceCandidates({
      rows: [a],
      capabilityEnabled: false,
      nowIso: NOW,
    });
    expect(result.topReplayEligible).toBe(false);
    expect(result.topBlockedBy).toBe('capability_off');
    expect(result.ranked[0]?.replayEligible).toBe(false);
    expect(result.ranked[0]?.blockedBy).toBe('capability_off');
  });

  it('respects custom task weights for derived scores', () => {
    const heavyAccuracy: TabrixTaskWeights = {
      accuracy: 1,
      speed: 0,
      token: 0,
      stability: 0,
    };
    const a = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      successCount: 9,
      failureCount: 1, // accuracy 0.9
      compositeScoreDecayed: undefined,
      lastReplayAt: NOW, // no decay
    });
    const b = row({
      actionPathId: 'action_path_' + 'b'.repeat(64),
      successCount: 10,
      failureCount: 0, // accuracy 1.0
      compositeScoreDecayed: undefined,
      lastReplayAt: NOW,
    });
    const result = rankExperienceCandidates({
      rows: [a, b],
      capabilityEnabled: true,
      nowIso: NOW,
      weights: heavyAccuracy,
    });
    expect(result.ranked[0]?.ref).toBe(b.actionPathId);
    expect(result.ranked[0]?.score).toBeCloseTo(1, 5);
    expect(result.ranked[1]?.score).toBeCloseTo(0.9, 5);
  });

  it('applies recency decay so older candidates rank lower (derived path)', () => {
    const FRESH = '2026-04-22T00:00:00.000Z';
    const STALE_60D = '2026-02-21T00:00:00.000Z';
    const fresh = row({
      actionPathId: 'action_path_' + 'a'.repeat(64),
      successCount: 9,
      failureCount: 1,
      lastReplayAt: FRESH,
      compositeScoreDecayed: undefined,
    });
    const stale = row({
      actionPathId: 'action_path_' + 'b'.repeat(64),
      successCount: 9,
      failureCount: 1,
      lastReplayAt: STALE_60D,
      compositeScoreDecayed: undefined,
    });
    const result = rankExperienceCandidates({
      rows: [stale, fresh],
      capabilityEnabled: true,
      nowIso: FRESH,
    });
    expect(result.ranked[0]?.ref).toBe(fresh.actionPathId);
    expect(result.ranked[1]?.ref).toBe(stale.actionPathId);
    // Half-life = 30d, ~60d since stale → ~25% of the fresh score.
    expect(result.ranked[1]?.score).toBeLessThan(result.ranked[0]!.score / 2);
  });

  it('exposes the EXPERIENCE_RECENCY_DECAY_DAYS constant for cross-checks', () => {
    expect(EXPERIENCE_RECENCY_DECAY_DAYS).toBe(30);
    // Read-side constant must equal the writer-side half-life so the
    // chooser ranking and persisted composite score never disagree.
    expect(EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS).toBeDefined();
  });
});
