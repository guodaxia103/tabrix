/**
 * Unit tests for the V24-02 `experience_score_step` MCP handler.
 *
 * Boundary discipline:
 *   - The Experience repository is always stubbed (a typed spy).
 *     The repository SQL path itself is covered by
 *     `experience-repository.test.ts`.
 *   - We do NOT open a real SQLite handle here — Memory persistence
 *     is mocked via `experience: null` / `persistenceMode: 'off'`
 *     for the gate tests, and via the spy for the success / failure
 *     paths.
 *
 * Coverage matrix:
 *   1. parser  — missing/invalid actionPathId, stepIndex, observedOutcome,
 *                historyRef, replayId, evidence (code + message)
 *   2. capability gate — capability_off
 *   3. persistence gate — persistenceMode='off' / experience=null
 *   4. success path — `'ok'` with success delta
 *   5. failure path — `'ok'` with failure delta
 *   6. no-match path — `'no_match'`
 *   7. isolation path — repository throws → `'isolated'` + warning row
 *   8. isolation path with warning-row failure — silent recovery
 *   9. serializeScoreStepResult — `isError` mapping
 */

import {
  ExperienceScoreStepInputError,
  handleExperienceScoreStep,
  parseExperienceScoreStepInput,
  serializeScoreStepResult,
  type ExperienceScoreStepHandlerDeps,
  type ParsedExperienceScoreStepInput,
} from './experience-score-step';
import type {
  ExperienceRepository,
  RecordReplayStepOutcomeResult,
} from '../memory/experience/experience-repository';

const VALID_ID_A = 'action_path_' + 'a'.repeat(64);

type ExperienceSpy = Pick<
  ExperienceRepository,
  'recordReplayStepOutcome' | 'recordWritebackWarning'
>;

function buildExperienceSpy(
  overrides: Partial<{
    recordReplayStepOutcome: () => RecordReplayStepOutcomeResult;
    recordWritebackWarning: () => void;
  }> = {},
): {
  spy: ExperienceSpy;
  recordOutcomeCalls: jest.Mock;
  recordWarningCalls: jest.Mock;
} {
  const recordOutcomeCalls = jest.fn(
    overrides.recordReplayStepOutcome ??
      ((): RecordReplayStepOutcomeResult => ({
        status: 'ok',
        successDelta: 1,
        failureDelta: 0,
        lastReplayStatus: 'ok',
      })),
  );
  const recordWarningCalls = jest.fn(overrides.recordWritebackWarning ?? (() => {}));
  return {
    spy: {
      recordReplayStepOutcome:
        recordOutcomeCalls as unknown as ExperienceRepository['recordReplayStepOutcome'],
      recordWritebackWarning:
        recordWarningCalls as unknown as ExperienceRepository['recordWritebackWarning'],
    },
    recordOutcomeCalls,
    recordWarningCalls,
  };
}

