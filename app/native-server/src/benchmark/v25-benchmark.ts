/**
 * Tabrix v2.5 benchmark transformer (V25-01).
 *
 * Pure data transformer. No IO, no DOM, no network. Takes a list of
 * structured tool-call records (the same NDJSON shape v24 uses) plus
 * the v2.5 layer-dispatch fields (chosen layer, dispatch reason, source
 * route, token estimate of the chosen layer vs the full read) and
 * produces a deterministic v2.5 release-evidence report.
 *
 * Why a separate transformer rather than extending v24: the v24 release
 * gate is the v2.4.0 ship contract. Its report shape is frozen at
 * `BENCHMARK_REPORT_VERSION = 1` (cross-source-checked by
 * `v24-benchmark.test.ts`). v2.5 adds:
 *
 *   - Layer dispatch metrics: `chosenLayer`, `layerDispatchReason`,
 *     `sourceRoute`, `tokenEstimateChosen`, `tokenEstimateFullRead`,
 *     `tokensSavedEstimate`, `readPageAvoided` — the runtime-side
 *     evidence for the v2.5 thesis ("smallest reliable context").
 *   - Stability metrics: `clickAttemptsPerSuccess`,
 *     `noObservedChangeRate`, `visualFallbackRate`, `jsFallbackRate`,
 *     `replaySuccessRate`, `replayFallbackDepth` — the V25-04 ground
 *     stability counters that the V25-05 release gate reads.
 *   - Optional `comparisonToV24` block: fed by `--baseline-v24
 *     <v24-report.json>` on the CLI.
 *
 * Schema invariants (do NOT break without bumping
 * `BENCHMARK_REPORT_VERSION`):
 *  - Every K-metric is either a finite number or `null` (not
 *    `undefined`, not `NaN`). `null` means "no qualifying samples".
 *  - Counter fields are integers ≥ 0.
 *  - Per-tool latency uses p50 not mean (matches v23/v24).
 *  - Token-estimate fields are byte-length / 4 estimates produced by
 *    the runner — the transformer does not re-tokenize.
 *  - Malformed metric values are tolerated by the transformer (passed
 *    through as `null`); the gate layer in
 *    `scripts/lib/v25-benchmark-gate.cjs` is responsible for reject.
 *  - `pairedRunCount >= 3` per scenario IS a hard requirement for the
 *    release gate, but the transformer just surfaces the count.
 */

import {
  BENCHMARK_REPORT_VERSION as V23_BENCHMARK_REPORT_VERSION,
  type BenchmarkLane,
  type BenchmarkLaneCounters,
  type BenchmarkPerToolLatency,
  type BenchmarkScenarioRecord,
  type BenchmarkToolCallRecord,
  type BenchmarkToolCallStatus,
} from './v23-benchmark';
import {
  BENCHMARK_REPORT_VERSION as V24_BENCHMARK_REPORT_VERSION,
  type BenchmarkChooserStrategy,
  type BenchmarkPairRecord,
  type BenchmarkReplayBlockReason,
  type BenchmarkReplayEligibilityCounters,
  type BenchmarkSummaryV24,
  type BenchmarkToolCallRecordV24,
} from './v24-benchmark';

/**
 * v25 report version. Independent counter from v23/v24. Bumped only
 * when the v25 report shape changes in a way the v25 release gate must
 * learn about. `v25-benchmark.test.ts` cross-source-checks this against
 * `BENCHMARK_REPORT_VERSION_EXPECTED` in `scripts/lib/v25-benchmark-gate.cjs`.
 */
export const BENCHMARK_REPORT_VERSION = 1 as const;

/**
 * v23 report version, re-exported so the v25 gate can assert that the
 * three transformers (v23 / v24 / v25) do not silently merge their
 * schemas.
 */
export const V23_REPORT_VERSION = V23_BENCHMARK_REPORT_VERSION;

/**
 * v24 report version, re-exported for the same cross-version guard.
 */
export const V24_REPORT_VERSION = V24_BENCHMARK_REPORT_VERSION;

/**
 * Re-export v23/v24 primitives that v25 explicitly re-uses.
 */
export type {
  BenchmarkLane,
  BenchmarkLaneCounters,
  BenchmarkPerToolLatency,
  BenchmarkScenarioRecord,
  BenchmarkToolCallRecord,
  BenchmarkToolCallStatus,
  BenchmarkChooserStrategy,
  BenchmarkPairRecord,
  BenchmarkReplayBlockReason,
  BenchmarkReplayEligibilityCounters,
};

/**
 * Closed enum of `requestedLayer` choices the v2.5 layer dispatcher
 * emits. Mirrors `ReadPageRequestedLayer` in
 * `packages/shared/src/read-page-contract.ts` exactly; we hard-code
 * the union here rather than depending on the shared package because
 * the benchmark transformer must remain shared-package-version-tolerant.
 */
export type BenchmarkChosenLayer = 'L0' | 'L0+L1' | 'L0+L1+L2';

/**
 * Closed enum of `LayerSourceRoute` values locked by the v2.5 P0
 * chain V3.1 kickoff binding. The dispatcher MUST emit one of these
 * four values; runners forwarding telemetry MUST use the same
 * spelling.
 */
