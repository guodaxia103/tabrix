/**
 * V24-01 closeout: end-to-end "real aggregated row is replayable" test.
 *
 * What this proves (and why the existing unit tests do not):
 *   - `experience-aggregator.test.ts` proves the aggregator now writes
 *     `args` for supported step kinds, but does not exercise the
 *     chooser or the replay handler.
 *   - `choose-context.test.ts` and `experience-replay.test.ts` use
 *     synthetic / hand-crafted `ExperienceActionPathRow` fixtures.
 *     They cannot demonstrate that the aggregator → chooser → handler
 *     chain works on a row that came from a real `memory_sessions` /
 *     `memory_steps` insert path.
 *
 * This test wires the three together against an in-memory SQLite DB
 * and asserts:
 *   1. After the aggregator runs, the resulting Experience row carries
 *      replay-ready `args` (closes Codex finding #1).
 *   2. `tabrix_choose_context` selects strategy `experience_replay`
 *      for that row (closes Codex finding #2).
 *   3. `handleExperienceReplay` runs the row to completion against a
 *      stub bridge — proving the engine's `applySubstitutions` no
 *      longer fails closed on real aggregator output.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExecutionSession, ExecutionStep, Task } from '../../src/execution/types';
import {
  ExperienceAggregator,
  ExperienceQueryService,
  ExperienceRepository,
} from '../memory/experience';
import {
  PageSnapshotRepository,
  SessionRepository,
  StepRepository,
  TaskRepository,
} from '../memory/db';
import { openMemoryDb } from '../memory/db/client';
import { runTabrixChooseContext } from './choose-context';
import {
  REPLAY_INVALID_INTENT_TAG,
  REPLAY_SESSION_TASK_INTENT_PREFIX,
  handleExperienceReplay,
  type DispatchBridgedFn,
  type ReplayStepRecorder,
} from './experience-replay';

interface E2EBootstrap {
  taskRepo: TaskRepository;
  sessionRepo: SessionRepository;
  stepRepo: StepRepository;
  snapshotRepo: PageSnapshotRepository;
  experienceRepo: ExperienceRepository;
  experienceQuery: ExperienceQueryService;
  aggregator: ExperienceAggregator;
  close: () => void;
}

function bootstrap(): E2EBootstrap {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const snapshotRepo = new PageSnapshotRepository(db);
  const experienceRepo = new ExperienceRepository(db);
  const experienceQuery = new ExperienceQueryService(experienceRepo);
  const aggregator = new ExperienceAggregator(
    db,
    sessionRepo,
    stepRepo,
    snapshotRepo,
    experienceRepo,
  );
  return {
    taskRepo,
    sessionRepo,
    stepRepo,
    snapshotRepo,
    experienceRepo,
    experienceQuery,
    aggregator,
    close: () => db.close(),
  };
}

function insertTask(repo: TaskRepository, intent: string): Task {
  const task: Task = {
    taskId: 'e2e-task-1',
    taskType: 'browser-action',
    title: 'task',
    intent,
    origin: 'jest',
    labels: [],
    status: 'completed',
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
  };
  repo.insert(task);
  return task;
}

function insertCompletedSession(repo: SessionRepository, sessionId: string): ExecutionSession {
  const session: ExecutionSession = {
    sessionId,
    taskId: 'e2e-task-1',
    transport: 'stdio',
    clientName: 'jest',
    startedAt: '2026-04-22T00:00:01.000Z',
    endedAt: '2026-04-22T00:00:02.000Z',
    status: 'completed',
    steps: [],
  };
  repo.insert(session);
  return session;
}

function insertStep(
  repo: StepRepository,
  overrides: Pick<ExecutionStep, 'stepId' | 'sessionId' | 'index' | 'toolName'> &
    Partial<Pick<ExecutionStep, 'inputSummary' | 'artifactRefs'>>,
): void {
  const step: ExecutionStep = {
    stepId: overrides.stepId,
    sessionId: overrides.sessionId,
    index: overrides.index,
    toolName: overrides.toolName,
    stepType: 'tool_call',
    status: 'completed',
    inputSummary: overrides.inputSummary,
    startedAt: '2026-04-22T00:00:01.100Z',
    endedAt: '2026-04-22T00:00:01.200Z',
    artifactRefs: overrides.artifactRefs ?? [],
  };
  repo.insert(step);
}

function insertSnapshot(
  repo: PageSnapshotRepository,
  params: { snapshotId: string; stepId: string; pageRole: string },
): void {
  repo.insert({
    snapshotId: params.snapshotId,
    stepId: params.stepId,
    pageRole: params.pageRole,
    fallbackUsed: false,
    interactiveCount: 0,
    candidateActionCount: 0,
    highValueObjectCount: 0,
    capturedAt: '2026-04-22T00:00:01.500Z',
  });
}

type RecorderSpy = ReplayStepRecorder & {
  readonly startCalls: number;
  readonly completeCalls: number;
  readonly failCalls: number;
};

function makeRecorder(): RecorderSpy {
  // Inline getters (NOT Object.assign'd after the fact) so the
  // descriptors stay accessor-typed - see comment in
  // `native-tool-handlers.test.ts::makeRecorderSpy` for context.
  const state = { startCalls: 0, completeCalls: 0, failCalls: 0 };
  let nextId = 0;
  return {
    startStep: () => {
      state.startCalls += 1;
      return `e2e-step-${nextId++}`;
    },
    completeStep: () => {
      state.completeCalls += 1;
    },
    failStep: () => {
      state.failCalls += 1;
    },
    get startCalls() {
      return state.startCalls;
    },
    get completeCalls() {
      return state.completeCalls;
    },
    get failCalls() {
      return state.failCalls;
    },
  };
}

function okBridge(): DispatchBridgedFn {
  return async (_toolName, _args): Promise<CallToolResult> => ({
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ historyRef: 'h_e2e' }),
      },
    ],
    isError: false,
  });
}

/**
 * V24-01 portability follow-up helper: a bridge that records every
 * `(toolName, args)` it was dispatched with. Lets the
 * "portable extraction succeeded" tests assert exactly what reached
 * the bridged tool, so we can fail loudly if a per-snapshot `ref`
 * ever leaks through the aggregator → chooser → engine chain.
 */