function buildDeps(
  overrides: Partial<ExperienceScoreStepHandlerDeps> = {},
): ExperienceScoreStepHandlerDeps {
  // Default: capability ENABLED via TABRIX_POLICY_CAPABILITIES=all,
  // persistenceMode='memory', experience=spy stub. Tests narrow as needed.
  return {
    experience: buildExperienceSpy().spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
    capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'all' },
    persistenceMode: 'memory',
    now: () => '2026-04-23T12:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parseExperienceScoreStepInput', () => {
  function parsedOk(): ParsedExperienceScoreStepInput {
    return parseExperienceScoreStepInput({
      actionPathId: VALID_ID_A,
      stepIndex: 0,
      observedOutcome: 'state_toggled',
    });
  }

  it('parses a minimal valid input', () => {
    const parsed = parsedOk();
    expect(parsed.actionPathId).toBe(VALID_ID_A);
    expect(parsed.stepIndex).toBe(0);
    expect(parsed.observedOutcome).toBe('state_toggled');
    expect(parsed.historyRef).toBeUndefined();
    expect(parsed.replayId).toBeUndefined();
    expect(parsed.evidenceCode).toBeUndefined();
    expect(parsed.evidenceMessage).toBeUndefined();
  });

  it('parses optional historyRef / replayId / evidence', () => {
    const parsed = parseExperienceScoreStepInput({
      actionPathId: VALID_ID_A,
      stepIndex: 2,
      observedOutcome: 'no_observed_change',
      historyRef: 'h_step_42',
      replayId: 'session_42',
      evidence: { code: 'verifier_red', message: 'click missed target' },
    });
    expect(parsed.stepIndex).toBe(2);
    expect(parsed.historyRef).toBe('h_step_42');
    expect(parsed.replayId).toBe('session_42');
    expect(parsed.evidenceCode).toBe('verifier_red');
    expect(parsed.evidenceMessage).toBe('click missed target');
  });

  it.each([null, undefined, [], 'string', 42])('rejects non-object input (%p)', (raw) => {
    expect(() => parseExperienceScoreStepInput(raw)).toThrow(ExperienceScoreStepInputError);
  });

  it('rejects missing actionPathId', () => {
    expect(() =>
      parseExperienceScoreStepInput({ stepIndex: 0, observedOutcome: 'state_toggled' }),
    ).toThrow(/actionPathId is required/);
  });

  it('rejects non-string actionPathId', () => {
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: 42,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/actionPathId must be a string/);
  });

  it('rejects actionPathId that does not match the strict pattern', () => {
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: 'action_path_NOT_HEX',
        stepIndex: 0,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/actionPathId must match/);
  });

  it('rejects actionPathId exceeding the char ceiling', () => {
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: 'a'.repeat(257),
        stepIndex: 0,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/exceeds 256 chars/);
  });

  it('rejects missing / non-integer / negative / over-budget stepIndex', () => {
    expect(() =>
      parseExperienceScoreStepInput({ actionPathId: VALID_ID_A, observedOutcome: 'state_toggled' }),
    ).toThrow(/stepIndex is required/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 1.5,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/stepIndex must be a finite integer/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: -1,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/stepIndex must be in/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 17,
        observedOutcome: 'state_toggled',
      }),
    ).toThrow(/stepIndex must be in/);
  });

  it('rejects missing / unknown observedOutcome', () => {
    expect(() => parseExperienceScoreStepInput({ actionPathId: VALID_ID_A, stepIndex: 0 })).toThrow(
      /observedOutcome is required/,
    );
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'made_up_value',
      }),
    ).toThrow(/observedOutcome 'made_up_value' is not in/);
  });

  it('rejects evidence that is not an object / non-string fields', () => {
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        evidence: 'oops',
      }),
    ).toThrow(/evidence must be an object/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        evidence: { code: 42 },
      }),
    ).toThrow(/evidence.code must be a string/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        evidence: { message: 42 },
      }),
    ).toThrow(/evidence.message must be a string/);
  });

  it('rejects historyRef / replayId exceeding char ceiling', () => {
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        historyRef: 'a'.repeat(257),
      }),
    ).toThrow(/historyRef exceeds/);
    expect(() =>
      parseExperienceScoreStepInput({
        actionPathId: VALID_ID_A,
        stepIndex: 0,
        observedOutcome: 'state_toggled',
        replayId: 'a'.repeat(257),
      }),
    ).toThrow(/replayId exceeds/);
  });
});

// ---------------------------------------------------------------------------
// Handler — gates
// ---------------------------------------------------------------------------

describe('handleExperienceScoreStep — gates', () => {
  it('returns capability_off when capability is disabled', async () => {
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'state_toggled' },
      buildDeps({ capabilityEnv: { TABRIX_POLICY_CAPABILITIES: '' } }),
    );
    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('capability_off');
  });

  it('returns invalid_input when persistenceMode is off', async () => {
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'state_toggled' },
      buildDeps({ persistenceMode: 'off' }),
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('invalid_input');
    expect(result.error?.message).toMatch(/persistence is disabled/);
  });

  it('returns invalid_input when experience is null', async () => {
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'state_toggled' },
      buildDeps({ experience: null }),
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('invalid_input');
  });

  it('returns invalid_input on a parse error', async () => {
    const result = await handleExperienceScoreStep(
      { stepIndex: 0, observedOutcome: 'state_toggled' },
      buildDeps(),
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('missing_action_path_id');
  });
});

// ---------------------------------------------------------------------------
// Handler — write-back paths
// ---------------------------------------------------------------------------