export type BenchmarkLayerSourceRoute =
  | 'read_page_required'
  | 'experience_replay_skip_read'
  | 'knowledge_supported_read'
  | 'dispatcher_fallback_safe';

/**
 * Per-tool-call v25 metadata. Extends v24's record shape with layer
 * dispatch and stability fallback signals. Every new field is
 * optional so older NDJSON files (or runs against a pre-V25-02
 * native server) still parse cleanly.
 */
export interface BenchmarkToolCallRecordV25 extends BenchmarkToolCallRecordV24 {
  /** The layer the dispatcher chose for this tool call. */
  chosenLayer?: BenchmarkChosenLayer;
  /**
   * Free-form dispatch reason key (closed enum lives in
   * `LayerDispatchReason` of `packages/shared/src/read-page-contract.ts`).
   * The transformer only counts occurrences; it does not validate the
   * value against a closed enum because the dispatcher reason set may
   * grow within v2.5 without bumping the report version.
   */
  layerDispatchReason?: string;
  /** Source route (closed enum). */
  sourceRoute?: BenchmarkLayerSourceRoute;
  /** Token estimate of the chosen layer's payload (byteLength / 4). */
  tokenEstimateChosen?: number | null;
  /** Token estimate of the full read_page payload (byteLength / 4). */
  tokenEstimateFullRead?: number | null;
  /** True iff the call avoided emitting a `chrome_read_page` entirely. */
  readPageAvoided?: boolean;
  /** True iff the call dispatched into a visual-fallback path. */
  visualFallbackUsed?: boolean;
  /** True iff the call dispatched into a JS-fallback path. */
  jsFallbackUsed?: boolean;
  /**
   * True iff a click verifier observed no change after the click. Only
   * meaningful for `chrome_click_element`. Other tools should leave
   * this `undefined`.
   */
  noObservedChange?: boolean;
  /**
   * Replay fallback depth, 0-indexed. 0 = top-1 path used; 1 = top-2
   * fallback path; 2 = top-3 fallback path; null = not a replay call.
   */
  replayFallbackDepth?: number | null;
  /**
   * If the dispatcher fell into the `dispatcher_fallback_safe` route,
   * the `LayerDispatchReason` that caused it. Counted into
   * `layerMetrics.fallbackCauseDistribution`.
   */
  fallbackCause?: string;
}

export interface BenchmarkRunInputV25 {
  runId: string;
  runStartedAt: string;
  runEndedAt: string;
  buildSha: string;
  /** Optional list of scenario ids to treat as KPI scenarios for paired-run gating. */
  kpiScenarioIds?: string[];
  toolCalls: BenchmarkToolCallRecordV25[];
  scenarios: BenchmarkScenarioRecord[];
  /**
   * Pair bindings carried forward from v24's NDJSON shape. v25 reuses
   * them solely to compute `pairedRunCount` per scenario; v25 does not
   * re-derive K5..K8 here (those remain v24 evidence-only metrics).
   */
  pairs: BenchmarkPairRecord[];
  /**
   * Optional browser tab hygiene block emitted by the v25 real MCP
   * runner (see `scripts/lib/v25-primary-tab-session.cjs`). When
   * present, the v25 release gate enforces:
   *   - `primaryTabReuseRate >= 0.95`
   *   - `maxConcurrentTabs <= 2` (unless an allowlisted scenario)
   *   - `tabHygieneViolations.length === 0`
   * When absent (e.g. legacy NDJSON), the transformer emits
   * `tabHygiene: null` and the gate is silent — the runner contract
   * still ships in the helper module, but old runs are not retroactively
   * rejected. The runner contract is the post-implementation closeout
   * documented in `.claude/strategy/TABRIX_V2_5_P0_CHAIN_V3_1.md`
   * §"V25-05 Closeout Addendum: Browser Tab Hygiene".
   */
  tabHygiene?: BenchmarkTabHygieneInputV25 | null;
}

/**
 * Single browser tab hygiene violation emitted by the v25 real MCP
 * runner. Closed-enum `kind` so the gate can grow per-kind reasons
 * without re-shaping the report. Open-ended `detail` is free-form
 * diagnostic text and is NOT consumed by the gate.
 */
export type BenchmarkTabHygieneViolationKind =
  | 'unexpected_new_tab'
  | 'tab_id_changed_after_navigation'
  | 'forbidden_bare_navigate_retry'
  | 'cleanup_closed_baseline_tab'
  | 'cleanup_failed';

export interface BenchmarkTabHygieneViolation {
  scenarioId: string | null;
  kind: BenchmarkTabHygieneViolationKind;
  detail?: string;
}

/**
 * Browser tab hygiene input emitted by the v25 real MCP runner. All
 * counts are integers >= 0; the transformer trusts the runner-supplied
 * `samePrimaryTabNavigations` / `expectedPrimaryTabNavigations` as the
 * canonical numerator/denominator for `primaryTabReuseRate`.
 *
 * Why pre-aggregated: keeping the rate numerator/denominator on the
 * runner side prevents the transformer from having to re-walk every
 * `chrome_navigate` tool call to decide whether a scenario was
 * "allowsNewTab"-allowlisted. The runner already owns that decision
 * in its session helper.
 */
