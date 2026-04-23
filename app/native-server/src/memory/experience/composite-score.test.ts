/**
 * Unit tests for the V24-02 pure composite-score module.
 *
 * Coverage matrix:
 *   1. projectCompositeComponents — degenerate, normal, partial inputs.
 *   2. computeRawComposite — baseline weights, custom weights,
 *      counts vs probabilities equivalence, all-zero weight fallback.
 *   3. applyRecencyDecay — no decay before half-life, half decay AT
 *      half-life, monotonic, missing/future timestamp short-circuit.
 *   4. computeDecayedComposite — full pipeline.
 *   5. SessionCompositeScoreWriter — happy path + isolation on
 *      repository failure + isolation when warning-row write also throws.
 */

import {
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
  EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS,
  EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS,
} from '@tabrix/shared';
import {
  SessionCompositeScoreWriter,
  applyRecencyDecay,
  computeDecayedComposite,
  computeRawComposite,
  projectCompositeComponents,
  type CompositeScoreComponents,
} from './composite-score';

const ZERO: CompositeScoreComponents = { accuracy: 0, speed: 0, token: 0, stability: 0 };
const PERFECT: CompositeScoreComponents = { accuracy: 1, speed: 1, token: 1, stability: 1 };

describe('projectCompositeComponents', () => {
  it('maps all-zero / missing inputs to zeros (no NaN)', () => {
    const c = projectCompositeComponents({});
    expect(c).toEqual(ZERO);
  });

  it('derives accuracy + stability from success/failure counts', () => {
    const c = projectCompositeComponents({ successCount: 3, failureCount: 1 });
    expect(c.accuracy).toBeCloseTo(0.75, 5);
    expect(c.stability).toBeCloseTo(0.75, 5);
  });

  it('derives speed from elapsedMs / budgetMs (clamped to [0,1])', () => {
    expect(projectCompositeComponents({ elapsedMs: 0, budgetMs: 1000 }).speed).toBe(1);
    expect(projectCompositeComponents({ elapsedMs: 500, budgetMs: 1000 }).speed).toBeCloseTo(
      0.5,
      5,
    );
    expect(projectCompositeComponents({ elapsedMs: 2000, budgetMs: 1000 }).speed).toBe(0);
  });

  it('clamps token-saving ratio to [0,1]', () => {
    expect(projectCompositeComponents({ tokenSavingRatio: -1 }).token).toBe(0);
    expect(projectCompositeComponents({ tokenSavingRatio: 0.4 }).token).toBeCloseTo(0.4, 5);
    expect(projectCompositeComponents({ tokenSavingRatio: 5 }).token).toBe(1);
  });

  it('honours an explicit stability override', () => {
    const c = projectCompositeComponents({ successCount: 1, failureCount: 1, stability: 0.9 });
    expect(c.stability).toBeCloseTo(0.9, 5);
  });
});

describe('computeRawComposite', () => {
  it('returns 0 for all-zero inputs', () => {
    expect(computeRawComposite(ZERO)).toBe(0);
  });

  it('returns 1 for perfect inputs (regardless of weights)', () => {
    expect(computeRawComposite(PERFECT)).toBe(1);
    expect(computeRawComposite(PERFECT, EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS.search)).toBe(1);
  });

  it('matches a hand-computed reference fixture (baseline weights)', () => {
    const c: CompositeScoreComponents = { accuracy: 0.8, speed: 0.5, token: 0.4, stability: 0.9 };
    const w = EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS;
    const expected =
      (c.accuracy * w.accuracy +
        c.speed * w.speed +
        c.token * w.token +
        c.stability * w.stability) /
      (w.accuracy + w.speed + w.token + w.stability);
    expect(computeRawComposite(c, w)).toBeCloseTo(expected, 5);
  });

  it('treats counts and probabilities as equivalent inputs', () => {
    const c: CompositeScoreComponents = { accuracy: 0.5, speed: 0.5, token: 0.5, stability: 0.5 };
    const a = computeRawComposite(c, { accuracy: 0.4, speed: 0.2, token: 0.3, stability: 0.1 });
    const b = computeRawComposite(c, { accuracy: 4, speed: 2, token: 3, stability: 1 });
    expect(a).toBeCloseTo(b, 5);
  });

  it('falls back to unweighted mean when every weight is non-positive', () => {
    const c: CompositeScoreComponents = { accuracy: 1, speed: 0, token: 0.5, stability: 0.5 };
    const value = computeRawComposite(c, { accuracy: 0, speed: -1, token: 0, stability: 0 });
    expect(value).toBeCloseTo(0.5, 5);
  });
});