describe('handleExperienceScoreStep — write-back', () => {
  it('returns ok with success delta on a success-like outcome', async () => {
    const exp = buildExperienceSpy({
      recordReplayStepOutcome: () => ({
        status: 'ok',
        successDelta: 1,
        failureDelta: 0,
        lastReplayStatus: 'ok',
      }),
    });
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 1, observedOutcome: 'state_toggled' },
      buildDeps({
        experience: exp.spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.lastReplayStatus).toBe('ok');
    expect(result.lastReplayAt).toBe('2026-04-23T12:00:00.000Z');
    expect(result.delta).toEqual({ successDelta: 1, failureDelta: 0 });
    expect(exp.recordOutcomeCalls).toHaveBeenCalledTimes(1);
    expect(exp.recordOutcomeCalls).toHaveBeenCalledWith({
      actionPathId: VALID_ID_A,
      stepIndex: 1,
      observedOutcome: 'state_toggled',
      nowIso: '2026-04-23T12:00:00.000Z',
    });
    expect(exp.recordWarningCalls).not.toHaveBeenCalled();
  });

  it('returns ok with failure delta on a non-success outcome', async () => {
    const exp = buildExperienceSpy({
      recordReplayStepOutcome: () => ({
        status: 'ok',
        successDelta: 0,
        failureDelta: 1,
        lastReplayStatus: 'failed',
      }),
    });
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'no_observed_change' },
      buildDeps({
        experience: exp.spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.lastReplayStatus).toBe('failed');
    expect(result.delta).toEqual({ successDelta: 0, failureDelta: 1 });
  });

  it('returns no_match when the row no longer exists', async () => {
    const exp = buildExperienceSpy({
      recordReplayStepOutcome: () => ({
        status: 'no_match',
        successDelta: 0,
        failureDelta: 0,
        lastReplayStatus: 'ok',
      }),
    });
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'state_toggled' },
      buildDeps({
        experience: exp.spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
      }),
    );
    expect(result.status).toBe('no_match');
    expect(result.delta).toBeUndefined();
    expect(result.lastReplayAt).toBeUndefined();
    expect(exp.recordWarningCalls).not.toHaveBeenCalled();
  });

  it('returns isolated and writes a structured warning row when SQLite throws', async () => {
    const exp = buildExperienceSpy({
      recordReplayStepOutcome: () => {
        throw new Error('SQLITE_BUSY');
      },
    });
    const result = await handleExperienceScoreStep(
      {
        actionPathId: VALID_ID_A,
        stepIndex: 3,
        observedOutcome: 'no_observed_change',
        replayId: 'sess_42',
        historyRef: 'h_step_3',
      },
      buildDeps({
        experience: exp.spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
      }),
    );
    expect(result.status).toBe('isolated');
    expect(result.warningId).toMatch(/^warn_score_step_/);
    expect(result.error?.code).toBe('score_step_write_failed');
    expect(result.lastReplayStatus).toBe('failed');
    expect(exp.recordWarningCalls).toHaveBeenCalledTimes(1);
    const warningArg = exp.recordWarningCalls.mock.calls[0][0];
    expect(warningArg.source).toBe('experience_score_step');
    expect(warningArg.actionPathId).toBe(VALID_ID_A);
    expect(warningArg.stepIndex).toBe(3);
    expect(warningArg.replayId).toBe('sess_42');
    expect(warningArg.errorCode).toBe('score_step_write_failed');
    expect(warningArg.errorMessage).toBe('SQLITE_BUSY');
  });

  it('still returns isolated when even the warning row write throws', async () => {
    const exp = buildExperienceSpy({
      recordReplayStepOutcome: () => {
        throw new Error('SQLITE_BUSY');
      },
      recordWritebackWarning: () => {
        throw new Error('SQLITE_LOCKED');
      },
    });
    const result = await handleExperienceScoreStep(
      { actionPathId: VALID_ID_A, stepIndex: 0, observedOutcome: 'no_observed_change' },
      buildDeps({
        experience: exp.spy as unknown as ExperienceScoreStepHandlerDeps['experience'],
      }),
    );
    // Isolation contract: never propagate. A double-failure is still
    // a `'isolated'` from the upstream perspective.
    expect(result.status).toBe('isolated');
    expect(result.warningId).toMatch(/^warn_score_step_/);
  });
});

// ---------------------------------------------------------------------------
// serializeScoreStepResult
// ---------------------------------------------------------------------------

describe('serializeScoreStepResult', () => {
  it('marks invalid_input as isError', () => {
    const r = serializeScoreStepResult({
      status: 'invalid_input',
      error: { code: 'invalid_input', message: 'x' },
    });
    expect(r.isError).toBe(true);
  });

  it('marks denied as isError', () => {
    const r = serializeScoreStepResult({
      status: 'denied',
      error: { code: 'capability_off', message: 'x' },
    });
    expect(r.isError).toBe(true);
  });

  it('does NOT mark isolated as isError (write-back attempt completed)', () => {
    const r = serializeScoreStepResult({
      status: 'isolated',
      warningId: 'warn_score_step_x',
      error: { code: 'score_step_write_failed', message: 'x' },
    });
    expect(r.isError).toBe(false);
  });

  it('does NOT mark ok / no_match as isError', () => {
    expect(
      serializeScoreStepResult({
        status: 'ok',
        delta: { successDelta: 1, failureDelta: 0 },
      }).isError,
    ).toBe(false);
    expect(serializeScoreStepResult({ status: 'no_match' }).isError).toBe(false);
  });
});