function recordingBridge(): {
  dispatch: DispatchBridgedFn;
  calls: Array<{ toolName: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const dispatch: DispatchBridgedFn = async (toolName, args) => {
    calls.push({ toolName, args });
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ historyRef: 'h_e2e' }),
        },
      ],
      isError: false,
    };
  };
  return { dispatch, calls };
}

describe('V24-01 closeout: real-aggregated-row → chooser → replay handler', () => {
  it('aggregator-produced row is routed to experience_replay and the engine succeeds', async () => {
    const {
      taskRepo,
      sessionRepo,
      stepRepo,
      snapshotRepo,
      experienceRepo,
      experienceQuery,
      aggregator,
      close,
    } = bootstrap();
    try {
      // ---- 1. Seed a real Memory session with two supported steps -----
      insertTask(taskRepo, 'open repo issues tab');
      insertCompletedSession(sessionRepo, 'e2e-session-1');
      // V24-01 supported step kind #1: chrome_click_element. The
      // recorded `tabId` MUST be stripped by the aggregator (it is
      // session-local; the replay engine injects the operator-supplied
      // `targetTabId` through `withTargetTab`).
      insertStep(stepRepo, {
        stepId: 'e2e-step-click',
        sessionId: 'e2e-session-1',
        index: 1,
        toolName: 'chrome_click_element',
        inputSummary: JSON.stringify({ tabId: 13, selector: '.issues-tab' }),
        artifactRefs: ['history://e2e-click'],
      });
      // V24-01 supported step kind #2: chrome_fill_or_select.
      insertStep(stepRepo, {
        stepId: 'e2e-step-fill',
        sessionId: 'e2e-session-1',
        index: 2,
        toolName: 'chrome_fill_or_select',
        inputSummary: JSON.stringify({
          tabId: 13,
          selector: '.search-input',
          value: 'first query',
        }),
        artifactRefs: [],
      });
      // pageRole MUST be in the v1 GitHub allowlist for the chooser to
      // even consider experience_replay (issues_list is one of the
      // canonical V24-01 entries).
      insertSnapshot(snapshotRepo, {
        snapshotId: 'e2e-snap',
        stepId: 'e2e-step-click',
        pageRole: 'issues_list',
      });

      // ---- 2. Run the real aggregator --------------------------------
      const result = aggregator.projectPendingSessions('2026-04-22T00:00:10.000Z');
      expect(result).toEqual({ scanned: 1, projected: 1 });

      // The closure proof: the aggregated row carries args (tabId
      // stripped) ready for the replay engine.
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      const aggregatedRow = rows[0];
      expect(aggregatedRow.pageRole).toBe('issues_list');
      expect(aggregatedRow.stepSequence).toEqual([
        {
          toolName: 'chrome_click_element',
          status: 'completed',
          historyRef: 'history://e2e-click',
          args: { selector: '.issues-tab' },
        },
        {
          toolName: 'chrome_fill_or_select',
          status: 'completed',
          historyRef: null,
          args: { selector: '.search-input', value: 'first query' },
        },
      ]);

      // ---- 3. Chooser routes to experience_replay --------------------
      const decision = runTabrixChooseContext(
        { intent: 'open repo issues tab', pageRole: 'issues_list' },
        {
          experience: experienceQuery,
          knowledgeApi: null,
          capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
        },
      );
      expect(decision.status).toBe('ok');
      expect(decision.strategy).toBe('experience_replay');
      expect(decision.fallbackStrategy).toBe('experience_reuse');
      expect(decision.artifacts?.[0]?.ref).toBe(aggregatedRow.actionPathId);

      // ---- 4. Replay handler successfully runs the real row ---------
      const recorder = makeRecorder();
      let lastIntent: string | null = null;
      const replayResult = await handleExperienceReplay(
        {
          actionPathId: aggregatedRow.actionPathId,
          targetTabId: 999,
        },
        {
          experience: experienceRepo,
          dispatchBridged: okBridge(),
          recorder,
          updateTaskIntent: (intent) => {
            lastIntent = intent;
          },
          capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
          persistenceMode: 'memory',
        },
      );

      expect(replayResult.status).toBe('ok');
      expect(replayResult.evidenceRefs).toHaveLength(2);
      // Aggregator special-case (brief §7): the handler MUST tag the
      // wrapper session with the `experience_replay:<id>` prefix so
      // the next aggregator pass compounds the success delta back
      // onto this row instead of seeding a new bucket.
      expect(lastIntent).toBe(`${REPLAY_SESSION_TASK_INTENT_PREFIX}${aggregatedRow.actionPathId}`);
      expect(lastIntent).not.toBe(REPLAY_INVALID_INTENT_TAG);
      // Recorder discipline (brief §6): one row per attempted step.
      expect(recorder.startCalls).toBe(2);
      expect(recorder.completeCalls).toBe(2);
      expect(recorder.failCalls).toBe(0);
    } finally {
      close();
    }
  });

  // ---------------------------------------------------------------------------
  // V24-01 portability follow-up. Codex's second-pass review insisted
  // we cover real `inputSummary` payloads that carry the legacy
  // `ref`-style accessibility handles - not just hand-crafted rows.
  // The brief permits two correct outcomes for such rows; both are
  // pinned below as deterministic e2e cases:
  //
  //   A) "ref-only" payload (no portable target after stripping):
  //      the chooser MUST fall back to `experience_reuse` rather
  //      than route to `experience_replay`. Otherwise replay would
  //      re-dispatch a per-snapshot ref into a brand-new session
  //      and either misclick or hit a dead handle.
  //
  //   B) "selector + ref" payload (portable selector survives):
  //      the chooser routes to `experience_replay` AND the engine's
  //      bridge call reaches `chrome_click_element` WITHOUT the
  //      session-local `ref` / `tabId` / `windowId` fields.
  //
  // Both are end-to-end through the real aggregator + chooser +
  // handler stack - no synthetic `ExperienceActionPathRow` fixtures.
  // ---------------------------------------------------------------------------

  it('downgrades a ref-only inputSummary row to experience_reuse (no portable target)', async () => {
    const {
      taskRepo,
      sessionRepo,
      stepRepo,
      snapshotRepo,
      experienceRepo,
      experienceQuery,
      aggregator,
      close,
    } = bootstrap();
    try {
      insertTask(taskRepo, 'click via ref only');
      insertCompletedSession(sessionRepo, 'e2e-session-ref');
      // Realistic legacy payload: tabId + per-snapshot `ref`. No
      // selector, no candidateAction. After portability filtering
      // there is NO portable target field, so the aggregator must
      // refuse to write `args` and the chooser must NOT route this
      // row to `experience_replay`.
      insertStep(stepRepo, {
        stepId: 'e2e-step-ref',
        sessionId: 'e2e-session-ref',
        index: 1,
        toolName: 'chrome_click_element',
        inputSummary: JSON.stringify({ tabId: 13, ref: 'ref_per_snapshot_xyz' }),
        artifactRefs: ['history://e2e-ref'],
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'e2e-snap-ref',
        stepId: 'e2e-step-ref',
        pageRole: 'issues_list',
      });

      aggregator.projectPendingSessions('2026-04-22T00:00:10.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      // Aggregator boundary: portable allowlist refused the payload,
      // so `args` stays absent.
      expect(rows[0].stepSequence[0]).not.toHaveProperty('args');

      const decision = runTabrixChooseContext(
        { intent: 'click via ref only', pageRole: 'issues_list' },
        {
          experience: experienceQuery,
          knowledgeApi: null,
          capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
        },
      );
      expect(decision.status).toBe('ok');
      // Chooser boundary: same allowlist rejects the row even with
      // the capability ON, so we drop to the read-only reuse branch.
      expect(decision.strategy).toBe('experience_reuse');
      expect(decision.fallbackStrategy).toBe('read_page_required');
      expect(decision.artifacts?.[0]?.ref).toBe(rows[0].actionPathId);
    } finally {
      close();
    }
  });

  it('strips ref/tabId from inputSummary and replays without leaking them to the bridge', async () => {
    const {
      taskRepo,
      sessionRepo,
      stepRepo,
      snapshotRepo,
      experienceRepo,
      experienceQuery,
      aggregator,
      close,
    } = bootstrap();
    try {
      insertTask(taskRepo, 'click with mixed ref+selector');
      insertCompletedSession(sessionRepo, 'e2e-session-mixed');
      // Realistic legacy payload: portable selector survives, but
      // session-local `ref` / `tabId` / `windowId` MUST NOT make it
      // through to the bridge call - replaying a per-snapshot ref in
      // a brand-new session is the exact bug this PR fixes.
      insertStep(stepRepo, {
        stepId: 'e2e-step-mixed',
        sessionId: 'e2e-session-mixed',
        index: 1,
        toolName: 'chrome_click_element',
        inputSummary: JSON.stringify({
          tabId: 13,
          windowId: 4,
          ref: 'ref_per_snapshot_xyz',
          selector: '#issues-tab',
          candidateAction: {
            targetRef: 'ref_per_snapshot_xyz',
            locatorChain: [
              { type: 'css', value: '#issues-tab' },
              { type: 'ref', value: 'ref_per_snapshot_xyz' },
            ],
          },
        }),
        artifactRefs: ['history://e2e-mixed'],
      });
      insertSnapshot(snapshotRepo, {
        snapshotId: 'e2e-snap-mixed',
        stepId: 'e2e-step-mixed',
        pageRole: 'issues_list',
      });

      aggregator.projectPendingSessions('2026-04-22T00:00:10.000Z');
      const rows = experienceRepo.listActionPaths();
      expect(rows).toHaveLength(1);
      const aggregatedRow = rows[0];
      // Aggregator boundary: ref / tabId / windowId / legacy
      // candidateAction.targetRef / type=ref locator entries are all
      // dropped; selector + the css half of locatorChain survive.
      expect(aggregatedRow.stepSequence[0].args).toEqual({
        selector: '#issues-tab',
        candidateAction: {
          locatorChain: [{ type: 'css', value: '#issues-tab' }],
        },
      });

      const decision = runTabrixChooseContext(
        { intent: 'click with mixed ref+selector', pageRole: 'issues_list' },
        {
          experience: experienceQuery,
          knowledgeApi: null,
          capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
        },
      );
      expect(decision.strategy).toBe('experience_replay');

      const recorder = makeRecorder();
      const bridge = recordingBridge();
      const replayResult = await handleExperienceReplay(
        {
          actionPathId: aggregatedRow.actionPathId,
          targetTabId: 999,
        },
        {
          experience: experienceRepo,
          dispatchBridged: bridge.dispatch,
          recorder,
          updateTaskIntent: () => {},
          capabilityEnv: { TABRIX_POLICY_CAPABILITIES: 'experience_replay' },
          persistenceMode: 'memory',
        },
      );

      expect(replayResult.status).toBe('ok');
      expect(bridge.calls).toHaveLength(1);
      // The actual safety property: the dispatched args carry ONLY
      // the portable subset plus the operator-supplied `targetTabId`
      // (re-injected by `withTargetTab` because the recorded `tabId`
      // was stripped). No `ref`, no original `tabId: 13`, no
      // `windowId`, no legacy `ref_*` candidateAction.
      expect(bridge.calls[0]).toEqual({
        toolName: 'chrome_click_element',
        args: {
          selector: '#issues-tab',
          candidateAction: {
            locatorChain: [{ type: 'css', value: '#issues-tab' }],
          },
          tabId: 999,
        },
      });
      expect(bridge.calls[0].args).not.toHaveProperty('ref');
      expect(bridge.calls[0].args).not.toHaveProperty('windowId');
      expect(recorder.startCalls).toBe(1);
      expect(recorder.completeCalls).toBe(1);
      expect(recorder.failCalls).toBe(0);
    } finally {
      close();
    }
  });
});
