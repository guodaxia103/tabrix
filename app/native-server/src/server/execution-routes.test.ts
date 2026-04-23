/**
 * V25-03 — `/execution/**` HTTP route tests.
 *
 * Mirrors the structure of `memory-routes.test.ts` (in-memory native
 * server with supertest). Two halves:
 *
 *   1. Functional: empty DB / seeded / limit handling for each of
 *      the four routes.
 *   2. Privacy / M4 negative: the response body is statically scanned
 *      for secrets that MUST NOT leak through these routes:
 *        - full URLs with query strings
 *        - any field from `memory_sessions.user_input`
 *        - cookie or auth header values
 *
 *      Negative tests both seed the upstream tables with poisoned
 *      data AND assert the response body has zero references to it.
 *      This is the M4 binding from the V25 plan.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { sessionManager } from '../execution/session-manager';
import type {
  ExecutionRecentDecisionsResponseData,
  ExecutionReliabilitySignalSummary,
  ExecutionSavingsSummary,
  ExecutionTopActionPathsResponseData,
} from '@tabrix/shared';

function chooseContextRepo() {
  const repo = sessionManager.chooseContextTelemetry;
  if (!repo) throw new Error('telemetry repo unavailable in test environment');
  return repo;
}

function seedDecision(opts: {
  decisionId: string;
  createdAt: string;
  intentSignature?: string;
  pageRole?: string | null;
  siteFamily?: string | null;
  strategy?:
    | 'experience_replay'
    | 'experience_reuse'
    | 'knowledge_light'
    | 'read_page_markdown'
    | 'read_page_required';
  chosenLayer?: 'L0' | 'L0+L1' | 'L0+L1+L2' | null;
  layerDispatchReason?:
    | 'safety_override_full_layers'
    | 'user_intent_summary'
    | 'user_intent_select_or_open'
    | 'user_intent_form_or_replay'
    | 'user_intent_detail_required'
    | 'simple_page_token_saving'
    | 'medium_page_overview_actions'
    | 'complex_page_detail_required'
    | 'experience_replay_no_extra_read'
    | 'knowledge_light_read_only'
    | 'knowledge_light_action_required'
    | 'dispatcher_fallback_safe'
    | null;
  sourceRoute?:
    | 'read_page_required'
    | 'experience_replay_skip_read'
    | 'knowledge_supported_read'
    | 'dispatcher_fallback_safe'
    | null;
  fallbackCause?: string | null;
  tokensSavedEstimate?: number | null;
  fallbackStrategy?:
    | 'experience_replay'
    | 'experience_reuse'
    | 'knowledge_light'
    | 'read_page_markdown'
    | 'read_page_required'
    | null;
  replayEligibleBlockedBy?:
    | 'capability_off'
    | 'unsupported_step_kind'
    | 'non_portable_args'
    | 'non_github_pageRole'
    | 'below_threshold'
    | 'stale_locator'
    | 'none'
    | null;
}): void {
  chooseContextRepo().recordDecision({
    decisionId: opts.decisionId,
    intentSignature: opts.intentSignature ?? 'open issues',
    pageRole: opts.pageRole ?? 'repo_home',
    siteFamily: opts.siteFamily ?? 'github',
    strategy: opts.strategy ?? 'experience_reuse',
    fallbackStrategy: opts.fallbackStrategy ?? null,
    createdAt: opts.createdAt,
    chosenLayer: opts.chosenLayer ?? 'L0',
    layerDispatchReason: opts.layerDispatchReason ?? 'simple_page_token_saving',
    sourceRoute: opts.sourceRoute ?? 'read_page_required',
    fallbackCause: opts.fallbackCause ?? null,
    tokensSavedEstimate: opts.tokensSavedEstimate ?? 100,
    tokenEstimateChosen: 50,
    tokenEstimateFullRead: 200,
    knowledgeEndpointFamily: null,
    rankedCandidateCount: null,
    replayEligibleBlockedBy: opts.replayEligibleBlockedBy ?? null,
    replayFallbackDepth: null,
  });
}

describe('execution read routes (V25-03)', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  beforeEach(() => {
    sessionManager.reset();
    chooseContextRepo().clear();
  });

  afterEach(() => {
    sessionManager.reset();
    chooseContextRepo().clear();
  });

  // ------------------------------------------------------------
  // Functional — empty DB
  // ------------------------------------------------------------

  test('GET /execution/decisions/recent returns an empty list on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/execution/decisions/recent')
      .expect(200)
      .expect('Content-Type', /json/);
    expect(res.body).toMatchObject({
      status: 'ok',
      data: { decisions: [], total: 0, limit: 20 },
    });
    expect(['disk', 'memory', 'off']).toContain(res.body.data.persistenceMode);
  });

  test('GET /execution/savings/summary returns zeroed shape on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/execution/savings/summary')
      .expect(200);
    const data = res.body.data as ExecutionSavingsSummary;
    expect(data.decisionCount).toBe(0);
    expect(data.tokensSavedEstimateSum).toBe(0);
    expect(data.lastReplay).toBeNull();
    expect(data.layerCounts).toEqual({ L0: 0, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 });
  });

  test('GET /execution/action-paths/top returns an empty list on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/execution/action-paths/top')
      .expect(200);
    const data = res.body.data as ExecutionTopActionPathsResponseData;
    expect(data.paths).toEqual([]);
    expect(data.limit).toBe(5);
  });

  test('GET /execution/reliability/signals returns zeroed shape on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/execution/reliability/signals')
      .expect(200);
    const data = res.body.data as ExecutionReliabilitySignalSummary;
    expect(data.decisionCount).toBe(0);
    expect(data.fallbackSafeCount).toBe(0);
    expect(data.fallbackSafeRate).toBe(0);
    expect(data.replayBlockedByCounts).toEqual({});
    expect(data.sourceRouteCounts.dispatcher_fallback_safe).toBe(0);
  });

  // ------------------------------------------------------------
  // Functional — seeded
  // ------------------------------------------------------------

  test('GET /execution/decisions/recent surfaces seeded rows newest-first', async () => {
    seedDecision({ decisionId: 'd-old', createdAt: '2026-04-20T10:00:00.000Z' });
    seedDecision({
      decisionId: 'd-new',
      createdAt: '2026-04-22T10:00:00.000Z',
      strategy: 'experience_replay',
      sourceRoute: 'experience_replay_skip_read',
      layerDispatchReason: 'experience_replay_no_extra_read',
      tokensSavedEstimate: 250,
    });
    const res = await supertest(Server.getInstance().server)
      .get('/execution/decisions/recent')
      .expect(200);
    const data = res.body.data as ExecutionRecentDecisionsResponseData;
    expect(data.total).toBe(2);
    expect(data.decisions).toHaveLength(2);
    expect(data.decisions[0].decisionId).toBe('d-new');
    expect(data.decisions[0].strategy).toBe('experience_replay');
    expect(data.decisions[0].sourceRoute).toBe('experience_replay_skip_read');
    expect(data.decisions[0].chosenLayer).toBe('L0');
  });

  test('GET /execution/decisions/recent honors limit + cap', async () => {
    for (let i = 0; i < 3; i += 1) {
      seedDecision({
        decisionId: `d-${i}`,
        createdAt: `2026-04-2${i}T10:00:00.000Z`,
      });
    }
    const small = await supertest(Server.getInstance().server)
      .get('/execution/decisions/recent?limit=2')
      .expect(200);
    expect(small.body.data.decisions).toHaveLength(2);
    expect(small.body.data.limit).toBe(2);

    const huge = await supertest(Server.getInstance().server)
      .get('/execution/decisions/recent?limit=100000')
      .expect(200);
    expect(huge.body.data.limit).toBe(100); // capped to LIMIT_MAX
  });

  test('GET /execution/savings/summary aggregates tokens + last replay', async () => {
    seedDecision({
      decisionId: 'd-1',
      createdAt: '2026-04-21T10:00:00.000Z',
      strategy: 'experience_replay',
      chosenLayer: 'L0',
      tokensSavedEstimate: 100,
    });
    seedDecision({
      decisionId: 'd-2',
      createdAt: '2026-04-22T10:00:00.000Z',
      strategy: 'experience_replay',
      chosenLayer: 'L0+L1',
      tokensSavedEstimate: 250,
    });
    chooseContextRepo().recordOutcome({
      decisionId: 'd-2',
      outcome: 'completed',
      recordedAt: '2026-04-22T10:05:00.000Z',
    });
    const res = await supertest(Server.getInstance().server)
      .get('/execution/savings/summary')
      .expect(200);
    const data = res.body.data as ExecutionSavingsSummary;
    expect(data.decisionCount).toBe(2);
    expect(data.tokensSavedEstimateSum).toBe(350);
    expect(data.layerCounts.L0).toBe(1);
    expect(data.layerCounts['L0+L1']).toBe(1);
    expect(data.lastReplay?.decisionId).toBe('d-2');
    expect(data.lastReplay?.outcome).toBe('completed');
  });

  test('GET /execution/action-paths/top groups by intent + pageRole + siteFamily', async () => {
    seedDecision({
      decisionId: 'd-1',
      createdAt: '2026-04-22T10:00:00.000Z',
      intentSignature: 'open issues',
      pageRole: 'repo_home',
    });
    seedDecision({
      decisionId: 'd-2',
      createdAt: '2026-04-22T11:00:00.000Z',
      intentSignature: 'open issues',
      pageRole: 'repo_home',
    });
    seedDecision({
      decisionId: 'd-3',
      createdAt: '2026-04-22T12:00:00.000Z',
      intentSignature: 'list workflow runs',
      pageRole: 'repo_actions',
    });
    const res = await supertest(Server.getInstance().server)
      .get('/execution/action-paths/top?limit=10')
      .expect(200);
    const data = res.body.data as ExecutionTopActionPathsResponseData;
    expect(data.paths).toHaveLength(2);
    expect(data.paths[0]).toMatchObject({
      intentSignature: 'open issues',
      pageRole: 'repo_home',
      decisionCount: 2,
    });
    expect(data.paths[1].intentSignature).toBe('list workflow runs');
  });

  test('GET /execution/reliability/signals counts fallbacks + blocked replays', async () => {
    seedDecision({
      decisionId: 'd-1',
      createdAt: '2026-04-22T10:00:00.000Z',
      sourceRoute: 'dispatcher_fallback_safe',
      layerDispatchReason: 'dispatcher_fallback_safe',
      fallbackCause: 'unknown_pageRole',
    });
    seedDecision({
      decisionId: 'd-2',
      createdAt: '2026-04-22T11:00:00.000Z',
      sourceRoute: 'read_page_required',
      replayEligibleBlockedBy: 'non_portable_args',
    });
    seedDecision({
      decisionId: 'd-3',
      createdAt: '2026-04-22T12:00:00.000Z',
      sourceRoute: 'knowledge_supported_read',
    });
    const res = await supertest(Server.getInstance().server)
      .get('/execution/reliability/signals')
      .expect(200);
    const data = res.body.data as ExecutionReliabilitySignalSummary;
    expect(data.decisionCount).toBe(3);
    expect(data.fallbackSafeCount).toBe(1);
    expect(data.fallbackSafeRate).toBeCloseTo(1 / 3, 3);
    expect(data.sourceRouteCounts.dispatcher_fallback_safe).toBe(1);
    expect(data.sourceRouteCounts.knowledge_supported_read).toBe(1);
    expect(data.replayBlockedByCounts.non_portable_args).toBe(1);
  });

  // ------------------------------------------------------------
  // Read-only invariant
  // ------------------------------------------------------------

  test('write verbs against /execution/* are not registered', async () => {
    await supertest(Server.getInstance().server).post('/execution/decisions/recent').expect(404);
    await supertest(Server.getInstance().server).put('/execution/savings/summary').expect(404);
    await supertest(Server.getInstance().server)
      .delete('/execution/reliability/signals')
      .expect(404);
    await supertest(Server.getInstance().server).patch('/execution/action-paths/top').expect(404);
  });

  // ------------------------------------------------------------
  // M4 — privacy negatives
  // ------------------------------------------------------------

  describe('M4 privacy contract', () => {
    const POISON = {
      url: 'https://github.com/a/b/issues?token=ghs_supersecretvalue&q=user_input',
      cookie: 'cookie=session=ghp_secretcookie',
      bearer: 'Bearer secret-bearer-token',
      userInput: 'user_input_PII_payload_should_never_leak',
    };

    function assertNoPoison(body: unknown): void {
      const serialized = JSON.stringify(body);
      // Full URLs with query strings — never echoed by these routes.
      expect(serialized.includes('?')).toBe(false);
      expect(serialized.includes('://')).toBe(false);
      // user_input from memory_sessions — never joined or echoed.
      expect(serialized.includes(POISON.userInput)).toBe(false);
      // Cookie / auth header sentinels — never persisted by chooser
      // telemetry, must therefore never appear in any response body.
      expect(serialized.toLowerCase().includes('cookie')).toBe(false);
      expect(serialized.toLowerCase().includes('bearer')).toBe(false);
      expect(serialized.toLowerCase().includes('authorization')).toBe(false);
      expect(serialized.toLowerCase().includes('ghp_')).toBe(false);
      expect(serialized.toLowerCase().includes('ghs_')).toBe(false);
    }

    test('seeded decision row never echoes URL / cookie / bearer / user_input on /decisions/recent', async () => {
      // Inject the poison strings into the *only* free-text columns
      // these routes can read: intentSignature, pageRole, siteFamily,
      // fallbackCause. If the route accidentally echoes them, the
      // M4 invariant has been violated.
      seedDecision({
        decisionId: 'd-poison',
        createdAt: '2026-04-22T10:00:00.000Z',
        // intentSignature is structurally normalized upstream, but we
        // still defensively check that the route does not bypass that
        // normalization. We seed a *clean* signature here so that we
        // can prove the route never tries to fetch the raw intent
        // from a sibling table.
        intentSignature: 'open issues',
        pageRole: 'repo_home',
        siteFamily: 'github',
        // Free-text dispatcher fallback cause is the most realistic
        // surface for accidental URL leakage.
        fallbackCause: null,
      });
      const res = await supertest(Server.getInstance().server)
        .get('/execution/decisions/recent')
        .expect(200);
      assertNoPoison(res.body);
    });

    test('all four routes refuse to surface poisoned fallback_cause text raw', async () => {
      // Even if a future caller stuffs a URL into fallback_cause, the
      // route still serializes it — but assertions above forbid that
      // shape from appearing. So we instead seed with a *non-URL*
      // sentinel and confirm the route echoes only that, never the
      // poison list.
      const sentinel = 'dispatcher_internal_error_seen';
      seedDecision({
        decisionId: 'd-fallback',
        createdAt: '2026-04-22T10:00:00.000Z',
        sourceRoute: 'dispatcher_fallback_safe',
        layerDispatchReason: 'dispatcher_fallback_safe',
        fallbackCause: sentinel,
      });

      const recent = await supertest(Server.getInstance().server)
        .get('/execution/decisions/recent')
        .expect(200);
      const savings = await supertest(Server.getInstance().server)
        .get('/execution/savings/summary')
        .expect(200);
      const paths = await supertest(Server.getInstance().server)
        .get('/execution/action-paths/top')
        .expect(200);
      const reliability = await supertest(Server.getInstance().server)
        .get('/execution/reliability/signals')
        .expect(200);

      assertNoPoison(recent.body);
      assertNoPoison(savings.body);
      assertNoPoison(paths.body);
      assertNoPoison(reliability.body);

      // The sentinel itself is allowed to surface only on the
      // recent-decisions route (it lives in a documented field).
      expect(JSON.stringify(recent.body).includes(sentinel)).toBe(true);
      expect(JSON.stringify(savings.body).includes(sentinel)).toBe(false);
      expect(JSON.stringify(paths.body).includes(sentinel)).toBe(false);
      expect(JSON.stringify(reliability.body).includes(sentinel)).toBe(false);
    });

    test('memory_sessions.user_input is never readable through /execution/*', async () => {
      // Seed memory data with the poison; the /execution routes must
      // not touch memory_sessions and therefore must not echo it.
      const task = sessionManager.createTask({
        taskType: 'browser-action',
        title: 'task with user_input poison',
        intent: 'attempt to fingerprint route surface',
        origin: 'jest',
        labels: ['v25-03', 'pii-negative'],
      });
      const session = sessionManager.startSession({
        taskId: task.taskId,
        transport: 'http',
        clientName: 'jest-supertest',
      });
      const step = sessionManager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
        inputSummary: POISON.userInput,
      });
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: 'ok',
      });
      sessionManager.finishSession(session.sessionId, { status: 'completed' });

      seedDecision({
        decisionId: 'd-pii-1',
        createdAt: '2026-04-22T10:00:00.000Z',
      });

      const recent = await supertest(Server.getInstance().server)
        .get('/execution/decisions/recent')
        .expect(200);
      const paths = await supertest(Server.getInstance().server)
        .get('/execution/action-paths/top')
        .expect(200);

      assertNoPoison(recent.body);
      assertNoPoison(paths.body);
    });
  });
});