export interface BenchmarkTabHygieneInputV25 {
  primaryTabId: number | null;
  baselineTabIds: number[];
  observedTabIds: number[];
  openedTabIds: number[];
  closedTabIds: number[];
  maxConcurrentTabs: number;
  /**
   * Numerator: navigations whose returned `tabId` matched
   * `primaryTabId`. Excludes navigations that came from
   * allowlisted-new-tab scenarios.
   */
  samePrimaryTabNavigations: number;
  /**
   * Denominator: navigations the runner expected to land on the
   * primary tab (i.e. all `chrome_navigate` calls minus those issued
   * inside an `allowsNewTab: true` scenario). 0 means "no qualifying
   * samples" → `primaryTabReuseRate` is `null`.
   */
  expectedPrimaryTabNavigations: number;
  /**
   * Scenario ids the runner declared `allowsNewTab: true` for. Used
   * by the gate's "max concurrent tabs" rule (when ALL violations come
   * from allowlisted scenarios, the >2 ceiling is relaxed) and by the
   * report consumer for auditability.
   */
  allowsNewTabScenarioIds?: string[];
  /**
   * Closed list of hygiene violations the runner detected. Empty array
   * means the suite was clean. The gate hard-rejects when this list
   * is non-empty.
   */
  violations: BenchmarkTabHygieneViolation[];
}

export interface BenchmarkScenarioSummaryV25 {
  scenarioId: string;
  /** Tool calls observed for this scenario. */
  toolCallCount: number;
  completed: boolean;
  /** Number of complete first/second pairs (mirrors v24's `pairCount`). */
  pairedRunCount: number;
}

export interface BenchmarkChosenLayerCounters {
  L0: number;
  'L0+L1': number;
  'L0+L1+L2': number;
  unknown: number;
}

export interface BenchmarkSourceRouteCounters {
  read_page_required: number;
  experience_replay_skip_read: number;
  knowledge_supported_read: number;
  dispatcher_fallback_safe: number;
  unknown: number;
}

export interface BenchmarkLayerMetricsV25 {
  /** Distribution of chosen layer across all tool calls that emitted one. */
  chosenLayerDistribution: BenchmarkChosenLayerCounters;
  /**
   * Distribution of `layerDispatchReason` strings. Open-ended map so
   * adding a new dispatch reason in v2.5 does not break the report
   * shape.
   */
  dispatchReasonDistribution: Record<string, number>;
  /** Distribution of `sourceRoute` (closed enum + unknown bucket). */
  sourceRouteDistribution: BenchmarkSourceRouteCounters;
  /**
   * Median ratio `tokenEstimateChosen / tokenEstimateFullRead` over
   * the calls that recorded BOTH numbers AND chose `L0`. Used by the
   * V25-05 gate (`<= 0.35`).
   */
  l0TokenRatioMedian: number | null;
  /** Same ratio for `L0+L1`. Gate target `<= 0.60`. */
  l0L1TokenRatioMedian: number | null;
  /**
   * Sum of `(tokenEstimateFullRead - tokenEstimateChosen)` across
   * calls that recorded both. Floor at 0 — negative values (chosen
   * payload bigger than full read) are surfaced as zero saving rather
   * than negative.
   */
  tokensSavedEstimateTotal: number;
  /** Number of tool calls that skipped `chrome_read_page` entirely. */
  readPageAvoidedCount: number;
  /**
   * Distribution of `fallbackCause` values among calls that landed on
   * the `dispatcher_fallback_safe` route. Open-ended map.
   */
  fallbackCauseDistribution: Record<string, number>;
  /** Distribution of chooser strategy (mirrors v24 distribution). */
  strategyDistribution: BenchmarkReplayEligibilityCounters;
}

export interface BenchmarkMethodMetricsV25 {
  /**
   * Median click attempts per successful click step. Only counts
   * calls of `chrome_click_element` that ended with `status === 'ok'`.
   * V25-05 gate: `<= v24 measured median`.
   */
  clickAttemptsPerSuccessMedian: number | null;
  /**
   * Median tool calls per scenario across all scenarios.
   * V25-05 gate: `<= v24 measured median + 0`.
   */
  medianToolCallsPerScenario: number | null;
  /** Carry-forward K3 (task success rate). */
  k3TaskSuccessRate: number | null;
  /** Carry-forward K4 (tool retry rate). */
  k4ToolRetryRate: number | null;
}