describe('applyRecencyDecay', () => {
  const halfLifeDays = EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS;

  it('returns the raw score when lastReplayAt is missing or after now', () => {
    expect(applyRecencyDecay(0.8, undefined, '2026-04-23T00:00:00.000Z')).toBeCloseTo(0.8, 5);
    expect(applyRecencyDecay(0.8, null, '2026-04-23T00:00:00.000Z')).toBeCloseTo(0.8, 5);
    // Future lastReplayAt → no decay (we treat the row as "fresh").
    expect(
      applyRecencyDecay(0.8, '2026-05-23T00:00:00.000Z', '2026-04-23T00:00:00.000Z'),
    ).toBeCloseTo(0.8, 5);
  });

  it('halves the score at exactly one half-life', () => {
    const last = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(last.getTime() + halfLifeDays * 24 * 60 * 60 * 1000);
    expect(applyRecencyDecay(0.8, last.toISOString(), now.toISOString())).toBeCloseTo(0.4, 5);
  });

  it('is monotonic — older rows decay more', () => {
    const a = applyRecencyDecay(0.8, '2026-04-22T00:00:00.000Z', '2026-04-23T00:00:00.000Z');
    const b = applyRecencyDecay(0.8, '2026-04-15T00:00:00.000Z', '2026-04-23T00:00:00.000Z');
    expect(b).toBeLessThan(a);
  });
});

describe('computeDecayedComposite', () => {
  it('combines raw + decay deterministically', () => {
    const components: CompositeScoreComponents = {
      accuracy: 1,
      speed: 1,
      token: 1,
      stability: 1,
    };
    const last = new Date('2026-01-01T00:00:00.000Z');
    const now = new Date(
      last.getTime() + EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000,
    );
    const decayed = computeDecayedComposite({
      components,
      lastReplayAt: last.toISOString(),
      nowIso: now.toISOString(),
    });
    expect(decayed).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// SessionCompositeScoreWriter
// ---------------------------------------------------------------------------

describe('SessionCompositeScoreWriter', () => {
  const writeInput = {
    sessionId: 'sess_1',
    actionPathId: 'action_path_' + 'a'.repeat(64),
    components: {
      accuracy: 1,
      speed: 1,
      token: 1,
      stability: 1,
    } satisfies CompositeScoreComponents,
    lastReplayAt: '2026-04-22T00:00:00.000Z',
    nowIso: '2026-04-23T00:00:00.000Z',
  };

  it('writes raw + decayed score on the happy path', () => {
    const updateMemory = jest.fn();
    const updateActionPath = jest.fn();
    const recordWarning = jest.fn();
    const writer = new SessionCompositeScoreWriter({
      repository: {
        updateMemorySessionCompositeScore: updateMemory,
        updateCompositeScoreForActionPath: updateActionPath,
        recordWritebackWarning: recordWarning,
      },
    });
    const result = writer.write(writeInput);
    expect(result.status).toBe('ok');
    expect(updateMemory).toHaveBeenCalledTimes(1);
    expect(updateActionPath).toHaveBeenCalledTimes(1);
    expect(recordWarning).not.toHaveBeenCalled();
    expect(updateActionPath.mock.calls[0][0]).toMatchObject({
      actionPathId: writeInput.actionPathId,
      nowIso: writeInput.nowIso,
    });
  });

  it('isolates a SQLite failure into a structured warning row', () => {
    const updateMemory = jest.fn(() => {
      throw new Error('SQLITE_BUSY');
    });
    const updateActionPath = jest.fn();
    const recordWarning = jest.fn();
    const onWarning = jest.fn();
    const writer = new SessionCompositeScoreWriter({
      repository: {
        updateMemorySessionCompositeScore: updateMemory,
        updateCompositeScoreForActionPath: updateActionPath,
        recordWritebackWarning: recordWarning,
      },
      onWarning,
    });
    const result = writer.write(writeInput);
    expect(result.status).toBe('isolated');
    expect(result.warningId).toMatch(/^warn_composite_/);
    expect(updateActionPath).not.toHaveBeenCalled();
    expect(recordWarning).toHaveBeenCalledTimes(1);
    expect(recordWarning.mock.calls[0][0]).toMatchObject({
      source: 'session_composite_score',
      sessionId: writeInput.sessionId,
      actionPathId: writeInput.actionPathId,
      errorCode: 'composite_score_write_failed',
    });
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  it('still returns isolated when even the warning row throws', () => {
    const writer = new SessionCompositeScoreWriter({
      repository: {
        updateMemorySessionCompositeScore: () => {
          throw new Error('SQLITE_BUSY');
        },
        updateCompositeScoreForActionPath: jest.fn(),
        recordWritebackWarning: () => {
          throw new Error('SQLITE_LOCKED');
        },
      },
    });
    const result = writer.write(writeInput);
    expect(result.status).toBe('isolated');
    expect(result.warningId).toMatch(/^warn_composite_/);
  });
});
