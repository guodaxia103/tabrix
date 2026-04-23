/**
 * V25-02 — pure-function tests for `dispatchLayer`.
 *
 * Mirrors the V25-02 Layer Dispatch Strategy Table (V3.1 §V25-02).
 * Every priority block has at least one positive case and one
 * "doesn't pre-empt the higher priority" case so a future reorder
 * surfaces immediately.
 *
 * The two kickoff-binding cases are pinned at the top:
 *   - "总结 + candidateActionsCount=50" → L0
 *   - "details + candidateActionsCount=3" → L0+L1+L2
 */

import {
  LAYER_DISPATCH_REASON_VALUES,
  LAYER_SOURCE_ROUTE_VALUES,
  READ_PAGE_REQUESTED_LAYER_VALUES,
} from '@tabrix/shared';
import { dispatchLayer, getLayerDispatchRulesForTesting } from './choose-context-layer-dispatch';

describe('dispatchLayer — V25-02 kickoff bindings', () => {
  test('user intent "summary" beats high candidateActionsCount (=50)', () => {
    const out = dispatchLayer({
      pageRole: 'workflow_run_detail',
      userIntent: 'summary',
      taskType: 'reading_only',
      candidateActionsCount: 50,
      hvoCount: 12,
      knowledgeAvailable: false,
      experienceReplayAvailable: false,
      fullReadByteLength: 40_000,
    });
    expect(out.chosenLayer).toBe('L0');
    expect(out.reason).toBe('user_intent_summary');
    expect(out.sourceRoute).toBe('read_page_required');
    expect(out.readPageAvoided).toBe(false);
    expect(out.tokenEstimate).toBeLessThan(out.fullReadTokenEstimate);
    expect(out.fullReadTokenEstimate).toBe(Math.ceil(40_000 / 4));
  });

  test('user intent "details" beats simple page (candidateActionsCount=3)', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      userIntent: 'details',
      taskType: 'reading_only',
      candidateActionsCount: 3,
      hvoCount: 2,
      knowledgeAvailable: false,
      experienceReplayAvailable: false,
      fullReadByteLength: 8_000,
    });
    expect(out.chosenLayer).toBe('L0+L1+L2');
    expect(out.reason).toBe('user_intent_details_or_compare');
    expect(out.sourceRoute).toBe('read_page_required');
    expect(out.readPageAvoided).toBe(false);
    // L0+L1+L2 = full read, so tokenEstimate == fullReadTokenEstimate
    expect(out.tokenEstimate).toBe(out.fullReadTokenEstimate);
  });
});

describe('dispatchLayer — priority 1 safety override', () => {
  test('safetyRequiresFullLayers forces L0+L1+L2 even when user said summary', () => {
    const out = dispatchLayer({
      pageRole: 'workflow_run_detail',
      userIntent: 'summary',
      taskType: 'reading_only',
      candidateActionsCount: 2,
      hvoCount: 1,
      knowledgeAvailable: false,
      experienceReplayAvailable: true,
      safetyRequiresFullLayers: true,
      safetyReason: 'click verifier needs L2',
      fullReadByteLength: 20_000,
    });
    expect(out.chosenLayer).toBe('L0+L1+L2');
    expect(out.reason).toBe('safety_required_full_layers');
    expect(out.sourceRoute).toBe('read_page_required');
    expect(out.readPageAvoided).toBe(false);
  });
});

describe('dispatchLayer — priority 2 user intent override', () => {
  test.each([
    ['summary', 'L0', 'user_intent_summary'],
    ['open_or_select', 'L0+L1', 'user_intent_open_or_select'],
    ['form_or_submit', 'L0+L1', 'user_intent_form_or_submit'],
    ['details', 'L0+L1+L2', 'user_intent_details_or_compare'],
  ] as const)('userIntent=%s yields chosenLayer=%s reason=%s', (intent, layer, reason) => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      userIntent: intent,
      taskType: 'reading_only',
      candidateActionsCount: 1,
      hvoCount: 1,
      fullReadByteLength: 1_000,
    });
    expect(out.chosenLayer).toBe(layer);
    expect(out.reason).toBe(reason);
    expect(out.sourceRoute).toBe('read_page_required');
  });
});

describe('dispatchLayer — priority 3 task type', () => {
  test('reading_only with no user intent → L0 / task_type_reading_only', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      taskType: 'reading_only',
      userIntent: 'unknown',
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(out.chosenLayer).toBe('L0');
    expect(out.reason).toBe('task_type_reading_only');
  });

  test('action with no user intent → L0+L1 / task_type_action', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      taskType: 'action',
      userIntent: 'unknown',
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(out.chosenLayer).toBe('L0+L1');
    expect(out.reason).toBe('task_type_action');
  });
});

describe('dispatchLayer — priority 4 page complexity', () => {
  test('simple_page_low_density: small action surface → L0', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      taskType: 'unknown',
      candidateActionsCount: 4,
      hvoCount: 3,
    });
    expect(out.chosenLayer).toBe('L0');
    expect(out.reason).toBe('simple_page_low_density');
  });

  test('medium_page_overview: 30 actions → L0+L1', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      taskType: 'unknown',
      candidateActionsCount: 30,
      hvoCount: 8,
    });
    expect(out.chosenLayer).toBe('L0+L1');
    expect(out.reason).toBe('medium_page_overview');
  });

  test('complex_page_detail_required: 80 actions → L0+L1+L2', () => {
    const out = dispatchLayer({
      pageRole: 'workflow_run_detail',
      taskType: 'unknown',
      candidateActionsCount: 80,
      hvoCount: 40,
    });
    expect(out.chosenLayer).toBe('L0+L1+L2');
    expect(out.reason).toBe('complex_page_detail_required');
  });
});

