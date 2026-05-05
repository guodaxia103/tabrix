/**
 * V27-03 — unit tests for the v2.7 Action Outcome Classifier and the
 * DOM-region hash-rule. Every test feeds typed
 * `ActionOutcomeEventEnvelope` records; none of them touches the
 * bridge, the DOM, or any `chrome.*` API.
 *
 * The classifier is the public V27-03 contract surface, so these tests
 * pin (a) every documented closed-enum verdict, (b) the confidence
 * calibration described in `action-outcome-classifier.ts`, and (c) the
 * inclusion / exclusion partition used by the DOM-region hash rule.
 */
import type {
  ActionKind,
  ActionOutcomeEventEnvelope,
  ActionSignal,
  ActionSignalKind,
} from '@tabrix/shared';
import {
  ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE,
  classifyActionOutcome,
  describeDomRegionSelectionRule,
  isKnownActionSignalKind,
  selectDomRegionSignalsForOutcome,
} from './action-outcome-classifier';

const T0 = 1_700_000_000_000;

function makeSignal(overrides: Partial<ActionSignal> & { kind: ActionSignalKind }): ActionSignal {
  return {
    kind: overrides.kind,
    observedAtMs: overrides.observedAtMs ?? T0 + 100,
    regionTag: overrides.regionTag ?? null,
    host: overrides.host ?? null,
    pathPattern: overrides.pathPattern ?? null,
    newTabId: overrides.newTabId ?? null,
  };
}

function makeEnvelope(
  overrides: Partial<ActionOutcomeEventEnvelope> & { signals: ActionSignal[] },
): ActionOutcomeEventEnvelope {
  return {
    actionId: overrides.actionId ?? 'act-1',
    actionKind: overrides.actionKind ?? ('click' as ActionKind),
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/list',
    observedAtMs: overrides.observedAtMs ?? T0,
    signals: overrides.signals,
  };
}

describe('action-outcome-classifier — classifyActionOutcome', () => {
  const now = () => T0 + 9_999;

  it('returns no_observed_change with confidence 1.0 for an empty timeline', () => {
    const env = makeEnvelope({ signals: [] });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('no_observed_change');
    expect(out.outcomeConfidence).toBe(1);
    expect(out.observedSignalKinds).toEqual([]);
    expect(out.actionId).toBe('act-1');
    expect(out.producedAtMs).toBe(T0 + 9_999);
  });

  it('classifies a same-tab navigation from lifecycle_committed alone', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'lifecycle_committed' })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('navigated_same_tab');
    expect(out.outcomeConfidence).toBeCloseTo(0.85, 5);
    expect(out.observedSignalKinds).toEqual(['lifecycle_committed']);
  });

  it('boosts confidence to 0.95 when navigation is corroborated by dom_region_changed', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({ kind: 'lifecycle_committed' }),
        makeSignal({ kind: 'dom_region_changed', regionTag: 'main_list' }),
      ],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('navigated_same_tab');
    expect(out.outcomeConfidence).toBeCloseTo(0.95, 5);
    expect(out.observedSignalKinds).toEqual(['dom_region_changed', 'lifecycle_committed']);
  });

  it('classifies a tab_created signal as navigated_new_tab', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'tab_created', newTabId: 200 })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('navigated_new_tab');
    expect(out.outcomeConfidence).toBeCloseTo(0.85, 5);
  });

  it('classifies a dialog_opened signal as modal_opened', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'dialog_opened' })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('modal_opened');
    expect(out.outcomeConfidence).toBeCloseTo(0.85, 5);
  });

  it('classifies dom_region_changed without navigation as spa_partial_update', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'dom_region_changed', regionTag: 'main_list' })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('spa_partial_update');
    expect(out.outcomeConfidence).toBeCloseTo(0.85, 5);
  });

  it('boosts spa_partial_update confidence to 0.95 with corroborating network signal', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({ kind: 'dom_region_changed', regionTag: 'main_list' }),
        makeSignal({
          kind: 'network_completed',
          host: 'example.test',
          pathPattern: '/api/items',
        }),
      ],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('spa_partial_update');
    expect(out.outcomeConfidence).toBeCloseTo(0.95, 5);
  });

  it('returns multiple_signals when navigation and modal both fire', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'lifecycle_committed' }), makeSignal({ kind: 'dialog_opened' })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('multiple_signals');
    expect(out.outcomeConfidence).toBeGreaterThanOrEqual(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE);
    expect(out.observedSignalKinds).toEqual(['dialog_opened', 'lifecycle_committed']);
  });

  it('returns ambiguous when only network fires (every page emits ambient XHR)', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({
          kind: 'network_completed',
          host: 'example.test',
          pathPattern: '/api/poll',
        }),
      ],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('ambiguous');
    expect(out.outcomeConfidence).toBeGreaterThanOrEqual(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE);
  });

  it('lowers confidence for stray unknown signals but never below the floor', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({ kind: 'lifecycle_committed' }),
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
      ],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('navigated_same_tab');
    expect(out.outcomeConfidence).toBeGreaterThanOrEqual(ACTION_OUTCOME_MIN_AMBIGUOUS_CONFIDENCE);
  });

  it('returns unknown verdict with zero confidence when only unknown signals fire', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
        makeSignal({ kind: 'unknown' as ActionSignalKind }),
      ],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('unknown');
    expect(out.outcomeConfidence).toBe(0);
  });

  it('drops late signals beyond the configured settle window', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'lifecycle_committed', observedAtMs: T0 + 10_000 })],
    });
    const out = classifyActionOutcome(env, { now, settleWindowMs: 1_500 });
    // Late signal => empty effective timeline => no_observed_change.
    expect(out.outcome).toBe('no_observed_change');
    expect(out.outcomeConfidence).toBe(1);
  });

  it('drops signals dated before the action observedAtMs (clock skew guard)', () => {
    const env = makeEnvelope({
      signals: [makeSignal({ kind: 'lifecycle_committed', observedAtMs: T0 - 50 })],
    });
    const out = classifyActionOutcome(env, { now });
    expect(out.outcome).toBe('no_observed_change');
  });

  it('clamps producer confidence to the [0, 1] interval', () => {
    const env = makeEnvelope({ signals: [] });
    // Pure function — re-classify several times and confirm the
    // confidence stays inside the closed interval. (The classifier
    // does not currently emit out-of-range values; this test pins
    // the contract so a future tweak cannot regress it silently.)
    for (let i = 0; i < 5; i++) {
      const out = classifyActionOutcome(env, { now });
      expect(out.outcomeConfidence).toBeGreaterThanOrEqual(0);
      expect(out.outcomeConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic — same envelope twice yields the same snapshot', () => {
    const env = makeEnvelope({
      signals: [
        makeSignal({ kind: 'lifecycle_committed' }),
        makeSignal({ kind: 'dom_region_changed', regionTag: 'main_list' }),
      ],
    });
    const a = classifyActionOutcome(env, { now });
    const b = classifyActionOutcome(env, { now });
    expect(a).toEqual(b);
  });
});

