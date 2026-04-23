/**
 * Unit tests for the V24-01 `experience_replay` v1 engine and handler.
 *
 * Boundary discipline:
 *   - The bridge (`dispatchBridged`) is always stubbed; we never
 *     reach a real Chrome extension here.
 *   - The recorder (`startStep`/`completeStep`/`failStep`) is a spy;
 *     unit tests check that we open exactly one row per attempted
 *     step and stop on the first failure (brief §6).
 *   - `experience.findActionPathById` is also stubbed — `experience-
 *     repository.test.ts` already covers the SQL path.
 *
 * Coverage matrix (brief §6 closed enum):
 *   - `unknown_action_path`           ✓ (rowMissing)
 *   - `step_budget_exceeded`          ✓ (overBudget)
 *   - `unsupported_step_kind`         ✓ (badStepKind, emptyPlan, missingArgs)
 *   - `non_github_pageRole`           ✓ (nonGithubRole)
 *   - `template_field_missing`        ✓ (missingTemplateValue, missingArgsKey)
 *   - `step_target_not_found`         ✓ (bridgeThrows, bridgeIsErrorDefault)
 *   - `step_verifier_red`             ✓ (bridgeIsErrorVerifier)
 *   - `step_dialog_intercepted`       ✓ (bridgeIsErrorDialog)
 *   - `step_navigation_drift`         ✓ (bridgeIsErrorNavigation)
 *   - `substitution_invalid`          ✓ (bridgeIsErrorSubstitution)
 *   - `capability_off`                ✓ (capabilityGate)
 *
 * NOT triggered here (covered upstream / by other tests):
 *   - `policy_denied` — Phase 0 P3 gate, register-tools owns it.
 *   - `replay_aborted_by_caller` — v2 only.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS,
  TABRIX_REPLAY_FAILURE_CODES,
} from '@tabrix/shared';
import type {
  ExperienceActionPathRow,
  ExperienceActionPathStep,
} from '../memory/experience/experience-repository';
import {
  ExperienceReplayInputError,
  REPLAY_INVALID_INTENT_TAG,
  REPLAY_SESSION_TASK_INTENT_PREFIX,
  ReplayEngine,
  handleExperienceReplay,
  parseExperienceReplayInput,
  serializeReplayResult,
  type DispatchBridgedFn,
  type ExperienceReplayHandlerDeps,
  type ReplayStepRecorder,
  type SupportedReplayToolName,
} from './experience-replay';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_ID_A = 'action_path_' + 'a'.repeat(64);
const VALID_ID_B = 'action_path_' + 'b'.repeat(64);

function buildRow(overrides: Partial<ExperienceActionPathRow> = {}): ExperienceActionPathRow {
  return {
    actionPathId: VALID_ID_A,
    pageRole: 'issues_list',
    intentSignature: 'open repo issues tab',
    stepSequence: [
      {
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h_step_1',
        args: { selector: '.issues-tab' },
      },
      {
        toolName: 'chrome_fill_or_select',
        status: 'ok',
        historyRef: 'h_step_2',
        // V24-01 P1: aggregator-written rows carry only the
        // per-tool portable allowlist (selector / value / ...). The
        // engine's `sanitizePortableSteps` would refuse a row that
        // lacks `value`, so the default fixture mirrors a realistic
        // post-aggregator shape. `templateFields` capture remains
        // V24-02+, so this fixture has none; tests that need to
        // exercise the `template_field_missing` branch attach
        // `templateFields` explicitly.
        args: { selector: '.search-input', value: 'placeholder' },
      },
    ],
    successCount: 5,
    failureCount: 0,
    lastUsedAt: '2026-04-22T00:00:00.000Z',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

function fixRowSteps(steps: ExperienceActionPathStep[]): ExperienceActionPathRow {
  return buildRow({ stepSequence: steps });
}

interface RecorderSpy extends ReplayStepRecorder {
  startCalls: Array<{ toolName: SupportedReplayToolName; inputSummary: string }>;
  completeCalls: Array<{
    stepId: string;
    update: { resultSummary?: string; artifactRefs?: string[] };
  }>;
  failCalls: Array<{ stepId: string; failureCode: string; errorSummary: string }>;
}

function makeRecorder(): RecorderSpy {
  const startCalls: RecorderSpy['startCalls'] = [];
  const completeCalls: RecorderSpy['completeCalls'] = [];
  const failCalls: RecorderSpy['failCalls'] = [];
  let nextId = 0;
  return {
    startCalls,
    completeCalls,
    failCalls,
    startStep(input) {
      startCalls.push(input);
      const id = `stub-step-${nextId++}`;
      return id;
    },
    completeStep(stepId, update) {
      completeCalls.push({ stepId, update });
    },
    failStep(stepId, update) {
      failCalls.push({
        stepId,
        failureCode: update.failureCode,
        errorSummary: update.errorSummary,
      });
    },
  };
}

function okBridgeResult(text = '{"ok":true,"historyRef":"h_step_x"}'): CallToolResult {
  return { content: [{ type: 'text' as const, text }], isError: false };
}

function errorBridgeResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    isError: true,
  };
}

function makeDispatch(handlers: DispatchBridgedFn[]): {
  dispatch: DispatchBridgedFn;
  callCount: () => number;
  calls: Array<{ toolName: SupportedReplayToolName; args: Record<string, unknown> }>;
} {
  const calls: Array<{ toolName: SupportedReplayToolName; args: Record<string, unknown> }> = [];
  let i = 0;
  const dispatch: DispatchBridgedFn = async (toolName, args) => {
    calls.push({ toolName, args });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler(toolName, args);
  };
  return { dispatch, callCount: () => calls.length, calls };
}

function alwaysOk(text?: string): DispatchBridgedFn {
  return async () => okBridgeResult(text);
}

function alwaysError(payload: unknown): DispatchBridgedFn {
  return async () => errorBridgeResult(payload);
}

function alwaysThrow(message: string): DispatchBridgedFn {
  return async () => {
    throw new Error(message);
  };
}

// ---------------------------------------------------------------------------
// parseExperienceReplayInput
// ---------------------------------------------------------------------------

describe('parseExperienceReplayInput', () => {
  it('accepts a valid minimum input and defaults maxSteps to the brief ceiling', () => {
    const parsed = parseExperienceReplayInput({ actionPathId: VALID_ID_A });
    expect(parsed.actionPathId).toBe(VALID_ID_A);
    expect(parsed.maxSteps).toBe(16);
    expect(parsed.targetTabId).toBeUndefined();
    expect(parsed.variableSubstitutions).toEqual({});
  });

  it('clamps oversized maxSteps to MAX_STEP_BUDGET (=16)', () => {
    const parsed = parseExperienceReplayInput({ actionPathId: VALID_ID_A, maxSteps: 9999 });
    expect(parsed.maxSteps).toBe(16);
  });

  it('passes through user-chosen maxSteps in [1, 16]', () => {
    expect(parseExperienceReplayInput({ actionPathId: VALID_ID_A, maxSteps: 1 }).maxSteps).toBe(1);
    expect(parseExperienceReplayInput({ actionPathId: VALID_ID_A, maxSteps: 16 }).maxSteps).toBe(
      16,
    );
  });

  it.each([
    { args: undefined, code: 'invalid_input' },
    { args: null, code: 'invalid_input' },
    { args: 'string', code: 'invalid_input' },
    { args: [], code: 'invalid_input' },
    { args: {}, code: 'missing_action_path_id' },
    { args: { actionPathId: '' }, code: 'missing_action_path_id' },
    { args: { actionPathId: 123 }, code: 'invalid_action_path_id' },
    { args: { actionPathId: 'not-a-valid-id' }, code: 'invalid_action_path_id' },
    { args: { actionPathId: 'action_path_' + 'a'.repeat(63) }, code: 'invalid_action_path_id' },
    { args: { actionPathId: VALID_ID_A, maxSteps: 0 }, code: 'invalid_max_steps' },
    { args: { actionPathId: VALID_ID_A, maxSteps: -1 }, code: 'invalid_max_steps' },
    { args: { actionPathId: VALID_ID_A, maxSteps: 1.5 }, code: 'invalid_max_steps' },
    { args: { actionPathId: VALID_ID_A, maxSteps: 'lots' }, code: 'invalid_max_steps' },
    { args: { actionPathId: VALID_ID_A, maxSteps: Number.NaN }, code: 'invalid_max_steps' },
    {
      args: { actionPathId: VALID_ID_A, maxSteps: Number.POSITIVE_INFINITY },
      code: 'invalid_max_steps',
    },
    { args: { actionPathId: VALID_ID_A, targetTabId: 0 }, code: 'invalid_target_tab_id' },
    { args: { actionPathId: VALID_ID_A, targetTabId: -3 }, code: 'invalid_target_tab_id' },
    { args: { actionPathId: VALID_ID_A, targetTabId: 1.5 }, code: 'invalid_target_tab_id' },
    {
      args: { actionPathId: VALID_ID_A, variableSubstitutions: 'no' },
      code: 'invalid_variable_substitutions',
    },
    {
      args: { actionPathId: VALID_ID_A, variableSubstitutions: [] },
      code: 'invalid_variable_substitutions',
    },
    {
      args: { actionPathId: VALID_ID_A, variableSubstitutions: { foo: 'bar' } },
      code: 'invalid_substitution_key',
    },
    {
      args: { actionPathId: VALID_ID_A, variableSubstitutions: { queryText: 7 } },
      code: 'invalid_substitution_value',
    },
    {
      args: {
        actionPathId: VALID_ID_A,
        variableSubstitutions: { queryText: 'x'.repeat(4097) },
      },
      code: 'invalid_substitution_value',
    },
  ])('rejects malformed input → %p', ({ args, code }) => {
    expect.assertions(2);
    try {
      parseExperienceReplayInput(args);
    } catch (err) {
      expect(err).toBeInstanceOf(ExperienceReplayInputError);
      expect((err as ExperienceReplayInputError).code).toBe(code);
    }
  });

  it('accepts targetTabId and variableSubstitutions when valid', () => {
    const parsed = parseExperienceReplayInput({
      actionPathId: VALID_ID_A,
      targetTabId: 7,
      variableSubstitutions: { queryText: 'hello', targetLabel: 'world' },
    });
    expect(parsed.targetTabId).toBe(7);
    expect(parsed.variableSubstitutions).toEqual({ queryText: 'hello', targetLabel: 'world' });
  });
});

// ---------------------------------------------------------------------------
// ReplayEngine — failure-precondition branches
// ---------------------------------------------------------------------------

describe('ReplayEngine — failed-precondition branches (no recorder writes)', () => {
  it('returns `unknown_action_path` when the row is missing', async () => {
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => undefined },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('unknown_action_path');
    expect(callCount()).toBe(0);
    expect(recorder.startCalls).toHaveLength(0);
  });

  it('returns `non_github_pageRole` when pageRole is not in the v1 GitHub allowlist', async () => {
    const row = buildRow({ pageRole: 'youtube_watch' });
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: { queryText: 'q' },
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('non_github_pageRole');
    expect(callCount()).toBe(0);
  });

  it('returns `step_budget_exceeded` when recorded steps exceed maxSteps', async () => {
    const row = fixRowSteps(
      Array.from({ length: 5 }, (_, i) => ({
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: `h${i}`,
        args: { selector: `#a${i}` },
      })),
    );
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 3,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('step_budget_exceeded');
    expect(callCount()).toBe(0);
  });

  it('returns `unsupported_step_kind` for an empty plan', async () => {
    const row = fixRowSteps([]);
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('unsupported_step_kind');
  });

  it('returns `unsupported_step_kind` when a recorded step is outside the v1 supported set', async () => {
    const row = fixRowSteps([
      { toolName: 'chrome_navigate', status: 'ok', historyRef: 'h0', args: {} },
    ]);
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('unsupported_step_kind');
    expect(callCount()).toBe(0);
  });

  it('returns `unsupported_step_kind` (forward-compat tag) when a step has no recorded args', async () => {
    const row = fixRowSteps([{ toolName: 'chrome_click_element', status: 'ok', historyRef: 'h0' }]);
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('unsupported_step_kind');
  });

  it('returns `template_field_missing` when caller does not supply a declared placeholder', async () => {
    // V24-01 P1: row is portable (has selector + value) so the engine's
    // pre-flight portability gate passes; the per-step template
    // substitution then complains that `queryText` was not supplied.
    // (V24-02+ will widen the placeholder→key bridge so a placeholder
    // can substitute `value` directly; until then the placeholder must
    // also exist as a literal top-level args key for substitution to
    // happen.)
    const row = fixRowSteps([
      {
        toolName: 'chrome_fill_or_select',
        status: 'ok',
        historyRef: 'h0',
        args: { selector: '#search', value: 'literal' },
        templateFields: ['queryText'],
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('template_field_missing');
    expect(recorder.startCalls).toHaveLength(0);
  });

  it('returns `template_field_missing` when args is missing the declared placeholder key', async () => {
    const row = fixRowSteps([
      {
        toolName: 'chrome_fill_or_select',
        status: 'ok',
        historyRef: 'h0',
        // Portable shape (passes the engine's pre-flight gate) but
        // lacks the literal `queryText` key the templateField wants.
        args: { selector: '#search', value: 'literal' /* no `queryText` key */ },
        templateFields: ['queryText'],
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: { queryText: 'whatever' },
      maxSteps: 16,
    });
    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('template_field_missing');
  });
});