export interface BenchmarkStabilityMetricsV25 {
  /**
   * Rate of click calls whose verifier observed no change. Denominator
   * is `chrome_click_element` calls (any status); numerator is the
   * subset where `noObservedChange === true`. Null when no click
   * calls.
   */
  noObservedChangeRate: number | null;
  /**
   * Rate of calls that used a visual-fallback path. Denominator is
   * total tool calls; numerator is `visualFallbackUsed === true`.
   */
  visualFallbackRate: number | null;
  /**
   * Rate of calls that used a JS-fallback path. Denominator is total
   * tool calls; numerator is `jsFallbackUsed === true`.
   */
  jsFallbackRate: number | null;
  /**
   * Replay success rate. Denominator is calls with chooser strategy
   * `experience_replay`; numerator is the subset that completed with
   * `status === 'ok'`. Null when no replay calls.
   */
  replaySuccessRate: number | null;
  /**
   * Median replay fallback depth across replay calls that recorded a
   * non-null `replayFallbackDepth`. Null when no qualifying samples.
   */
  replayFallbackDepthMedian: number | null;
}

/**
 * Optional v24 baseline comparison block. Populated by
 * `summariseBenchmarkRunV25` when `input.comparisonBaselineV24` is
 * provided. Each delta is signed (`v25 - v24`); higher-is-better and
 * lower-is-better interpretation lives in the gate, not here.
 */
export interface BenchmarkComparisonToV24 {
  baselineRunId: string;
  baselineBuildSha: string;
  baselineReportVersion: number;
  deltas: {
    k3TaskSuccessRate: number | null;
    k4ToolRetryRate: number | null;
    medianToolCallsPerScenario: number | null;
    clickAttemptsPerSuccess: number | null;
    visualFallbackRate: number | null;
    jsFallbackRate: number | null;
  };
}

export interface BenchmarkRunInputV25WithBaseline extends BenchmarkRunInputV25 {
  /** Optional v24 baseline summary, used to populate `comparisonToV24`. */
  comparisonBaselineV24?: BenchmarkSummaryV24 | null;
}

/**
 * Browser tab hygiene block surfaced on the v25 release-evidence
 * report. Mirrors `BenchmarkTabHygieneInputV25` 1:1 except the
 * derived `primaryTabReuseRate` (numerator/denominator → ratio or
 * null when no qualifying samples) and explicit count fields the
 * report consumer expects.
 */
export interface BenchmarkTabHygieneSummaryV25 {
  primaryTabId: number | null;
  baselineTabCount: number;
  observedTabCount: number;
  openedTabsCount: number;
  closedTabsCount: number;
  maxConcurrentTabs: number;
  /** `samePrimaryTabNavigations / expectedPrimaryTabNavigations` or `null`. */
  primaryTabReuseRate: number | null;
  samePrimaryTabNavigations: number;
  expectedPrimaryTabNavigations: number;
  allowsNewTabScenarioIds: string[];
  tabHygieneViolations: BenchmarkTabHygieneViolation[];
}

export interface BenchmarkSummaryV25 {
  reportVersion: typeof BENCHMARK_REPORT_VERSION;
  runId: string;
  runStartedAt: string;
  runEndedAt: string;
  buildSha: string;