describe('action-outcome-classifier — isKnownActionSignalKind', () => {
  it('accepts every closed-enum signal kind except unknown', () => {
    const known: ActionSignalKind[] = [
      'lifecycle_committed',
      'tab_created',
      'dom_region_changed',
      'network_completed',
      'dialog_opened',
    ];
    for (const k of known) expect(isKnownActionSignalKind(k)).toBe(true);
    expect(isKnownActionSignalKind('unknown')).toBe(false);
  });
});

describe('action-outcome-classifier — DOM region hash rule', () => {
  it('describes the documented include / exclude allowlist', () => {
    const rule = describeDomRegionSelectionRule();
    expect(rule.included).toEqual(
      ['attribute', 'children_count', 'list_item_count', 'text', 'visibility'].sort(),
    );
    expect(rule.excluded).toEqual(
      ['ad_slot', 'dynamic_id', 'random_token', 'skeleton', 'timestamp'].sort(),
    );
  });

  it('partitions a bag into included vs excluded by tag', () => {
    const result = selectDomRegionSignalsForOutcome([
      { tag: 'text', value: 'header.title=v' },
      { tag: 'children_count', value: 'list=14' },
      { tag: 'dynamic_id', value: 'el-0xabc1234' },
      { tag: 'timestamp', value: 'rendered=2025-04-27T11:38:00Z' },
      { tag: 'list_item_count', value: 'rows=42' },
    ]);
    expect(result.included.map((s) => s.tag)).toEqual([
      'text',
      'children_count',
      'list_item_count',
    ]);
    expect(result.excluded.map((s) => s.tag)).toEqual(['dynamic_id', 'timestamp']);
  });

  it('drops unknown / unmapped tags into excluded (defensive default)', () => {
    const result = selectDomRegionSignalsForOutcome([
      // Cast through `unknown` because the tag is intentionally
      // outside the closed enum to simulate a future producer that
      // smuggles a new tag without updating the allowlist.
      { tag: 'novel_signal' as unknown as 'unknown', value: 'whatever' },
    ]);
    expect(result.included).toEqual([]);
    expect(result.excluded).toHaveLength(1);
  });

  it('is order-stable — equal-tag inputs produce equal-tag outputs', () => {
    const a = selectDomRegionSignalsForOutcome([
      { tag: 'text', value: 'a' },
      { tag: 'attribute', value: 'b' },
    ]);
    const b = selectDomRegionSignalsForOutcome([
      { tag: 'text', value: 'a' },
      { tag: 'attribute', value: 'b' },
    ]);
    expect(a).toEqual(b);
  });
});
