/**
 * V26-03 (B-026) — Skip-Read Execution Orchestrator unit tests.
 *
 * Pinned by the V2.6 S2 plan stop-gate: a synthetic
 * `experience_replay` decision MUST resolve to `action='skip'`,
 * `readPageAvoided=true`, `tokensSavedEstimate > 0`. Any regression
 * here means V26-06 will report `readPageAvoidedCount=0` and the
 * S2 stop-gate trips.
 *
 * Also covers the explicit-fallback branches the user demanded in
 * session correction #4 (replay candidate gating) and the
 * never-L2-on-fallback hard rule (correction #2).
 */

import {
  escalateAfterSkipFailure,
  planSkipRead,
  type ChooseContextDecisionSnapshot,
  type SkipReadPlan,
  type TaskCtxSnapshot,
} from './skip-read-orchestrator';

const FRESH_CTX: TaskCtxSnapshot = Object.freeze({
  readPageCount: 0,
  readBudget: 6,
  lastReadLayer: null,
  currentUrl: 'https://example.com/page',
});

const REPLAY_DECISION: ChooseContextDecisionSnapshot = Object.freeze({
  sourceRoute: 'experience_replay_skip_read',
  chosenLayer: 'L0',
  fullReadTokenEstimate: 4096,
  replayCandidate: { actionPathId: 'ap_test_001', portableArgsOk: true, policyOk: true },
});

const KNOWLEDGE_DECISION: ChooseContextDecisionSnapshot = Object.freeze({
  sourceRoute: 'knowledge_supported_read',
  chosenLayer: 'L0+L1',
  fullReadTokenEstimate: 8192,
});

const READ_REQUIRED_DECISION: ChooseContextDecisionSnapshot = Object.freeze({
  sourceRoute: 'read_page_required',
  chosenLayer: 'L0+L1',
  fullReadTokenEstimate: 2048,
});

const FALLBACK_SAFE_DECISION: ChooseContextDecisionSnapshot = Object.freeze({
  sourceRoute: 'dispatcher_fallback_safe',
  chosenLayer: 'L0+L1+L2',
  fullReadTokenEstimate: 16_384,
});

describe('planSkipRead — S2 stop-gate happy paths', () => {
  it('experience_replay with full gates → skip + readPageAvoided=true + tokensSaved>0', () => {
    const plan = planSkipRead({ decision: REPLAY_DECISION, taskCtx: FRESH_CTX });
    expect(plan.action).toBe('skip');
    expect(plan.readPageAvoided).toBe(true);
    expect(plan.sourceKind).toBe('experience_replay');
    expect(plan.sourceRoute).toBe('experience_replay_skip_read');
    expect(plan.tokensSavedEstimate).toBe(4096);
    expect(plan.fallbackUsed).toBe('none');
    expect(plan.fallbackCause).toBe('');
    expect(plan.requiresExperienceReplay).toBe(true);
    expect(plan.requiresApiCall).toBe(false);
  });

  it('emits a diagnostic that names the candidate (operator-visible)', () => {
    const plan = planSkipRead({ decision: REPLAY_DECISION, taskCtx: FRESH_CTX });
    expect(plan.diagnostic).toContain('ap_test_001');
    expect(plan.diagnostic).toContain('skip');
  });
});

