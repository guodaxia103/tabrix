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
});