// ---------------------------------------------------------------------------
// ReplayEngine — happy path & per-step failure
// ---------------------------------------------------------------------------

describe('ReplayEngine — execution', () => {
  it('walks the full plan and reports `ok`, dispatching only the portable args', async () => {
    const row = buildRow();
    const recorder = makeRecorder();
    const { dispatch, calls } = makeDispatch([
      alwaysOk('{"ok":true,"historyRef":"h_step_1_live"}'),
      alwaysOk('{"ok":true,"historyRef":"h_step_2_live"}'),
    ]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      // No templateFields on the default fixture (V24-01); operator
      // can still hand placeholders in - they simply are not applied.
      variableSubstitutions: { queryText: 'tabrix-bug-1' },
      maxSteps: 16,
    });

    expect(out.status).toBe('ok');
    expect(out.evidenceRefs).toHaveLength(2);
    expect(out.evidenceRefs[0]).toMatchObject({
      stepIndex: 0,
      toolName: 'chrome_click_element',
      status: 'ok',
      historyRef: 'h_step_1_live',
    });
    expect(out.evidenceRefs[1]).toMatchObject({
      stepIndex: 1,
      toolName: 'chrome_fill_or_select',
      status: 'ok',
      historyRef: 'h_step_2_live',
    });
    // Default fixture has no templateFields → nothing applied (V24-02+).
    expect(out.resolved.appliedSubstitutionKeys).toEqual([]);
    expect(out.resolved.actionPathId).toBe(VALID_ID_A);
    expect(out.resolved.pageRole).toBe('issues_list');
    expect(out.resolved.intentSignature).toBe('open repo issues tab');

    // The recorder saw exactly two opens, two completes, no fails.
    expect(recorder.startCalls).toHaveLength(2);
    expect(recorder.completeCalls).toHaveLength(2);
    expect(recorder.failCalls).toHaveLength(0);

    // Each dispatch carries ONLY the portable subset for its tool kind
    // (V24-01 P1: `sanitizePortableSteps` already stripped any
    // session-local handles - see `experience-replay-args.ts`).
    expect(calls[0].args).toEqual({ selector: '.issues-tab' });
    expect(calls[1].args).toEqual({ selector: '.search-input', value: 'placeholder' });
  });

  it('injects targetTabId into args when not already pinned', async () => {
    const row = fixRowSteps([
      {
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h0',
        args: { selector: '.btn' },
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch, calls } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
      targetTabId: 42,
    });
    expect(calls[0].args).toEqual({ selector: '.btn', tabId: 42 });
  });

  it('strips a pre-pinned tabId from recorded args via the portable allowlist (operator targetTabId wins)', async () => {
    // V24-01 P1: even if a row was persisted with a session-local
    // `tabId` (legacy aggregator data, manual SQL, ...), the engine's
    // `sanitizePortableSteps` drops it before dispatch. The operator
    // -supplied `targetTabId` is then re-injected by `withTargetTab`.
    const row = fixRowSteps([
      {
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h0',
        args: { selector: '.btn', tabId: 1 },
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch, calls } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
      targetTabId: 42,
    });
    expect(calls[0].args).toEqual({ selector: '.btn', tabId: 42 });
  });

  it('terminates on the first per-step failure (no retry, no later steps)', async () => {
    const row = buildRow();
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([
      alwaysError({ message: 'click target gone' }),
      alwaysOk(), // would-be step 2 — must NOT be invoked
    ]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: { queryText: 'q' },
      maxSteps: 16,
    });
    expect(out.status).toBe('failed');
    expect(callCount()).toBe(1);
    expect(out.evidenceRefs).toHaveLength(1);
    expect(out.evidenceRefs[0]).toMatchObject({
      stepIndex: 0,
      status: 'failed',
      failureCode: 'step_target_not_found',
    });
    expect(recorder.failCalls).toHaveLength(1);
    expect(recorder.completeCalls).toHaveLength(0);
  });

  it('reports `partial` when the second step fails after a successful first', async () => {
    const row = buildRow();
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([
      alwaysOk('{"ok":true,"historyRef":"h_step_1_live"}'),
      alwaysError({ failureCode: 'verifier_red' }),
    ]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: { queryText: 'q' },
      maxSteps: 16,
    });
    expect(out.status).toBe('partial');
    expect(callCount()).toBe(2);
    expect(out.evidenceRefs).toHaveLength(2);
    expect(out.evidenceRefs[1].failureCode).toBe('step_verifier_red');
    expect(recorder.completeCalls).toHaveLength(1);
    expect(recorder.failCalls).toHaveLength(1);
  });

  it('classifies bridge errors into the closed enum (verifier / dialog / drift / substitution)', async () => {
    const cases: Array<{ failureCode: string; expected: string }> = [
      { failureCode: 'verifier_red', expected: 'step_verifier_red' },
      { failureCode: 'dialog_intercepted', expected: 'step_dialog_intercepted' },
      { failureCode: 'navigation_drift', expected: 'step_navigation_drift' },
      { failureCode: 'substitution_invalid', expected: 'substitution_invalid' },
      { failureCode: 'something_unexpected', expected: 'step_target_not_found' },
    ];
    for (const c of cases) {
      const row = fixRowSteps([
        {
          toolName: 'chrome_click_element',
          status: 'ok',
          historyRef: 'h0',
          args: { selector: '.x' },
        },
      ]);
      const { dispatch } = makeDispatch([alwaysError({ failureCode: c.failureCode })]);
      const engine = new ReplayEngine({
        experience: { findActionPathById: () => row },
        dispatch,
        recorder: makeRecorder(),
      });
      const out = await engine.execute({
        actionPathId: VALID_ID_A,
        variableSubstitutions: {},
        maxSteps: 16,
      });
      expect(out.status).toBe('failed');
      expect(out.evidenceRefs[0].failureCode).toBe(c.expected);
    }
  });

  it('treats a thrown bridge error as `step_target_not_found` (terminal)', async () => {
    const row = buildRow();
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysThrow('extension disconnected')]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: { queryText: 'q' },
      maxSteps: 16,
    });
    expect(out.status).toBe('failed');
    expect(out.evidenceRefs[0].failureCode).toBe('step_target_not_found');
    expect(recorder.failCalls[0].errorSummary).toBe('extension disconnected');
  });
});