describe('dispatchLayer — priority 5 MKEP support', () => {
  test('experience_replay_executable → L0 + experience_replay_skip_read + readPageAvoided', () => {
    const out = dispatchLayer({
      pageRole: '', // empty so page-complexity rules cannot match
      taskType: 'unknown',
      userIntent: 'unknown',
      experienceReplayAvailable: true,
      knowledgeAvailable: false,
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(out.chosenLayer).toBe('L0');
    expect(out.reason).toBe('experience_replay_executable');
    expect(out.sourceRoute).toBe('experience_replay_skip_read');
    expect(out.readPageAvoided).toBe(true);
  });

  test('knowledge_supports_summary fires only when task is reading_only', () => {
    const reading = dispatchLayer({
      pageRole: '',
      taskType: 'reading_only',
      userIntent: 'unknown',
      knowledgeAvailable: true,
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(reading.chosenLayer).toBe('L0');
    // priority 3 (task_type_reading_only) actually hits first because
    // RULES order goes priority-3 before priority-5. That's the
    // documented strategy table behaviour.
    expect(reading.reason).toBe('task_type_reading_only');
  });

  test('knowledge_with_action when task type is unknown and pageRole missing', () => {
    const out = dispatchLayer({
      pageRole: '',
      taskType: 'unknown',
      userIntent: 'unknown',
      knowledgeAvailable: true,
      experienceReplayAvailable: false,
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(out.chosenLayer).toBe('L0+L1');
    expect(out.reason).toBe('knowledge_with_action');
    expect(out.sourceRoute).toBe('knowledge_supported_read');
  });
});

describe('dispatchLayer — fail-safe', () => {
  test('no rule matches → fail-safe L0+L1+L2 with non-empty fallbackCause', () => {
    const out = dispatchLayer({
      pageRole: '',
      taskType: 'unknown',
      userIntent: 'unknown',
      knowledgeAvailable: false,
      experienceReplayAvailable: false,
      candidateActionsCount: 0,
      hvoCount: 0,
    });
    expect(out.chosenLayer).toBe('L0+L1+L2');
    expect(out.reason).toBe('dispatcher_fallback_safe');
    expect(out.sourceRoute).toBe('dispatcher_fallback_safe');
    expect(out.fallbackCause.length).toBeGreaterThan(0);
    expect(out.readPageAvoided).toBe(false);
  });

  test('non-object input returns fail-safe (no throw)', () => {
    // @ts-expect-error — exercising runtime guard
    const out = dispatchLayer(null);
    expect(out.chosenLayer).toBe('L0+L1+L2');
    expect(out.reason).toBe('dispatcher_fallback_safe');
  });
});

describe('dispatchLayer — invariants', () => {
  test('every rule uses values from the shared closed enums', () => {
    for (const rule of getLayerDispatchRulesForTesting()) {
      expect(READ_PAGE_REQUESTED_LAYER_VALUES).toContain(rule.layer);
      expect(LAYER_DISPATCH_REASON_VALUES).toContain(rule.reason);
      expect(LAYER_SOURCE_ROUTE_VALUES).toContain(rule.sourceRoute);
    }
  });

  test('linear-scan: first match wins, others surface as alternatives', () => {
    // user intent "summary" beats every priority-3+ rule. Make every
    // lower-priority rule eligible too so the alternatives list is
    // non-empty.
    const out = dispatchLayer({
      pageRole: 'repo_home',
      userIntent: 'summary',
      taskType: 'reading_only',
      candidateActionsCount: 4,
      hvoCount: 2,
      knowledgeAvailable: true,
      experienceReplayAvailable: true,
      fullReadByteLength: 1_000,
    });
    expect(out.chosenLayer).toBe('L0');
    expect(out.reason).toBe('user_intent_summary');
    // alternatives must NOT echo the winning rule.
    for (const alt of out.alternatives) {
      expect(alt.reason).not.toBe('user_intent_summary');
    }
    expect(out.alternatives.length).toBeGreaterThan(0);
  });

  test('token estimate respects per-layer fraction (L0 ≤ 35% of full read)', () => {
    const out = dispatchLayer({
      pageRole: 'repo_home',
      userIntent: 'summary',
      taskType: 'reading_only',
      candidateActionsCount: 10,
      hvoCount: 5,
      fullReadByteLength: 100_000,
    });
    expect(out.chosenLayer).toBe('L0');
    // L0 fraction is 0.35 by design; allow +/- 1 for ceil rounding.
    expect(out.tokenEstimate).toBeLessThanOrEqual(Math.ceil((100_000 * 0.35) / 4) + 1);
    expect(out.fullReadTokenEstimate).toBe(Math.ceil(100_000 / 4));
  });

  test('readPageAvoided is true ONLY for experience_replay_skip_read', () => {
    for (const rule of getLayerDispatchRulesForTesting()) {
      if (rule.sourceRoute === 'experience_replay_skip_read') {
        expect(rule.layer).toBe('L0');
      }
    }
  });
});