  totalToolCalls: number;
  totalScenarios: number;
  completedScenarios: number;
  scenarioCompletionRate: number | null;
  /** KPI scenario ids the gate must enforce paired-run counts on. Mirrors input. */
  kpiScenarioIds: string[];
  /**
   * Maximum `pairedRunCount` across KPI scenarios. The release gate
   * checks `pairedRunCount >= 3` against this aggregate AND against
   * `scenarioSummaries[].pairedRunCount`.
   */
  pairedRunCountMax: number;
  /** Per-tool latency p50 ms — carried forward unchanged from v23/v24. */
  k2PerToolLatencyMs: BenchmarkPerToolLatency[];
  /** Per-scenario summaries sorted by `scenarioId` ASC for stable output. */
  scenarioSummaries: BenchmarkScenarioSummaryV25[];
  layerMetrics: BenchmarkLayerMetricsV25;
  methodMetrics: BenchmarkMethodMetricsV25;
  stabilityMetrics: BenchmarkStabilityMetricsV25;
  /** v23/v24 lane counters carried forward — V25-04 still treats violations as a hard release blocker. */
  laneCounters: BenchmarkLaneCounters;
  /** Optional v24 baseline comparison. Null when no baseline was supplied. */
  comparisonToV24: BenchmarkComparisonToV24 | null;
  /**
   * Optional browser tab hygiene block. Null when the runner did not
   * emit a `tabHygiene` input (legacy NDJSON, synthetic test fixtures
   * that don't exercise tab session). When non-null, the v25 release
   * gate enforces reuse / concurrency / violation thresholds against it.
   */
  tabHygiene: BenchmarkTabHygieneSummaryV25 | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (re-implemented locally to keep v25 independent of v24's
// internal helpers; the public surface above is the only thing v25 owes
// to other transformers).
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? null;
  }
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function safeNonNegative(value: number): number {
  return value < 0 || !Number.isFinite(value) ? 0 : value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isChosenLayer(value: unknown): value is BenchmarkChosenLayer {
  return value === 'L0' || value === 'L0+L1' || value === 'L0+L1+L2';
}

function isSourceRoute(value: unknown): value is BenchmarkLayerSourceRoute {
  return (
    value === 'read_page_required' ||
    value === 'experience_replay_skip_read' ||
    value === 'knowledge_supported_read' ||
    value === 'dispatcher_fallback_safe'
  );
}

function isChooserStrategy(v: unknown): v is BenchmarkChooserStrategy {
  return (
    v === 'experience_replay' ||
    v === 'experience_reuse' ||
    v === 'knowledge_light' ||
    v === 'read_page_required' ||
    v === 'read_page_markdown' ||
    v === 'cold'
  );
}

function emptyChosenLayerCounters(): BenchmarkChosenLayerCounters {
  return { L0: 0, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 };
}

function emptySourceRouteCounters(): BenchmarkSourceRouteCounters {
  return {
    read_page_required: 0,
    experience_replay_skip_read: 0,
    knowledge_supported_read: 0,
    dispatcher_fallback_safe: 0,
    unknown: 0,
  };
}

function emptyEligibilityCounters(): BenchmarkReplayEligibilityCounters {
  return {
    experience_replay: 0,
    experience_reuse: 0,
    knowledge_light: 0,
    read_page_required: 0,
    read_page_markdown: 0,
    cold: 0,
    unknown: 0,
  };
}

interface PairBindingState {
  firstTouch: boolean;
  secondTouch: boolean;
}

function countPairedRunsByScenario(pairs: BenchmarkPairRecord[]): Map<string, number> {
  // Mirrors v24's "complete pair" definition: a pair counts iff BOTH
  // first_touch and second_touch are present for the same
  // (scenarioId, pairIndex). v25 does not re-evaluate the tool-call
  // bindings — it only counts whether both roles were emitted.
  const byScenario = new Map<string, Map<number, PairBindingState>>();
  for (const pair of pairs) {
    if (typeof pair.scenarioId !== 'string') continue;
    if (!Number.isInteger(pair.pairIndex) || pair.pairIndex < 0) continue;
    if (pair.role !== 'first_touch' && pair.role !== 'second_touch') continue;
    let scenarioMap = byScenario.get(pair.scenarioId);
    if (!scenarioMap) {
      scenarioMap = new Map();
      byScenario.set(pair.scenarioId, scenarioMap);
    }
    let state = scenarioMap.get(pair.pairIndex);
    if (!state) {
      state = { firstTouch: false, secondTouch: false };
      scenarioMap.set(pair.pairIndex, state);
    }
    if (pair.role === 'first_touch') state.firstTouch = true;
    if (pair.role === 'second_touch') state.secondTouch = true;
  }
  const result = new Map<string, number>();
  for (const [scenarioId, scenarioMap] of byScenario.entries()) {
    let count = 0;
    for (const state of scenarioMap.values()) {
      if (state.firstTouch && state.secondTouch) count += 1;
    }
    result.set(scenarioId, count);
  }
  return result;
}

function buildLayerMetrics(toolCalls: BenchmarkToolCallRecordV25[]): BenchmarkLayerMetricsV25 {
  const chosenLayerDistribution = emptyChosenLayerCounters();
  const sourceRouteDistribution = emptySourceRouteCounters();
  const dispatchReasonDistribution: Record<string, number> = {};
  const fallbackCauseDistribution: Record<string, number> = {};
  const strategyDistribution = emptyEligibilityCounters();

  let tokensSavedTotal = 0;
  let readPageAvoidedCount = 0;
  const l0Ratios: number[] = [];
  const l0L1Ratios: number[] = [];

  for (const call of toolCalls) {
    if (isChosenLayer(call.chosenLayer)) {
      chosenLayerDistribution[call.chosenLayer] += 1;
    } else if (call.chosenLayer !== undefined) {
      chosenLayerDistribution.unknown += 1;
    }

    if (isSourceRoute(call.sourceRoute)) {
      sourceRouteDistribution[call.sourceRoute] += 1;
    } else if (call.sourceRoute !== undefined) {
      sourceRouteDistribution.unknown += 1;
    }

    if (typeof call.layerDispatchReason === 'string' && call.layerDispatchReason.length > 0) {
      const key = call.layerDispatchReason;
      dispatchReasonDistribution[key] = (dispatchReasonDistribution[key] ?? 0) + 1;
    }

    if (call.sourceRoute === 'dispatcher_fallback_safe') {
      const cause =
        typeof call.fallbackCause === 'string' && call.fallbackCause.length > 0
          ? call.fallbackCause
          : 'unspecified';
      fallbackCauseDistribution[cause] = (fallbackCauseDistribution[cause] ?? 0) + 1;
    }

    if (call.readPageAvoided === true) readPageAvoidedCount += 1;

    if (
      isFiniteNumber(call.tokenEstimateChosen) &&
      isFiniteNumber(call.tokenEstimateFullRead) &&
      call.tokenEstimateFullRead > 0
    ) {
      // tokensSavedEstimate is `full - chosen` floored at 0. Negative
      // savings (chosen > full) would mean the runner emitted
      // contradictory data; we treat that as zero rather than letting
      // it show as a "negative saving" headline.
      const saving = call.tokenEstimateFullRead - call.tokenEstimateChosen;
      tokensSavedTotal += saving > 0 ? saving : 0;

      const ratioValue = call.tokenEstimateChosen / call.tokenEstimateFullRead;
      if (call.chosenLayer === 'L0') {
        l0Ratios.push(ratioValue);
      } else if (call.chosenLayer === 'L0+L1') {
        l0L1Ratios.push(ratioValue);
      }
    }

    if (isChooserStrategy(call.chooserStrategy)) {
      strategyDistribution[call.chooserStrategy] += 1;
    } else if (call.chooserStrategy !== undefined) {
      strategyDistribution.unknown += 1;
    }
  }

  return {
    chosenLayerDistribution,
    dispatchReasonDistribution,
    sourceRouteDistribution,
    l0TokenRatioMedian: median(l0Ratios),
    l0L1TokenRatioMedian: median(l0L1Ratios),
    tokensSavedEstimateTotal: tokensSavedTotal,
    readPageAvoidedCount,
    fallbackCauseDistribution,
    strategyDistribution,
  };
}

function buildMethodMetrics(
  toolCalls: BenchmarkToolCallRecordV25[],
  scenarios: BenchmarkScenarioRecord[],
  totalToolCalls: number,
): BenchmarkMethodMetricsV25 {
  const clickAttemptSamples = toolCalls
    .filter((c) => c.toolName === 'chrome_click_element' && c.status === 'ok')
    .map((c) => c.clickAttempts)
    .filter((v): v is number => isFiniteNumber(v) && v >= 1);
  const clickAttemptsPerSuccessMedian = median(clickAttemptSamples);

  const callsPerScenario = new Map<string, number>();
  for (const call of toolCalls) {
    if (typeof call.scenarioId !== 'string') continue;
    callsPerScenario.set(call.scenarioId, (callsPerScenario.get(call.scenarioId) ?? 0) + 1);
  }
  const perScenarioSamples: number[] = [];
  for (const scenario of scenarios) {
    perScenarioSamples.push(callsPerScenario.get(scenario.scenarioId) ?? 0);
  }
  const medianToolCallsPerScenario = median(perScenarioSamples);

  const totalScenarios = scenarios.length;
  const completedScenarios = scenarios.filter((s) => s.completed).length;
  const k3TaskSuccessRate = ratio(completedScenarios, totalScenarios);
  const retried = toolCalls.filter((c) => safeNonNegative(c.retryCount) > 0).length;
  const k4ToolRetryRate = ratio(retried, totalToolCalls);

  return {
    clickAttemptsPerSuccessMedian,
    medianToolCallsPerScenario,
    k3TaskSuccessRate,
    k4ToolRetryRate,
  };
}

function buildStabilityMetrics(
  toolCalls: BenchmarkToolCallRecordV25[],
  totalToolCalls: number,
): BenchmarkStabilityMetricsV25 {
  const clickCalls = toolCalls.filter((c) => c.toolName === 'chrome_click_element');
  const noChange = clickCalls.filter((c) => c.noObservedChange === true).length;
  const noObservedChangeRate = clickCalls.length > 0 ? noChange / clickCalls.length : null;

  const visualFallbackCount = toolCalls.filter((c) => c.visualFallbackUsed === true).length;
  const jsFallbackCount = toolCalls.filter((c) => c.jsFallbackUsed === true).length;
  const visualFallbackRate = ratio(visualFallbackCount, totalToolCalls);
  const jsFallbackRate = ratio(jsFallbackCount, totalToolCalls);

  const replayCalls = toolCalls.filter((c) => c.chooserStrategy === 'experience_replay');
  const replayOk = replayCalls.filter((c) => c.status === 'ok').length;
  const replaySuccessRate = replayCalls.length > 0 ? replayOk / replayCalls.length : null;

  const depthSamples = replayCalls
    .map((c) => c.replayFallbackDepth)
    .filter((v): v is number => isFiniteNumber(v) && v >= 0);
  const replayFallbackDepthMedian = median(depthSamples);

  return {
    noObservedChangeRate,
    visualFallbackRate,
    jsFallbackRate,
    replaySuccessRate,
    replayFallbackDepthMedian,
  };
}

function buildPerToolLatency(toolCalls: BenchmarkToolCallRecordV25[]): BenchmarkPerToolLatency[] {
  const grouped = new Map<string, number[]>();
  for (const call of toolCalls) {
    if (call.status !== 'ok') continue;
    const arr = grouped.get(call.toolName) ?? [];
    if (Number.isFinite(call.durationMs)) arr.push(call.durationMs);
    grouped.set(call.toolName, arr);
  }
  const out: BenchmarkPerToolLatency[] = [];
  for (const [toolName, durations] of grouped.entries()) {
    out.push({ toolName, sampleCount: durations.length, p50Ms: median(durations) });
  }
  out.sort((a, b) => a.toolName.localeCompare(b.toolName));
  return out;
}

function uniqInt(values: readonly number[]): number[] {
  const seen = new Set<number>();
  for (const value of values) {
    if (Number.isInteger(value)) seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

function isTabHygieneViolation(value: unknown): value is BenchmarkTabHygieneViolation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BenchmarkTabHygieneViolation>;
  return typeof v.kind === 'string' && v.kind.length > 0;
}

function buildTabHygieneSummary(
  input: BenchmarkTabHygieneInputV25 | null | undefined,
): BenchmarkTabHygieneSummaryV25 | null {
  if (!input || typeof input !== 'object') return null;
  // Defensive: tolerate runner-side malformed values rather than throw.
  // The gate (not the transformer) is responsible for rejecting bad
  // numbers; here we only normalise.
  const baselineTabIds = uniqInt(Array.isArray(input.baselineTabIds) ? input.baselineTabIds : []);
  const observedTabIds = uniqInt(Array.isArray(input.observedTabIds) ? input.observedTabIds : []);
  const openedTabIds = uniqInt(Array.isArray(input.openedTabIds) ? input.openedTabIds : []);
  const closedTabIds = uniqInt(Array.isArray(input.closedTabIds) ? input.closedTabIds : []);
  const same = Number.isFinite(input.samePrimaryTabNavigations)
    ? Math.max(0, Math.trunc(input.samePrimaryTabNavigations))
    : 0;
  const expected = Number.isFinite(input.expectedPrimaryTabNavigations)
    ? Math.max(0, Math.trunc(input.expectedPrimaryTabNavigations))
    : 0;
  const reuse = expected > 0 ? same / expected : null;
  const maxConcurrent = Number.isFinite(input.maxConcurrentTabs)
    ? Math.max(0, Math.trunc(input.maxConcurrentTabs))
    : 0;
  const violations = (Array.isArray(input.violations) ? input.violations : []).filter(
    isTabHygieneViolation,
  );
  const allowsNewTabScenarioIds = [
    ...new Set(
      (Array.isArray(input.allowsNewTabScenarioIds) ? input.allowsNewTabScenarioIds : []).filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const primaryTabId =
    typeof input.primaryTabId === 'number' && Number.isInteger(input.primaryTabId)
      ? input.primaryTabId
      : null;
  return {
    primaryTabId,
    baselineTabCount: baselineTabIds.length,
    observedTabCount: observedTabIds.length,
    openedTabsCount: openedTabIds.length,
    closedTabsCount: closedTabIds.length,
    maxConcurrentTabs: maxConcurrent,
    primaryTabReuseRate: reuse,
    samePrimaryTabNavigations: same,
    expectedPrimaryTabNavigations: expected,
    allowsNewTabScenarioIds,
    tabHygieneViolations: violations.map((v) => ({
      scenarioId: typeof v.scenarioId === 'string' && v.scenarioId.length > 0 ? v.scenarioId : null,
      kind: v.kind,
      ...(typeof v.detail === 'string' && v.detail.length > 0 ? { detail: v.detail } : {}),
    })),
  };
}

function buildLaneCounters(toolCalls: BenchmarkToolCallRecordV25[]): BenchmarkLaneCounters {
  const counters: BenchmarkLaneCounters = {
    tabrixOwnedCount: toolCalls.filter((c) => c.lane === 'tabrix_owned').length,
    cdpCount: toolCalls.filter((c) => c.lane === 'cdp').length,
    debuggerCount: toolCalls.filter((c) => c.lane === 'debugger').length,
    unknownCount: toolCalls.filter((c) => c.lane === 'unknown').length,
    violationCount: 0,
  };
  counters.violationCount = counters.cdpCount + counters.debuggerCount;
  return counters;
}

function diffOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
  return a - b;
}

function buildComparisonToV24(
  v25Method: BenchmarkMethodMetricsV25,
  v25Stability: BenchmarkStabilityMetricsV25,
  v25ClickAttempts: number | null,
  baseline: BenchmarkSummaryV24 | null | undefined,
): BenchmarkComparisonToV24 | null {
  if (!baseline || typeof baseline !== 'object') return null;
  // v24 stability metrics are not first-class on the v24 report; the
  // v24 transformer only exposes `meanClickAttemptsPerStep` and a
  // `replayEligibility*` distribution. The visual/JS fallback rates
  // were not captured at v24, so the deltas for them are intentionally
  // null when the baseline does not provide them.
  return {
    baselineRunId: typeof baseline.runId === 'string' ? baseline.runId : '',
    baselineBuildSha: typeof baseline.buildSha === 'string' ? baseline.buildSha : '',
    baselineReportVersion: isFiniteNumber(baseline.reportVersion) ? baseline.reportVersion : 0,
    deltas: {
      k3TaskSuccessRate: diffOrNull(v25Method.k3TaskSuccessRate, baseline.k3TaskSuccessRate),
      k4ToolRetryRate: diffOrNull(v25Method.k4ToolRetryRate, baseline.k4ToolRetryRate),
      // v24 does not record a per-scenario tool-call median; if a
      // future v24 report adds it under the same field name, pick it up.
      medianToolCallsPerScenario: diffOrNull(
        v25Method.medianToolCallsPerScenario,
        (baseline as { medianToolCallsPerScenario?: number | null }).medianToolCallsPerScenario,
      ),
      clickAttemptsPerSuccess: diffOrNull(v25ClickAttempts, baseline.meanClickAttemptsPerStep),
      // Visual / JS fallback rates not captured at v24.
      visualFallbackRate: diffOrNull(
        v25Stability.visualFallbackRate,
        (baseline as { visualFallbackRate?: number | null }).visualFallbackRate,
      ),
      jsFallbackRate: diffOrNull(
        v25Stability.jsFallbackRate,
        (baseline as { jsFallbackRate?: number | null }).jsFallbackRate,
      ),
    },
  };
}

/**
 * Project a finished v2.5 real-browser run into a v2.5
 * release-evidence report. Pure function. Re-running with the same
 * input must produce an identical output.
 */
export function summariseBenchmarkRunV25(
  input: BenchmarkRunInputV25WithBaseline,
): BenchmarkSummaryV25 {
  const toolCalls = input.toolCalls ?? [];
  const scenarios = input.scenarios ?? [];
  const pairs = input.pairs ?? [];
  const kpiScenarioIds = [...new Set(input.kpiScenarioIds ?? [])].sort((a, b) =>
    a.localeCompare(b),
  );

  const totalToolCalls = toolCalls.length;
  const completedScenarios = scenarios.filter((s) => s.completed).length;
  const totalScenarios = scenarios.length;
  const scenarioCompletionRate = ratio(completedScenarios, totalScenarios);

  const pairedRunCounts = countPairedRunsByScenario(pairs);

  const scenarioSummaries: BenchmarkScenarioSummaryV25[] = [];
  const scenarioToolCallCount = new Map<string, number>();
  for (const call of toolCalls) {
    if (typeof call.scenarioId !== 'string') continue;
    scenarioToolCallCount.set(
      call.scenarioId,
      (scenarioToolCallCount.get(call.scenarioId) ?? 0) + 1,
    );
  }
  // Build a stable, deduplicated list of scenarioIds — the union of
  // scenarios from the run header AND any scenarioIds the pair
  // bindings reference (so the gate can flag missing scenario rows).
  const scenarioIdSet = new Set<string>();
  for (const s of scenarios) scenarioIdSet.add(s.scenarioId);
  for (const id of pairedRunCounts.keys()) scenarioIdSet.add(id);
  for (const scenarioId of [...scenarioIdSet].sort((a, b) => a.localeCompare(b))) {
    const completed = scenarios.find((s) => s.scenarioId === scenarioId)?.completed ?? false;
    scenarioSummaries.push({
      scenarioId,
      toolCallCount: scenarioToolCallCount.get(scenarioId) ?? 0,
      completed,
      pairedRunCount: pairedRunCounts.get(scenarioId) ?? 0,
    });
  }

  let pairedRunCountMax = 0;
  for (const s of scenarioSummaries) {
    if (s.pairedRunCount > pairedRunCountMax) pairedRunCountMax = s.pairedRunCount;
  }

  const layerMetrics = buildLayerMetrics(toolCalls);
  const methodMetrics = buildMethodMetrics(toolCalls, scenarios, totalToolCalls);
  const stabilityMetrics = buildStabilityMetrics(toolCalls, totalToolCalls);
  const k2PerToolLatencyMs = buildPerToolLatency(toolCalls);
  const laneCounters = buildLaneCounters(toolCalls);
  const tabHygiene = buildTabHygieneSummary(input.tabHygiene ?? null);

  // For the comparison table we want the SUCCESS-only median click
  // attempts (matches V25-05 gate semantics). v24's
  // `meanClickAttemptsPerStep` is mean over click calls regardless of
  // status — the comparison is intentionally apples-to-oranges-tagged
  // by carrying the v25 success-only number forward into the delta.
  const comparisonToV24 = buildComparisonToV24(
    methodMetrics,
    stabilityMetrics,
    methodMetrics.clickAttemptsPerSuccessMedian,
    input.comparisonBaselineV24,
  );

  return {
    reportVersion: BENCHMARK_REPORT_VERSION,
    runId: input.runId,
    runStartedAt: input.runStartedAt,
    runEndedAt: input.runEndedAt,
    buildSha: input.buildSha,
    totalToolCalls,
    totalScenarios,
    completedScenarios,
    scenarioCompletionRate,
    kpiScenarioIds,
    pairedRunCountMax,
    k2PerToolLatencyMs,
    scenarioSummaries,
    layerMetrics,
    methodMetrics,
    stabilityMetrics,
    laneCounters,
    comparisonToV24,
    tabHygiene,
  };
}

// NOTE: `evaluateBenchmarkGateV25` lives in
// `scripts/lib/v25-benchmark-gate.cjs` (CommonJS). Same rationale as
// v23/v24 — the gate must be loadable by both Jest tests (`require()`)
// and the ESM scripts (`scripts/benchmark-v25.mjs`,
// `scripts/check-release-readiness.mjs`) without depending on the
// native-server `dist/` build artifact. A Jest test in
// `v25-benchmark.test.ts` asserts that
// `BENCHMARK_REPORT_VERSION_EXPECTED` over there matches
// `BENCHMARK_REPORT_VERSION` here, so the report shape and the gate
// cannot drift silently.