describe('planSkipRead — experience_replay gates (correction #4)', () => {
  it('missing replayCandidate → fallback_required + replay_candidate_missing (NOT skip)', () => {
    const plan = planSkipRead({
      decision: { ...REPLAY_DECISION, replayCandidate: null },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('fallback_required');
    expect(plan.readPageAvoided).toBe(false);
    expect(plan.fallbackCause).toBe('replay_candidate_missing');
    expect(plan.tokensSavedEstimate).toBe(0);
  });

  it('replayCandidate.policyOk=false → fallback_required + replay_policy_denied', () => {
    const plan = planSkipRead({
      decision: {
        ...REPLAY_DECISION,
        replayCandidate: { actionPathId: 'ap_x', portableArgsOk: true, policyOk: false },
      },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('fallback_required');
    expect(plan.fallbackCause).toBe('replay_policy_denied');
    expect(plan.diagnostic).toContain('ap_x');
  });

  it('replayCandidate.portableArgsOk=false → fallback_required + replay_portable_args_missing', () => {
    const plan = planSkipRead({
      decision: {
        ...REPLAY_DECISION,
        replayCandidate: { actionPathId: 'ap_y', portableArgsOk: false, policyOk: true },
      },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('fallback_required');
    expect(plan.fallbackCause).toBe('replay_portable_args_missing');
  });
});

describe('planSkipRead — api_list / knowledge_supported_read', () => {
  it('knowledge_supported_read without apiCapability → fallback_required + api_layer_not_available (V26-07/08 not wired yet)', () => {
    const plan = planSkipRead({ decision: KNOWLEDGE_DECISION, taskCtx: FRESH_CTX });
    expect(plan.action).toBe('fallback_required');
    expect(plan.fallbackCause).toBe('api_layer_not_available');
    expect(plan.readPageAvoided).toBe(false);
    expect(plan.tokensSavedEstimate).toBe(0);
  });

  it('knowledge_supported_read with apiCapability.available=false → fallback_required (treated identically)', () => {
    const plan = planSkipRead({
      decision: {
        ...KNOWLEDGE_DECISION,
        apiCapability: { available: false, family: 'github_search_repositories' },
      },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('fallback_required');
    expect(plan.fallbackCause).toBe('api_layer_not_available');
  });

  it('knowledge_supported_read with apiCapability.available=true → skip via api_list (forward-compat for V26-08)', () => {
    const plan = planSkipRead({
      decision: {
        ...KNOWLEDGE_DECISION,
        apiCapability: { available: true, family: 'github_search_repositories' },
      },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('skip');
    expect(plan.readPageAvoided).toBe(true);
    expect(plan.sourceKind).toBe('api_list');
    expect(plan.tokensSavedEstimate).toBe(8192);
    expect(plan.requiresApiCall).toBe(true);
    expect(plan.requiresExperienceReplay).toBe(false);
    expect(plan.diagnostic).toContain('github_search_repositories');
  });
});

describe('planSkipRead — read_page_required / dispatcher_fallback_safe', () => {
  it('read_page_required → forward + dom_json + fallbackCause=""', () => {
    const plan = planSkipRead({ decision: READ_REQUIRED_DECISION, taskCtx: FRESH_CTX });
    expect(plan.action).toBe('forward');
    expect(plan.readPageAvoided).toBe(false);
    expect(plan.sourceKind).toBe('dom_json');
    expect(plan.fallbackCause).toBe('');
  });

  it('dispatcher_fallback_safe → forward + dom_json + fallbackEntryLayer clamped to L0+L1 (NEVER L0+L1+L2)', () => {
    const plan = planSkipRead({ decision: FALLBACK_SAFE_DECISION, taskCtx: FRESH_CTX });
    expect(plan.action).toBe('forward');
    // Dispatcher said L0+L1+L2 but the orchestrator MUST clamp.
    expect(plan.fallbackEntryLayer).toBe('L0+L1');
    expect(plan.fallbackEntryLayer).not.toBe('L0+L1+L2' as unknown as 'L0+L1');
  });
});

describe('planSkipRead — budget / fallback layer hard rules', () => {
  it('budget exhausted → forward + budget_exhausted (orchestrator does NOT duplicate the gate response)', () => {
    const plan = planSkipRead({
      decision: REPLAY_DECISION,
      taskCtx: { ...FRESH_CTX, readPageCount: 6, readBudget: 6 },
    });
    expect(plan.action).toBe('forward');
    expect(plan.fallbackCause).toBe('budget_exhausted');
    expect(plan.readPageAvoided).toBe(false);
  });

  it('chosenLayer=L0 keeps fallbackEntryLayer at L0', () => {
    const plan = planSkipRead({
      decision: { ...READ_REQUIRED_DECISION, chosenLayer: 'L0' },
      taskCtx: FRESH_CTX,
    });
    expect(plan.fallbackEntryLayer).toBe('L0');
  });

  it('chosenLayer=L0+L1+L2 is clamped to L0+L1 in fallbackEntryLayer (correction #2 hard rule)', () => {
    const plan = planSkipRead({
      decision: { ...READ_REQUIRED_DECISION, chosenLayer: 'L0+L1+L2' },
      taskCtx: FRESH_CTX,
    });
    expect(plan.fallbackEntryLayer).toBe('L0+L1');
  });

  it('clampTokens: zero / negative / NaN fullReadTokenEstimate yields tokensSavedEstimate=0 even on skip (honest budget)', () => {
    const plan = planSkipRead({
      decision: { ...REPLAY_DECISION, fullReadTokenEstimate: -1 },
      taskCtx: FRESH_CTX,
    });
    expect(plan.action).toBe('skip');
    expect(plan.tokensSavedEstimate).toBe(0);

    const planNan = planSkipRead({
      decision: { ...REPLAY_DECISION, fullReadTokenEstimate: Number.NaN },
      taskCtx: FRESH_CTX,
    });
    expect(planNan.tokensSavedEstimate).toBe(0);
  });
});

describe('escalateAfterSkipFailure — never widens to L0+L1+L2', () => {
  let original: SkipReadPlan;

  beforeEach(() => {
    original = planSkipRead({ decision: REPLAY_DECISION, taskCtx: FRESH_CTX });
  });

  it('replay_verifier_failed → forward + L0+L1 + tokensSaved=0', () => {
    const escalated = escalateAfterSkipFailure(original, 'replay_verifier_failed');
    expect(escalated.action).toBe('forward');
    expect(escalated.readPageAvoided).toBe(false);
    expect(escalated.tokensSavedEstimate).toBe(0);
    expect(escalated.fallbackEntryLayer).toBe('L0+L1');
    expect(escalated.diagnostic).toContain('replay_verifier_failed');
    expect(escalated.diagnostic).toContain('never L0+L1+L2');
  });

  it.each([['replay_engine_unavailable'], ['api_call_failed'], ['api_rate_limited']] as const)(
    'reason=%s also clamps to L0+L1 and forwards',
    (reason) => {
      const escalated = escalateAfterSkipFailure(original, reason);
      expect(escalated.fallbackEntryLayer).toBe('L0+L1');
      expect(escalated.action).toBe('forward');
      expect(escalated.sourceRoute).toBe(original.sourceRoute);
    },
  );
});

describe('planSkipRead — orchestrator never returns synthetic read_page payload (correction #2)', () => {
  it('skip plan exposes only metadata fields; no `pageContent` / `interactiveElements` / `summary`', () => {
    const plan = planSkipRead({ decision: REPLAY_DECISION, taskCtx: FRESH_CTX }) as Record<
      string,
      unknown
    >;
    expect(plan).not.toHaveProperty('pageContent');
    expect(plan).not.toHaveProperty('interactiveElements');
    expect(plan).not.toHaveProperty('summary');
    expect(plan).not.toHaveProperty('L0');
    expect(plan).not.toHaveProperty('L1');
    expect(plan).not.toHaveProperty('page');
    // The required metadata is present.
    expect(plan).toHaveProperty('readPageAvoided');
    expect(plan).toHaveProperty('sourceKind');
    expect(plan).toHaveProperty('sourceRoute');
    expect(plan).toHaveProperty('tokensSavedEstimate');
    expect(plan).toHaveProperty('fallbackUsed');
  });
});