// ---------------------------------------------------------------------------
// V24-01 P1 — direct-call portable allowlist gate (defense in depth)
//
// The chooser already refuses to route non-portable rows to
// `experience_replay`, but operators can call the bridged tool
// directly with an `actionPathId` whose row was aggregated before
// V24-01 (or smuggled in via manual SQL). The engine MUST NOT
// re-dispatch session-local handles (per-snapshot `ref`, old `tabId`,
// `windowId`, ...) to the bridge - it would either silently click
// the wrong element or hit a dead handle. These two tests pin the
// engine-level gate so a future regression is loud.
// ---------------------------------------------------------------------------

describe('ReplayEngine — direct-call portable allowlist gate (V24-01 P1)', () => {
  it('strips non-portable handles (per-snapshot `ref`, recorded `tabId`) before dispatch when called directly', async () => {
    // Persisted row carries a portable `selector` PLUS session-local
    // `tabId` + per-snapshot `ref`. Without the gate the engine would
    // dispatch all three to the bridge.
    const row = fixRowSteps([
      {
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h0',
        args: {
          selector: '.issues-tab',
          // Session-local handles that MUST NOT survive to dispatch.
          tabId: 13,
          ref: 'ref_per_snapshot_xyz',
        },
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch, calls } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
      // Operator-supplied targetTabId is the only legal way to pin a
      // tab on replay; it gets re-injected after the portable strip.
      targetTabId: 999,
    });

    expect(out.status).toBe('ok');
    expect(calls).toHaveLength(1);
    // Only the portable selector + the operator's targetTabId reach
    // the bridge. NO `ref`, NO recorded `tabId: 13`.
    expect(calls[0]).toEqual({
      toolName: 'chrome_click_element',
      args: { selector: '.issues-tab', tabId: 999 },
    });
    expect(calls[0].args).not.toHaveProperty('ref');
    // Recorder DID open one row (the row passed the gate after
    // sanitization, so the step legitimately ran).
    expect(recorder.startCalls).toHaveLength(1);
  });

  it('fails-precondition with zero dispatches and zero startStep when a step has only a per-snapshot `ref`', async () => {
    // No portable target after stripping (`ref` is non-portable, no
    // selector, no candidateAction). Direct caller must NOT see the
    // engine startStep / dispatch ANYTHING.
    const row = fixRowSteps([
      {
        toolName: 'chrome_click_element',
        status: 'ok',
        historyRef: 'h0',
        args: {
          tabId: 13,
          ref: 'ref_per_snapshot_xyz',
        },
      },
    ]);
    const recorder = makeRecorder();
    const { dispatch, callCount } = makeDispatch([alwaysOk()]);
    const engine = new ReplayEngine({
      experience: { findActionPathById: () => row },
      dispatch,
      recorder,
    });
    const out = await engine.execute({
      actionPathId: VALID_ID_A,
      variableSubstitutions: {},
      maxSteps: 16,
      targetTabId: 999,
    });

    expect(out.status).toBe('failed-precondition');
    expect(out.error?.code).toBe('unsupported_step_kind');
    expect(callCount()).toBe(0);
    expect(recorder.startCalls).toHaveLength(0);
    expect(recorder.completeCalls).toHaveLength(0);
    expect(recorder.failCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Strategy-set guard (build-time invariant)
// ---------------------------------------------------------------------------

describe('strategy-set guards', () => {
  it('limits the v1 supported step kinds to chrome_click_element + chrome_fill_or_select', () => {
    // If a future PR widens this set without updating the engine, this
    // test must fail loudly (brief §10 item 9).
    expect(Array.from(TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS).sort()).toEqual([
      'chrome_click_element',
      'chrome_fill_or_select',
    ]);
  });

  it('keeps the failure-code enum closed and free of typos', () => {
    // The shared enum and the runtime set must stay in lockstep.
    const expected = [
      'capability_off',
      'non_github_pageRole',
      'page_role_mismatch',
      'policy_denied',
      'replay_aborted_by_caller',
      'step_budget_exceeded',
      'step_dialog_intercepted',
      'step_navigation_drift',
      'step_target_not_found',
      'step_verifier_red',
      'substitution_invalid',
      'template_field_missing',
      'unknown_action_path',
      'unsupported_step_kind',
    ];
    expect(Array.from(TABRIX_REPLAY_FAILURE_CODES).sort()).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Result-shape guard
// ---------------------------------------------------------------------------

describe('result shape guard', () => {
  it('serializes a result as a CallToolResult with isError matching status', () => {
    const ok = serializeReplayResult({
      status: 'ok',
      evidenceRefs: [],
      resolved: {
        actionPathId: VALID_ID_A,
        pageRole: 'issues_list',
        intentSignature: 'x',
        appliedSubstitutionKeys: [],
      },
    });
    expect(ok.isError).toBe(false);
    expect(ok.content[0].type).toBe('text');

    const denied = serializeReplayResult({
      status: 'denied',
      evidenceRefs: [],
      error: { code: 'capability_off', message: 'off' },
    });
    expect(denied.isError).toBe(true);

    const failed = serializeReplayResult({
      status: 'failed',
      evidenceRefs: [],
      resolved: {
        actionPathId: VALID_ID_A,
        pageRole: 'issues_list',
        intentSignature: 'x',
        appliedSubstitutionKeys: [],
      },
    });
    expect(failed.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleExperienceReplay — gating + intent tagging + parser plumbing
// ---------------------------------------------------------------------------

describe('handleExperienceReplay', () => {
  function baseDeps(
    overrides: Partial<ExperienceReplayHandlerDeps> = {},
  ): ExperienceReplayHandlerDeps {
    const recorder = makeRecorder();
    const { dispatch } = makeDispatch([alwaysOk()]);
    return {
      experience: { findActionPathById: () => buildRow() },
      dispatchBridged: dispatch,
      recorder,
      updateTaskIntent: jest.fn(),
      capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
      persistenceMode: 'memory',
      ...overrides,
    };
  }

  it('returns `denied / capability_off` when the capability is not enabled', async () => {
    const deps = baseDeps({ capabilityEnv: {} });
    const result = await handleExperienceReplay({ actionPathId: VALID_ID_A }, deps);
    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('capability_off');
    expect(deps.updateTaskIntent).not.toHaveBeenCalled();
  });

  it('returns `denied / capability_off` even when env says "all" but the gate token is absent', async () => {
    const deps = baseDeps({ capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' } });
    const result = await handleExperienceReplay({ actionPathId: VALID_ID_A }, deps);
    expect(result.status).toBe('denied');
    expect(result.error?.code).toBe('capability_off');
  });

  it('honours the "all" capability token', async () => {
    const deps = baseDeps({ capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'all' } });
    const result = await handleExperienceReplay(
      { actionPathId: VALID_ID_A, variableSubstitutions: { queryText: 'q' } },
      deps,
    );
    expect(result.status).toBe('ok');
    expect(deps.updateTaskIntent).toHaveBeenCalledWith(
      `${REPLAY_SESSION_TASK_INTENT_PREFIX}${VALID_ID_A}`,
    );
  });

  it('refuses with `unknown_action_path` when persistence is off', async () => {
    const deps = baseDeps({ experience: null, persistenceMode: 'off' });
    const result = await handleExperienceReplay({ actionPathId: VALID_ID_A }, deps);
    expect(result.status).toBe('failed-precondition');
    expect(result.error?.code).toBe('unknown_action_path');
  });

  it('returns `invalid_input` and tags session as :invalid for malformed input', async () => {
    const updateTaskIntent = jest.fn();
    const deps = baseDeps({ updateTaskIntent });
    const result = await handleExperienceReplay({ actionPathId: 'nope' }, deps);
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('invalid_action_path_id');
    expect(updateTaskIntent).toHaveBeenCalledWith(REPLAY_INVALID_INTENT_TAG);
  });

  it('tags the wrapper session with experience_replay:<id> on a successful resolve', async () => {
    const updateTaskIntent = jest.fn();
    const deps = baseDeps({ updateTaskIntent });
    const result = await handleExperienceReplay(
      { actionPathId: VALID_ID_A, variableSubstitutions: { queryText: 'q' } },
      deps,
    );
    expect(result.status).toBe('ok');
    expect(updateTaskIntent).toHaveBeenCalledWith(
      `${REPLAY_SESSION_TASK_INTENT_PREFIX}${VALID_ID_A}`,
    );
  });

  it('still returns `failed-precondition` (and tags the session) when the row id is unknown', async () => {
    const updateTaskIntent = jest.fn();
    const deps = baseDeps({
      updateTaskIntent,
      experience: { findActionPathById: () => undefined },
    });
    const result = await handleExperienceReplay({ actionPathId: VALID_ID_B }, deps);
    expect(result.status).toBe('failed-precondition');
    expect(result.error?.code).toBe('unknown_action_path');
    // The intent was still tagged BEFORE the engine ran; aggregator's
    // stale-id branch will mark-and-skip without seeding a new bucket.
    expect(updateTaskIntent).toHaveBeenCalledWith(
      `${REPLAY_SESSION_TASK_INTENT_PREFIX}${VALID_ID_B}`,
    );
  });

  it('returns a structured internal error when bridge or recorder is missing', async () => {
    const deps = baseDeps({ dispatchBridged: undefined });
    const result = await handleExperienceReplay({ actionPathId: VALID_ID_A }, deps);
    expect(result.status).toBe('failed-precondition');
    expect(result.error?.code).toBe('unknown_action_path');
    expect(result.error?.message).toMatch(/internal wiring is missing/);
  });
});
