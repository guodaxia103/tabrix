/**
 * Tabrix v2.6 benchmark transformer (V26-01).
 *
 * Pure data transformer. Wraps the v2.5 release-evidence transformer
 * (`summariseBenchmarkRunV25`) with v2.6-only step-level telemetry
 * aggregations: per-task and per-tool wall-clock latency distribution,
 * `component` enum distribution (`unknownComponentRatio`), failure
 * code distribution, wait time accumulation, and `chosenSource`
 * (a.k.a. dispatcher source-router decision) distribution.
 *
 * Why a separate v26 transformer instead of bumping v25's report:
 *   - The v2.5 release gate (`scripts/lib/v25-benchmark-gate.cjs`) is
 *     the v2.5.0 ship contract and its expected report version is
 *     frozen at `BENCHMARK_REPORT_VERSION = 1`.
 *   - The v2.6 telemetry harness must be land-before-rest-of-S2 so the
 *     downstream packages (V26-06 layer metrics, V26-14 release gate)
 *     have a stable schema to consume. Forking the report at v26 keeps
 *     both v25 and v26 reports valid in parallel for the entirety of
 *     the v2.6 development window.
 *
 * Fail-shape contract:
 *   - `durationMs < 0` or non-finite → record is malformed; transformer
 *     emits a `transformerWarnings` entry (`code: 'malformed_duration'`)
 *     and EXCLUDES the record from `perToolDurationMs` and
 *     `perTaskDurationMs` aggregates. The v25 transformer's own latency
 *     handling (`buildPerToolLatency`) is unchanged because it already
 *     filters via `Number.isFinite`.
 *   - Both `startedAt` and `endedAt` missing → transformer emits a
 *     `missing_timestamps` warning. Latency aggregation still proceeds
 *     because `durationMs` is the authoritative number; the warning is
 *     for runner-side QA, not gate enforcement.
 *   - `component` missing or unknown → counted into
 *     `componentDistribution.unknown`; contributes to
 *     `unknownComponentRatio = unknownCount / totalCount`.
 *   - Empty input → all numeric aggregates are `null` (not `0`); all
 *     counter maps are empty.
 *
 * Schema invariants (do NOT break without bumping v26
 * `BENCHMARK_REPORT_VERSION`):
 *   - `unknownComponentRatio` is `[0, 1]` or `null` (null only when
 *     totalToolCalls === 0).
 *   - `perTaskDurationMs` and `perToolDurationMs` are arrays sorted by
 *     key ascending for stable output.
 *   - `transformerWarnings` is sorted by `(code, seq)` ascending so
 *     re-running the transformer with the same input produces identical
 *     output (determinism).
 *   - All v25 fields surface unchanged on `BenchmarkSummaryV26.v25Summary`.
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
import {
  BENCHMARK_REPORT_VERSION as V25_BENCHMARK_REPORT_VERSION,
  type BenchmarkChosenLayer,
  type BenchmarkLayerSourceRoute,
  type BenchmarkRunInputV25,
  type BenchmarkRunInputV25WithBaseline,
  type BenchmarkSummaryV25,
  type BenchmarkTabHygieneInputV25,
  type BenchmarkTabHygieneSummaryV25,
  type BenchmarkTabHygieneViolation,
  type BenchmarkTabHygieneViolationKind,
  type BenchmarkToolCallRecordV25,
  summariseBenchmarkRunV25,
} from './v25-benchmark';

/**
 * v26 report version. Independent counter from v23/v24/v25. Bumped only
 * when the v26 report shape changes in a way the v26 release gate (S3
 * V26-14) must learn about. `v26-benchmark.test.ts` cross-source-checks
 * this against the future `BENCHMARK_REPORT_VERSION_EXPECTED` over in
 * `scripts/lib/v26-benchmark-gate.cjs` once that file lands.
 */
export const BENCHMARK_REPORT_VERSION = 1 as const;

/** v23 report version, re-exported for the cross-version drift guard. */
export const V23_REPORT_VERSION = V23_BENCHMARK_REPORT_VERSION;
/** v24 report version, re-exported for the cross-version drift guard. */
export const V24_REPORT_VERSION = V24_BENCHMARK_REPORT_VERSION;
/** v25 report version, re-exported for the cross-version drift guard. */
export const V25_REPORT_VERSION = V25_BENCHMARK_REPORT_VERSION;

/**
 * Re-export v23/v24/v25 primitives that v26 explicitly re-uses on its
 * public surface.
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
  BenchmarkChosenLayer,
  BenchmarkLayerSourceRoute,
  BenchmarkSummaryV25,
  BenchmarkTabHygieneInputV25,
  BenchmarkTabHygieneSummaryV25,
  BenchmarkTabHygieneViolation,
  BenchmarkTabHygieneViolationKind,
  BenchmarkToolCallRecordV24,
  BenchmarkToolCallRecordV25,
};

/**
 * Closed enum of `component` values the v2.6 step-telemetry harness
 * emits. Populated by the runtime (V26-06) when it instruments
 * `register-tools.ts::handleToolCall` and `session-manager.ts`. The
 * transformer does NOT validate against this enum at runtime — values
 * outside the enum are bucketed into `componentDistribution.unknown`
 * along with `undefined`. The closed enum exists so the report
 * consumer (eventually `v26-benchmark-gate.cjs`) can build a stable
 * stacked-bar chart.
 */
export type BenchmarkStepComponent =
  | 'mcp_tool'
  | 'native_handler'
  | 'extension_bridge'
  | 'page_snapshot'
  | 'unknown';

/**
 * Per-tool-call v26 metadata. Extends v25's record shape with the
 * step-level telemetry harness fields. Every new field is optional so
 * legacy v25 NDJSON parses cleanly through v26 (the transformer treats
 * absent fields as `unknown`).
 */
export interface BenchmarkToolCallRecordV26 extends BenchmarkToolCallRecordV25 {
  /** ISO-8601 timestamp of when the runtime started this step. */
  startedAt?: string;
  /** ISO-8601 timestamp of when the runtime ended this step. */
  endedAt?: string;
  /** Closed-enum component label; missing/invalid values bucket into `unknown`. */
  component?: BenchmarkStepComponent | string;
  /**
   * Stable failure code emitted by the runtime when `status !== 'ok'`.
   * Open-ended (string) so adding a new failure code does not require
   * a v26 report version bump. The transformer counts occurrences only.
   */
  failureCode?: string | null;
  /**
   * Wall-clock milliseconds the step spent waiting on a downstream
   * dependency (page snapshot, bridge ack, replay verifier). Excludes
   * the actual handler execution time. `null` when not measured.
   */
  waitedMs?: number | null;
  /**
   * Source-router decision the dispatcher chose for this tool call.
   * Closed enum; mirrors V26-04's `dispatchLayer` output. Different
   * from v25's `sourceRoute`: `chosenSource` is the *evidence source*
   * (DOM JSON vs API list vs experience replay vs markdown vs API
   * detail), `sourceRoute` is the *dispatcher branch* (the higher-
   * level flow). Both are kept on the record so the report consumer
   * can cross-reference.
   */
  chosenSource?: BenchmarkChosenSource | string;
  /** Payload kind returned by `chrome_read_page`, e.g. `api_rows` or `read_page_skipped`. */
  kind?: string;
  /** Runtime payload source kind; mirrors skip-read envelopes when present. */
  sourceKind?: BenchmarkChosenSource | string;
  /** Dispatcher input source selected by the runner/recorder. */
  dispatcherInputSource?: string | null;
  /** Redacted API family emitted by the V26-07 internal reader. */
  apiFamily?: string | null;
  /** Redacted API purpose emitted by the V26-07 internal reader. */
  dataPurpose?: string | null;
  /**
   * V26-FIX-05 — closed-enum lineage marker for the API row this
   * tool call produced. `'observed'` rows came from the FIX-03
   * network-observe classifier; `'seed_adapter'` rows came from the
   * V25 GitHub/npmjs hardcoded adapter (now compatibility-only);
   * `'manual_seed'` is reserved for an operator-curated catalog.
   * Optional + open-ended `string` so legacy v25 NDJSON parses
   * cleanly; values outside the closed enum bucket into `unknown`.
   */
  endpointSource?: 'observed' | 'seed_adapter' | 'manual_seed' | string | null;
  /** V26-07 API telemetry, kept redacted and optional for legacy NDJSON. */
  apiTelemetry?: BenchmarkApiTelemetryV26 | null;
  /** V26-03 task totals copied from skip-read envelopes. */
  taskTotals?: BenchmarkTaskTotalsV26 | null;
  /** Runtime-estimated savings for skipped reads when full/chosen estimates are unavailable. */
  tokensSavedEstimate?: number | null;
  /** Gate B evidence: whether this tool call wrote an operation memory log row. */
  operationLogWritten?: boolean | null;
  /**
   * V26-FIX-08 — execution mode marker the V26-FIX-01 direct-api
   * executor wrote on this step. `'direct_api'` means the call took
   * the knowledge-driven fast path (no chrome_navigate, no
   * chrome_read_page DOM walk); `'via_read_page'` means the call
   * fell through to the legacy DOM/markdown path. Optional +
   * open-ended `string` so legacy v25/v26 NDJSON without the field
   * parses cleanly; values outside the closed enum count toward
   * neither numerator (direct_api) nor denominator-of-direct
   * (so missing values never silently inflate the ratio).
   */
  executionMode?: 'direct_api' | 'via_read_page' | string | null;
  /**
   * V26-FIX-08 — network-observe mode marker the V26-FIX-02
   * execution/learning split wrote on this step. `'foreground'`
   * means the runtime did synchronously start/stop
   * `chrome_network_capture`; `'background'`/`'disabled'` mean it
   * did not. The transformer counts `'foreground'` only — that's
   * the case the FIX-02 invariant cares about (we want it to be
   * rare in execution-mode runs, common in learning-mode runs).
   */
  observeMode?: 'foreground' | 'background' | 'disabled' | string | null;
  /**
   * V26-PGB-01 / V26-PGB-02 — `true` iff the API call this tool
   * call represents succeeded but returned zero rows (a verified
   * empty list, not a 0-row miss). The shim and direct API path
   * both stamp this on the api_rows envelope; legacy NDJSON without
   * the field parses cleanly (treated as `undefined`, not an empty
   * result). Optional and additive on the wire so older runners
   * stay compatible.
   */
  emptyResult?: boolean | null;
  /**
   * V26-PGB-01 / V26-PGB-02 — closed-enum reason for the empty
   * result; `null` on the non-empty happy path. Currently the only
   * value emitted by the readers is `'no_matching_records'`; new
   * values may be added without a v26 report version bump (the
   * transformer counts presence, not specific reasons).
   */
  emptyReason?: 'no_matching_records' | string | null;
}

/**
 * Closed enum of source-router outputs from V26-04's
 * `dispatchLayer` two-axis result. Open-ended `string` accepted at
 * record level so legacy NDJSON without `chosenSource` parses;
 * unrecognised values bucket into `unknown`.
 */
export type BenchmarkChosenSource =
  | 'experience_replay'
  | 'api_list'
  | 'api_detail'
  | 'markdown'
  | 'dom_json'
  | 'unknown';

export interface BenchmarkRunInputV26 extends BenchmarkRunInputV25WithBaseline {
  toolCalls: BenchmarkToolCallRecordV26[];
  /** `fixture` makes synthetic replay explicit; real MCP runners should set `real_mcp`. */
  evidenceKind?: BenchmarkEvidenceKindV26;
  /**
   * V26-FIX-08 — per-scenario latency budget map (scenarioId →
   * budget ms). When a scenario's observed median exceeds the
   * budget, the transformer emits `latencyGateStatus='warn'`; when
   * it exceeds 1.25x the budget, it emits `'fail'`. Scenarios
   * missing a budget (or with no observed median) get `'warn'`,
   * never silent `'pass'` — the V26-FIX-08 explicit anti-silent
   * rule.
   */
  latencyBudgetsMs?: Record<string, number>;
  /**
   * V26-FIX-08 — per-scenario competitor baseline map (scenarioId
   * → baseline). Use `mode: 'resilience_win'` to mark scenarios
   * where the win condition is "competitor blocked us, we got
   * through" rather than wall-clock latency (e.g. npmjs Cloudflare
   * challenge); the transformer reports `competitorDelta:
   * 'resilience_win'` and does NOT score the scenario on speed.
   */
  competitorBaselines?: Record<string, BenchmarkCompetitorBaselineV26>;
}

/**
 * V26-FIX-08 — competitor baseline metadata. `medianMs` is the
 * competitor's measured median for the same scenario in ms;
 * `mode='resilience_win'` short-circuits the speed comparison and
 * emits `competitorDelta='resilience_win'` regardless of latency.
 */
export interface BenchmarkCompetitorBaselineV26 {
  medianMs?: number | null;
  mode?: 'speed' | 'resilience_win';
}

export type BenchmarkEvidenceKindV26 = 'real_mcp' | 'fixture' | 'unknown';

export interface BenchmarkTaskTotalsV26 {
  readPageAvoidedCount?: number;
  tokensSavedEstimateTotal?: number;
}

export interface BenchmarkApiTelemetryV26 {
  endpointFamily?: string;
  status?: 'ok' | 'fallback' | string;
  reason?: string;
  httpStatus?: number | null;
  waitedMs?: number | null;
  fallbackEntryLayer?: string | null;
}

/**
 * Latency distribution bucket. `count` is the number of qualifying
 * records (i.e. records that survived `malformed_duration` exclusion).
 * `sumMs` is the simple sum, p50 and p95 are non-interpolating
 * order-statistics over the qualifying samples. `null` p50/p95 means
 * `count === 0`.
 */
export interface BenchmarkLatencyBucketV26 {
  /** Aggregation key (scenarioId for per-task, toolName for per-tool). */
  key: string;
  count: number;
  sumMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface BenchmarkComponentCountersV26 {
  mcp_tool: number;
  native_handler: number;
  extension_bridge: number;
  page_snapshot: number;
  unknown: number;
}

export interface BenchmarkChosenSourceCountersV26 {
  experience_replay: number;
  api_list: number;
  api_detail: number;
  markdown: number;
  dom_json: number;
  unknown: number;
}

/**
 * V26-FIX-05 — closed-enum counters for the lineage of every tool
 * call that emitted an API row. Mirrors the
 * {@link BenchmarkChosenSourceCountersV26} pattern: open-ended values
 * bucket into `unknown` so the report stays stable when a future
 * closed-enum extension lands.
 */
export interface BenchmarkEndpointSourceCountersV26 {
  observed: number;
  seed_adapter: number;
  manual_seed: number;
  unknown: number;
}

/**
 * Closed enum of v26 transformer warning codes. Open-ended `string`
 * NOT accepted — the transformer is the only producer.
 */
export type BenchmarkTransformerWarningCodeV26 =
  | 'malformed_duration'
  | 'missing_timestamps'
  | 'invalid_component'
  | 'invalid_chosen_source'
  | 'invalid_endpoint_source'
  | 'invalid_execution_mode'
  | 'invalid_observe_mode';

/**
 * V26-FIX-08 — closed enum of per-scenario latency-gate verdicts.
 * `'pass'` is only emitted when a budget is set AND the observed
 * median is at or below it; `'warn'` covers both "missing budget /
 * missing data" (anti-silent rule) and "over budget but under 1.25x
 * budget"; `'fail'` covers > 1.25x budget. Independent enum from
 * {@link BenchmarkEvidenceStatusV26} so the per-scenario gate can be
 * read without entangling the run-level status.
 */
export type BenchmarkLatencyGateStatusV26 = 'pass' | 'warn' | 'fail';

/**
 * V26-FIX-08 — closed enum of competitor-comparison verdicts.
 * `'lead'` and `'behind'` are simple speed verdicts;
 * `'resilience_win'` flags scenarios judged on resilience (e.g.
 * npmjs Cloudflare challenge) and bypasses the speed comparison;
 * `'blocked'` covers cases where comparison is impossible (no
 * observed median, no competitor median, or zero/negative competitor
 * median); `'not_compared'` means no competitor baseline was
 * provided for the scenario.
 */
export type BenchmarkCompetitorDeltaV26 =
  | 'lead'
  | 'near'
  | 'behind'
  | 'blocked'
  | 'resilience_win'
  | 'not_compared';

/**
 * V26-FIX-08 — per-scenario latency report entry. One per
 * scenarioId that appears in `perTaskDurationMs` OR in any of the
 * input maps (`latencyBudgetsMs` / `competitorBaselines`); the
 * transformer takes the union so consumers can see "we had a budget
 * but no run for it" too. Sorted by `scenarioId` ascending.
 */
export interface BenchmarkScenarioLatencyV26 {
  scenarioId: string;
  /** Number of qualifying samples (records with finite, non-negative durationMs). */
  count: number;
  medianMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  /** Configured budget in ms; `null` when not provided in `latencyBudgetsMs`. */
  budgetMs: number | null;
  latencyGateStatus: BenchmarkLatencyGateStatusV26;
  /** Competitor median in ms, mirrored from `competitorBaselines`; `null` when not provided. */
  competitorMedianMs: number | null;
  competitorDelta: BenchmarkCompetitorDeltaV26;
}

export interface BenchmarkTransformerWarningV26 {
  code: BenchmarkTransformerWarningCodeV26;
  /** `seq` of the offending record. May be undefined when the record itself omitted `seq`. */
  seq?: number;
  toolName?: string;
  /** Free-form diagnostic — informational only, never gate-relevant. */
  detail?: string;
}

export type BenchmarkEvidenceStatusV26 = 'pass' | 'warn' | 'fail';

export interface BenchmarkEvidenceFindingV26 {
  level: 'warn' | 'fail';
  code:
    | 'missing_v26_api_evidence'
    | 'read_page_avoided_zero'
    | 'tokens_saved_zero'
    | 'tab_hygiene_missing'
    | 'dispatcher_input_source_missing'
    | 'latency_gate_failed'
    | 'latency_gate_warning';
  detail: string;
}

export interface BenchmarkSummaryV26 {
  reportVersion: typeof BENCHMARK_REPORT_VERSION;
  /**
   * Full v25 release-evidence summary. v26 does not alter v25 fields
   * — it ONLY adds the step-telemetry overlay. Consumers that already
   * speak v25 can treat this field as a drop-in replacement.
   */
  v25Summary: BenchmarkSummaryV25;
  totalToolCalls: number;
  /** Sorted ascending by `key` (scenarioId). */
  perTaskDurationMs: BenchmarkLatencyBucketV26[];
  /** Sorted ascending by `key` (toolName). */
  perToolDurationMs: BenchmarkLatencyBucketV26[];
  /**
   * `unknownCount / totalToolCalls`. `null` when `totalToolCalls === 0`.
   * `unknownCount` is the number of records whose `component` is
   * missing or not in the closed enum.
   */
  unknownComponentRatio: number | null;
  componentDistribution: BenchmarkComponentCountersV26;
  /** Open-ended map; key is the `failureCode` string. */
  failureCodeDistribution: Record<string, number>;
  chosenSourceDistribution: BenchmarkChosenSourceCountersV26;
  /**
   * V26-FIX-05 — counts of tool calls grouped by the
   * `endpointSource` lineage marker the executor wrote. Sums over
   * every tool call that had an `endpointSource` value (regardless
   * of `chosenSource`); calls without the field are NOT counted into
   * `unknown` (that bucket is reserved for explicit-but-invalid
   * values, mirroring `chosenSourceDistribution`).
   */
  endpointSourceDistribution: BenchmarkEndpointSourceCountersV26;
  readPageAvoidedCount: number;
  tokensSavedEstimateTotal: number;
  layerDistribution: BenchmarkSummaryV25['layerMetrics']['chosenLayerDistribution'];
  dispatcherInputSourceDistribution: Record<string, number>;
  apiKnowledgeHitRate: number | null;
  fallbackDistribution: Record<string, number>;
  medianDuration: number | null;
  readPageCount: number;
  primaryTabReuseRate: number | null;
  maxConcurrentBenchmarkTabs: number | null;
  operationLogWriteRate: number | null;
  evidenceKind: BenchmarkEvidenceKindV26;
  evidenceStatus: BenchmarkEvidenceStatusV26;
  evidenceFindings: BenchmarkEvidenceFindingV26[];
  /**
   * V26-FIX-08 — per-scenario latency / competitor verdicts. Sorted
   * by `scenarioId` ascending. Includes every scenarioId observed in
   * `perTaskDurationMs` plus every scenarioId that appeared only in
   * `latencyBudgetsMs` or `competitorBaselines` (so a "we had a
   * budget but no run for it" condition is visible).
   */
  perScenarioLatency: BenchmarkScenarioLatencyV26[];
  /**
   * V26-FIX-08 — ratio of tool calls that took the
   * `executionMode='direct_api'` fast path over the count of tool
   * calls with any `executionMode` set. `null` when no record set
   * `executionMode` (so legacy v25 NDJSON does not pollute the
   * ratio). Records with an unrecognised `executionMode` value are
   * NOT counted in the denominator.
   */
  directApiPathRatio: number | null;
  /**
   * V26-FIX-08 — count of tool calls that recorded
   * `observeMode='foreground'`. The FIX-02 invariant says this
   * should stay near zero in execution-mode runs; the transformer
   * exposes the raw count so a release gate can enforce a ceiling.
   */
  foregroundObserveCount: number;
  /**
   * Total `waitedMs` summed across all records that recorded a finite
   * non-negative `waitedMs`. `null` when no qualifying samples.
   */
  totalWaitedMs: number | null;
  /**
   * V26-PGB-02 — number of tool calls whose `emptyResult === true`.
   * Counts the number of "verified empty" API answers in the run.
   * Distinct from `readPageCount === 0` (which simply means no DOM
   * read happened). Records without the field count as 0; records
   * with `emptyResult === false` are also 0. Used by Gate B's strict
   * mode to assert that an `expectEmptyResult` scenario carried real
   * `emptyResult` evidence, not a silent rowCount=0 miss.
   */
  emptyResultCount: number;
  /**
   * V26-PGB-02 — sorted, de-duplicated list of `scenarioId` values
   * that produced at least one tool call with `emptyResult === true`.
   * Empty array when no scenario produced a verified-empty answer.
   * The list is sorted lexicographically for deterministic output;
   * consumers MUST NOT mutate.
   */
  emptyResultScenarios: string[];
  /**
   * Sorted by `(code, seq)` ascending for deterministic output. The
   * transformer is the sole producer; consumers MUST NOT mutate.
   */
  transformerWarnings: BenchmarkTransformerWarningV26[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const COMPONENT_ENUM: ReadonlySet<BenchmarkStepComponent> = new Set([
  'mcp_tool',
  'native_handler',
  'extension_bridge',
  'page_snapshot',
  'unknown',
]);

const CHOSEN_SOURCE_ENUM: ReadonlySet<BenchmarkChosenSource> = new Set([
  'experience_replay',
  'api_list',
  'api_detail',
  'markdown',
  'dom_json',
  'unknown',
]);

/**
 * V26-FIX-05 — closed-enum members that the transformer counts as
 * "known lineage". Anything outside this set buckets into the
 * `unknown` counter and emits an `invalid_endpoint_source` warning.
 */
const ENDPOINT_SOURCE_ENUM: ReadonlySet<'observed' | 'seed_adapter' | 'manual_seed'> = new Set([
  'observed',
  'seed_adapter',
  'manual_seed',
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isComponent(value: unknown): value is BenchmarkStepComponent {
  return typeof value === 'string' && COMPONENT_ENUM.has(value as BenchmarkStepComponent);
}

function isChosenSource(value: unknown): value is BenchmarkChosenSource {
  return typeof value === 'string' && CHOSEN_SOURCE_ENUM.has(value as BenchmarkChosenSource);
}

function isEndpointSource(value: unknown): value is 'observed' | 'seed_adapter' | 'manual_seed' {
  return (
    typeof value === 'string' &&
    ENDPOINT_SOURCE_ENUM.has(value as 'observed' | 'seed_adapter' | 'manual_seed')
  );
}

/**
 * V26-FIX-08 — closed enum of execution-mode values the
 * direct-api-executor writes. Open-ended `string` accepted at the
 * record level for legacy NDJSON; values outside this set count
 * neither as "direct_api hit" nor as "via_read_page hit" (so they
 * never silently inflate the ratio numerator OR denominator).
 */
const EXECUTION_MODE_ENUM: ReadonlySet<'direct_api' | 'via_read_page'> = new Set([
  'direct_api',
  'via_read_page',
]);

function isExecutionMode(value: unknown): value is 'direct_api' | 'via_read_page' {
  return (
    typeof value === 'string' && EXECUTION_MODE_ENUM.has(value as 'direct_api' | 'via_read_page')
  );
}

const OBSERVE_MODE_ENUM: ReadonlySet<'foreground' | 'background' | 'disabled'> = new Set([
  'foreground',
  'background',
  'disabled',
]);

function isObserveMode(value: unknown): value is 'foreground' | 'background' | 'disabled' {
  return (
    typeof value === 'string' &&
    OBSERVE_MODE_ENUM.has(value as 'foreground' | 'background' | 'disabled')
  );
}

/**
 * V26-FIX-08 — over-budget multiplier above which the gate flips
 * from `'warn'` to `'fail'`. Conservative 1.25x so a small noise
 * margin does not cause false ship-blocks; > 1.25x is "user-visibly
 * slower" territory.
 */
const LATENCY_GATE_FAIL_MULTIPLIER = 1.25;

/**
 * V26-FIX-08 — competitor speed comparison thresholds. Anything
 * within ±10% counts as `'near'`; faster than 0.9x counts as
 * `'lead'`; slower than 1.1x counts as `'behind'`. Keeps the verdict
 * stable against the run-to-run latency noise we routinely see in
 * fixture-based comparisons.
 */
const COMPETITOR_LEAD_RATIO = 0.9;
const COMPETITOR_BEHIND_RATIO = 1.1;

function evaluateLatencyGate(
  median: number | null,
  budget: number | null,
): BenchmarkLatencyGateStatusV26 {
  if (median === null || budget === null) return 'warn';
  if (!Number.isFinite(budget) || budget <= 0) return 'warn';
  if (median > budget * LATENCY_GATE_FAIL_MULTIPLIER) return 'fail';
  if (median > budget) return 'warn';
  return 'pass';
}

function evaluateCompetitorDelta(
  observedMedian: number | null,
  competitor: BenchmarkCompetitorBaselineV26 | undefined,
): { delta: BenchmarkCompetitorDeltaV26; competitorMedianMs: number | null } {
  if (!competitor) return { delta: 'not_compared', competitorMedianMs: null };
  if (competitor.mode === 'resilience_win') {
    const competitorMedianMs = isFiniteNumber(competitor.medianMs) ? competitor.medianMs : null;
    return { delta: 'resilience_win', competitorMedianMs };
  }
  const competitorMedianMs = isFiniteNumber(competitor.medianMs) ? competitor.medianMs : null;
  if (observedMedian === null || competitorMedianMs === null || competitorMedianMs <= 0) {
    return { delta: 'blocked', competitorMedianMs };
  }
  const ratio = observedMedian / competitorMedianMs;
  if (ratio < COMPETITOR_LEAD_RATIO) return { delta: 'lead', competitorMedianMs };
  if (ratio > COMPETITOR_BEHIND_RATIO) return { delta: 'behind', competitorMedianMs };
  return { delta: 'near', competitorMedianMs };
}

function buildScenarioLatencyEntries(args: {
  perTaskBuckets: Map<string, number[]>;
  perScenarioBuckets?: Map<string, number[]>;
  latencyBudgetsMs: Record<string, number> | undefined;
  competitorBaselines: Record<string, BenchmarkCompetitorBaselineV26> | undefined;
}): BenchmarkScenarioLatencyV26[] {
  const scenarioIds = new Set<string>();
  for (const id of args.perTaskBuckets.keys()) scenarioIds.add(id);
  if (args.perScenarioBuckets) {
    for (const id of args.perScenarioBuckets.keys()) scenarioIds.add(id);
  }
  if (args.latencyBudgetsMs) {
    for (const id of Object.keys(args.latencyBudgetsMs)) scenarioIds.add(id);
  }
  if (args.competitorBaselines) {
    for (const id of Object.keys(args.competitorBaselines)) scenarioIds.add(id);
  }

  const sortedIds = [...scenarioIds].sort((a, b) => a.localeCompare(b));
  const entries: BenchmarkScenarioLatencyV26[] = [];
  for (const scenarioId of sortedIds) {
    // Prefer scenario wall-clock durations when the real-browser runner
    // emits them. Tool-call buckets are still accepted for legacy v26
    // fixtures, but release latency gates must not silently compare a
    // single tool's p50 against a whole-scenario budget.
    const samples =
      args.perScenarioBuckets?.get(scenarioId) ?? args.perTaskBuckets.get(scenarioId) ?? [];
    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const medianMs = quantile(sorted, 0.5);
    const minMs = count === 0 ? null : (sorted[0] ?? null);
    const maxMs = count === 0 ? null : (sorted[count - 1] ?? null);
    const rawBudget = args.latencyBudgetsMs?.[scenarioId];
    const budgetMs = isFiniteNumber(rawBudget) && rawBudget > 0 ? rawBudget : null;
    const latencyGateStatus = evaluateLatencyGate(medianMs, budgetMs);
    const { delta, competitorMedianMs } = evaluateCompetitorDelta(
      medianMs,
      args.competitorBaselines?.[scenarioId],
    );
    entries.push({
      scenarioId,
      count,
      medianMs,
      minMs,
      maxMs,
      budgetMs,
      latencyGateStatus,
      competitorMedianMs,
      competitorDelta: delta,
    });
  }
  return entries;
}

function buildScenarioDurationBuckets(
  scenarios: BenchmarkRunInputV26['scenarios'],
): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (const scenario of scenarios ?? []) {
    const scenarioId = scenario?.scenarioId;
    const duration = (scenario as BenchmarkScenarioRecord & { durationMs?: number | null })
      ?.durationMs;
    if (typeof scenarioId !== 'string' || scenarioId.length === 0) continue;
    if (!isFiniteNumber(duration) || duration < 0) continue;
    const arr = buckets.get(scenarioId) ?? [];
    arr.push(duration);
    buckets.set(scenarioId, arr);
  }
  return buckets;
}

function emptyComponentCounters(): BenchmarkComponentCountersV26 {
  return {
    mcp_tool: 0,
    native_handler: 0,
    extension_bridge: 0,
    page_snapshot: 0,
    unknown: 0,
  };
}

function emptyChosenSourceCounters(): BenchmarkChosenSourceCountersV26 {
  return {
    experience_replay: 0,
    api_list: 0,
    api_detail: 0,
    markdown: 0,
    dom_json: 0,
    unknown: 0,
  };
}

function emptyEndpointSourceCounters(): BenchmarkEndpointSourceCountersV26 {
  return {
    observed: 0,
    seed_adapter: 0,
    manual_seed: 0,
    unknown: 0,
  };
}

function increment(map: Record<string, number>, key: string): void {
  if (key.length === 0) return;
  map[key] = (map[key] ?? 0) + 1;
}

function maxNonNegativeFromTaskTotals(
  toolCalls: BenchmarkToolCallRecordV26[],
  key: keyof BenchmarkTaskTotalsV26,
): number {
  let max = 0;
  for (const call of toolCalls) {
    const value = call.taskTotals?.[key];
    if (isFiniteNumber(value) && value >= 0) {
      max = Math.max(max, value);
    }
  }
  return max;
}

function sumPositiveTokensSavedEstimate(toolCalls: BenchmarkToolCallRecordV26[]): number {
  let total = 0;
  for (const call of toolCalls) {
    if (call.readPageAvoided !== true && call.executionMode !== 'direct_api') continue;
    const value = call.tokensSavedEstimate;
    if (isFiniteNumber(value) && value > 0) {
      total += Math.floor(value);
    }
  }
  return total;
}

function countReadPageAvoidanceSignals(toolCalls: BenchmarkToolCallRecordV26[]): number {
  return toolCalls.filter(
    (call) => call.readPageAvoided === true || call.executionMode === 'direct_api',
  ).length;
}

function effectiveSourceKind(call: BenchmarkToolCallRecordV26): string | null {
  if (typeof call.sourceKind === 'string' && call.sourceKind.length > 0) return call.sourceKind;
  if (typeof call.chosenSource === 'string' && call.chosenSource.length > 0) {
    return call.chosenSource;
  }
  return null;
}

function isApiAttempt(call: BenchmarkToolCallRecordV26): boolean {
  const sourceKind = effectiveSourceKind(call);
  return (
    call.kind === 'api_rows' ||
    sourceKind === 'api_list' ||
    !!call.apiTelemetry ||
    (typeof call.apiFamily === 'string' && call.apiFamily.length > 0)
  );
}

function isApiHit(call: BenchmarkToolCallRecordV26): boolean {
  const sourceKind = effectiveSourceKind(call);
  return (
    call.kind === 'api_rows' ||
    ((sourceKind === 'api_list' || call.apiTelemetry?.status === 'ok') &&
      call.readPageAvoided === true)
  );
}

function isDomReadPage(call: BenchmarkToolCallRecordV26): boolean {
  if (call.toolName !== 'chrome_read_page') return false;
  if (call.readPageAvoided === true) return false;
  if (call.kind === 'api_rows') return false;
  if (effectiveSourceKind(call) === 'api_list') return false;
  return true;
}

function buildEvidenceFindings(args: {
  apiAttemptCount: number;
  dispatcherInputSourceCount: number;
  readPageAvoidedCount: number;
  tokensSavedEstimateTotal: number;
  tabHygienePresent: boolean;
  perScenarioLatency: BenchmarkScenarioLatencyV26[];
}): BenchmarkEvidenceFindingV26[] {
  const findings: BenchmarkEvidenceFindingV26[] = [];
  if (args.apiAttemptCount === 0) {
    findings.push({
      level: 'fail',
      code: 'missing_v26_api_evidence',
      detail: 'No V26-07/V26-08 API telemetry or api_rows evidence was present.',
    });
  }
  if (args.readPageAvoidedCount === 0) {
    findings.push({
      level: 'fail',
      code: 'read_page_avoided_zero',
      detail: 'No read_page avoidance was observed; V26 skip-read/API evidence is missing.',
    });
  }
  if (args.tokensSavedEstimateTotal === 0) {
    findings.push({
      level: 'fail',
      code: 'tokens_saved_zero',
      detail: 'No token savings were observed; the report must not be treated as a success.',
    });
  }
  if (!args.tabHygienePresent) {
    findings.push({
      level: 'warn',
      code: 'tab_hygiene_missing',
      detail: 'No v25 tab hygiene block was present in the input.',
    });
  }
  if (args.dispatcherInputSourceCount === 0) {
    findings.push({
      level: 'warn',
      code: 'dispatcher_input_source_missing',
      detail:
        'No dispatcherInputSource values were present; source-distribution evidence is partial.',
    });
  }
  // V26-FIX-08 — per-scenario latency gate. `'fail'` is a strict
  // failure (release-blocking when a consumer routes evidenceStatus
  // === 'fail' to a hard gate); `'warn'` is informational. We
  // collapse multiple offending scenarios into a single finding with
  // a comma-joined detail to keep evidenceFindings deterministic and
  // bounded in length.
  const failedScenarios = args.perScenarioLatency
    .filter((entry) => entry.latencyGateStatus === 'fail')
    .map((entry) => entry.scenarioId);
  if (failedScenarios.length > 0) {
    findings.push({
      level: 'fail',
      code: 'latency_gate_failed',
      detail: `Latency gate failed for scenarios: ${failedScenarios.join(', ')}`,
    });
  }
  const warnedScenarios = args.perScenarioLatency
    .filter((entry) => entry.latencyGateStatus === 'warn')
    .map((entry) => entry.scenarioId);
  if (warnedScenarios.length > 0) {
    findings.push({
      level: 'warn',
      code: 'latency_gate_warning',
      detail: `Latency gate warning for scenarios: ${warnedScenarios.join(', ')}`,
    });
  }
  return findings;
}

/**
 * Non-interpolating order statistic at fractional rank `q` (0 < q < 1).
 * Matches the v25 transformer's `median` semantics for q = 0.5.
 */
function quantile(sortedAsc: number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return sortedAsc[0] ?? null;
  if (q <= 0) return sortedAsc[0] ?? null;
  if (q >= 1) return sortedAsc[sortedAsc.length - 1] ?? null;
  // For q === 0.5 with an even-length array we want the v25 behaviour
  // (mean of the two middle values). For other quantiles we use the
  // "nearest-rank" definition (no interpolation) — matches the v23/v24
  // p50 helper which the v26 transformer must not contradict for
  // toolName latency aggregation.
  if (q === 0.5 && sortedAsc.length % 2 === 0) {
    const mid = sortedAsc.length / 2;
    const lower = sortedAsc[mid - 1];
    const upper = sortedAsc[mid];
    if (lower === undefined || upper === undefined) return null;
    return (lower + upper) / 2;
  }
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? null;
}

function buildLatencyBucket(key: string, samples: number[]): BenchmarkLatencyBucketV26 {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    key,
    count: sorted.length,
    sumMs: sum,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
  };
}

function compareWarnings(
  a: BenchmarkTransformerWarningV26,
  b: BenchmarkTransformerWarningV26,
): number {
  const codeOrder = a.code.localeCompare(b.code);
  if (codeOrder !== 0) return codeOrder;
  const seqA = isFiniteNumber(a.seq) ? a.seq : Number.POSITIVE_INFINITY;
  const seqB = isFiniteNumber(b.seq) ? b.seq : Number.POSITIVE_INFINITY;
  if (seqA !== seqB) return seqA - seqB;
  // Stable tiebreaker on toolName to keep determinism even when seq is
  // duplicated or undefined.
  const toolA = a.toolName ?? '';
  const toolB = b.toolName ?? '';
  return toolA.localeCompare(toolB);
}

interface RecordTriage {
  durationValid: boolean;
  duration: number;
  componentBucket: BenchmarkStepComponent;
  warnings: BenchmarkTransformerWarningV26[];
}

function triageRecord(call: BenchmarkToolCallRecordV26): RecordTriage {
  const warnings: BenchmarkTransformerWarningV26[] = [];

  // Duration validity. The base v23 contract makes `durationMs` a
  // required number; we still defensively check for negative or
  // non-finite values because the runtime may emit them when timing
  // wraps or when a step was aborted before `endedAt` was recorded.
  const duration = call.durationMs;
  const durationValid = isFiniteNumber(duration) && duration >= 0;
  if (!durationValid) {
    warnings.push({
      code: 'malformed_duration',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
      detail: `durationMs=${String(duration)}`,
    });
  }

  // Timestamp completeness. We do not gate latency on this — durationMs
  // is the authoritative number — but we surface it so the runner-side
  // QA can spot harness coverage gaps.
  const hasStarted = typeof call.startedAt === 'string' && call.startedAt.length > 0;
  const hasEnded = typeof call.endedAt === 'string' && call.endedAt.length > 0;
  if (!hasStarted && !hasEnded) {
    warnings.push({
      code: 'missing_timestamps',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
    });
  }

  // Component bucket.
  let componentBucket: BenchmarkStepComponent;
  if (isComponent(call.component)) {
    componentBucket = call.component;
  } else {
    componentBucket = 'unknown';
    if (call.component !== undefined && call.component !== null) {
      warnings.push({
        code: 'invalid_component',
        seq: isFiniteNumber(call.seq) ? call.seq : undefined,
        toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
        detail: `component=${String(call.component)}`,
      });
    }
  }

  // Source-router validation. Only warn when the runner emitted a
  // value at all — undefined `chosenSource` is normal for legacy v25
  // NDJSON and not a defect.
  if (
    call.chosenSource !== undefined &&
    call.chosenSource !== null &&
    !isChosenSource(call.chosenSource)
  ) {
    warnings.push({
      code: 'invalid_chosen_source',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
      detail: `chosenSource=${String(call.chosenSource)}`,
    });
  }

  // V26-FIX-05 — endpoint-source validation. Only warn when the
  // runner emitted a value at all; undefined `endpointSource` is
  // normal for v25 NDJSON and for non-API tool calls.
  if (
    call.endpointSource !== undefined &&
    call.endpointSource !== null &&
    !isEndpointSource(call.endpointSource)
  ) {
    warnings.push({
      code: 'invalid_endpoint_source',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
      detail: `endpointSource=${String(call.endpointSource)}`,
    });
  }

  // V26-FIX-08 — execution-mode validation. Only warn when the
  // runner emitted a value at all; undefined `executionMode` is
  // normal for v25/v26 NDJSON without the FIX-01 telemetry.
  if (
    call.executionMode !== undefined &&
    call.executionMode !== null &&
    !isExecutionMode(call.executionMode)
  ) {
    warnings.push({
      code: 'invalid_execution_mode',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
      detail: `executionMode=${String(call.executionMode)}`,
    });
  }

  // V26-FIX-08 — observe-mode validation. Mirrors the executionMode
  // path; missing values are normal, only explicit-but-invalid
  // values warn.
  if (
    call.observeMode !== undefined &&
    call.observeMode !== null &&
    !isObserveMode(call.observeMode)
  ) {
    warnings.push({
      code: 'invalid_observe_mode',
      seq: isFiniteNumber(call.seq) ? call.seq : undefined,
      toolName: typeof call.toolName === 'string' ? call.toolName : undefined,
      detail: `observeMode=${String(call.observeMode)}`,
    });
  }

  return {
    durationValid,
    duration: durationValid ? duration : 0,
    componentBucket,
    warnings,
  };
}

/**
 * Project a finished v2.6 real-browser run into a v2.6
 * release-evidence report. Pure function. Re-running with the same
 * input must produce an identical output.
 *
 * The function delegates the entire v25 surface (`v25Summary`) to
 * `summariseBenchmarkRunV25`; v26-only aggregates are layered on top
 * without re-walking the v25-specific fields.
 */
export function summariseBenchmarkRunV26(input: BenchmarkRunInputV26): BenchmarkSummaryV26 {
  const toolCalls = input.toolCalls ?? [];
  const totalToolCalls = toolCalls.length;

  const v25Summary = summariseBenchmarkRunV25(input);

  const componentDistribution = emptyComponentCounters();
  const chosenSourceDistribution = emptyChosenSourceCounters();
  const endpointSourceDistribution = emptyEndpointSourceCounters();
  const failureCodeDistribution: Record<string, number> = {};
  const dispatcherInputSourceDistribution: Record<string, number> = {};
  const fallbackDistribution: Record<string, number> = {};
  const transformerWarnings: BenchmarkTransformerWarningV26[] = [];

  const perTaskBuckets = new Map<string, number[]>();
  const perToolBuckets = new Map<string, number[]>();
  const validDurations: number[] = [];

  let waitedMsTotal = 0;
  let waitedMsSamples = 0;
  let apiAttemptCount = 0;
  let apiHitCount = 0;
  let dispatcherInputSourceCount = 0;
  let readPageCount = 0;
  let operationLogEvidenceCount = 0;
  let operationLogWriteCount = 0;
  let executionModeKnownCount = 0;
  let directApiPathCount = 0;
  let foregroundObserveCount = 0;
  // V26-PGB-02 — track verified-empty API answers so the Gate B
  // strict gate can assert that an `expectEmptyResult` scenario
  // actually carried `emptyResult=true` evidence (and not a silent
  // rowCount=0 miss). `emptyResultCount` is the simple total;
  // `emptyResultScenarioSet` is de-duplicated and sorted on emit.
  let emptyResultCount = 0;
  const emptyResultScenarioSet = new Set<string>();

  for (const call of toolCalls) {
    const triage = triageRecord(call);
    componentDistribution[triage.componentBucket] += 1;
    transformerWarnings.push(...triage.warnings);

    if (triage.durationValid) {
      validDurations.push(triage.duration);
      if (typeof call.scenarioId === 'string' && call.scenarioId.length > 0) {
        const arr = perTaskBuckets.get(call.scenarioId) ?? [];
        arr.push(triage.duration);
        perTaskBuckets.set(call.scenarioId, arr);
      }
      if (typeof call.toolName === 'string' && call.toolName.length > 0) {
        const arr = perToolBuckets.get(call.toolName) ?? [];
        arr.push(triage.duration);
        perToolBuckets.set(call.toolName, arr);
      }
    }

    if (typeof call.failureCode === 'string' && call.failureCode.length > 0) {
      failureCodeDistribution[call.failureCode] =
        (failureCodeDistribution[call.failureCode] ?? 0) + 1;
    }

    if (isChosenSource(call.chosenSource)) {
      chosenSourceDistribution[call.chosenSource] += 1;
    } else if (call.chosenSource !== undefined && call.chosenSource !== null) {
      chosenSourceDistribution.unknown += 1;
    }

    if (isEndpointSource(call.endpointSource)) {
      endpointSourceDistribution[call.endpointSource] += 1;
    } else if (call.endpointSource !== undefined && call.endpointSource !== null) {
      endpointSourceDistribution.unknown += 1;
    }

    if (isFiniteNumber(call.waitedMs) && call.waitedMs >= 0) {
      waitedMsTotal += call.waitedMs;
      waitedMsSamples += 1;
    }

    if (typeof call.dispatcherInputSource === 'string' && call.dispatcherInputSource.length > 0) {
      increment(dispatcherInputSourceDistribution, call.dispatcherInputSource);
      dispatcherInputSourceCount += 1;
    }

    if (isApiAttempt(call)) {
      apiAttemptCount += 1;
      if (isApiHit(call)) apiHitCount += 1;
    }

    if (isDomReadPage(call)) readPageCount += 1;

    if (typeof call.operationLogWritten === 'boolean') {
      operationLogEvidenceCount += 1;
      if (call.operationLogWritten) operationLogWriteCount += 1;
    }

    if (isExecutionMode(call.executionMode)) {
      executionModeKnownCount += 1;
      if (call.executionMode === 'direct_api') directApiPathCount += 1;
    }

    if (isObserveMode(call.observeMode) && call.observeMode === 'foreground') {
      foregroundObserveCount += 1;
    }

    // V26-PGB-02 — only the literal boolean `true` counts. Records
    // without the field, or with `emptyResult === false`, are
    // explicitly NOT counted (so legacy NDJSON without the field
    // never silently inflates the metric).
    if (call.emptyResult === true) {
      emptyResultCount += 1;
      if (typeof call.scenarioId === 'string' && call.scenarioId.length > 0) {
        emptyResultScenarioSet.add(call.scenarioId);
      }
    }

    if (typeof call.fallbackCause === 'string' && call.fallbackCause.length > 0) {
      increment(fallbackDistribution, call.fallbackCause);
    } else if (
      call.apiTelemetry &&
      call.apiTelemetry.status !== 'ok' &&
      typeof call.apiTelemetry.reason === 'string' &&
      call.apiTelemetry.reason.length > 0
    ) {
      increment(fallbackDistribution, call.apiTelemetry.reason);
    } else if (call.fallbackUsed === true) {
      increment(fallbackDistribution, 'fallback_used');
    }
  }

  const perTaskDurationMs: BenchmarkLatencyBucketV26[] = [...perTaskBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, samples]) => buildLatencyBucket(key, samples));

  const perToolDurationMs: BenchmarkLatencyBucketV26[] = [...perToolBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, samples]) => buildLatencyBucket(key, samples));

  const unknownComponentRatio =
    totalToolCalls === 0 ? null : componentDistribution.unknown / totalToolCalls;

  const readPageAvoidedCount = Math.max(
    v25Summary.layerMetrics.readPageAvoidedCount,
    maxNonNegativeFromTaskTotals(toolCalls, 'readPageAvoidedCount'),
    countReadPageAvoidanceSignals(toolCalls),
  );
  const tokensSavedEstimateTotal = Math.max(
    v25Summary.layerMetrics.tokensSavedEstimateTotal,
    maxNonNegativeFromTaskTotals(toolCalls, 'tokensSavedEstimateTotal'),
    sumPositiveTokensSavedEstimate(toolCalls),
  );
  const medianDuration = quantile(
    [...validDurations].sort((a, b) => a - b),
    0.5,
  );
  const apiKnowledgeHitRate = apiAttemptCount === 0 ? null : apiHitCount / apiAttemptCount;
  const operationLogWriteRate =
    operationLogEvidenceCount === 0 ? null : operationLogWriteCount / operationLogEvidenceCount;
  const tabHygienePresent = v25Summary.tabHygiene !== null;
  const evidenceKind: BenchmarkEvidenceKindV26 =
    input.evidenceKind ??
    (input.buildSha === 'fixture' || input.runId.toLowerCase().includes('fixture')
      ? 'fixture'
      : 'unknown');
  const perScenarioLatency = buildScenarioLatencyEntries({
    perTaskBuckets,
    perScenarioBuckets: buildScenarioDurationBuckets(input.scenarios),
    latencyBudgetsMs: input.latencyBudgetsMs,
    competitorBaselines: input.competitorBaselines,
  });
  const directApiPathRatio =
    executionModeKnownCount === 0 ? null : directApiPathCount / executionModeKnownCount;
  const evidenceFindings = buildEvidenceFindings({
    apiAttemptCount,
    dispatcherInputSourceCount,
    readPageAvoidedCount,
    tokensSavedEstimateTotal,
    tabHygienePresent,
    perScenarioLatency,
  });
  const evidenceStatus: BenchmarkEvidenceStatusV26 = evidenceFindings.some(
    (finding) => finding.level === 'fail',
  )
    ? 'fail'
    : evidenceFindings.some((finding) => finding.level === 'warn')
      ? 'warn'
      : 'pass';

  transformerWarnings.sort(compareWarnings);

  return {
    reportVersion: BENCHMARK_REPORT_VERSION,
    v25Summary,
    totalToolCalls,
    perTaskDurationMs,
    perToolDurationMs,
    unknownComponentRatio,
    componentDistribution,
    failureCodeDistribution,
    chosenSourceDistribution,
    endpointSourceDistribution,
    readPageAvoidedCount,
    tokensSavedEstimateTotal,
    layerDistribution: v25Summary.layerMetrics.chosenLayerDistribution,
    dispatcherInputSourceDistribution,
    apiKnowledgeHitRate,
    fallbackDistribution,
    medianDuration,
    readPageCount,
    primaryTabReuseRate: v25Summary.tabHygiene?.primaryTabReuseRate ?? null,
    maxConcurrentBenchmarkTabs: v25Summary.tabHygiene?.maxConcurrentTabs ?? null,
    operationLogWriteRate,
    evidenceKind,
    evidenceStatus,
    evidenceFindings,
    perScenarioLatency,
    directApiPathRatio,
    foregroundObserveCount,
    totalWaitedMs: waitedMsSamples > 0 ? waitedMsTotal : null,
    emptyResultCount,
    emptyResultScenarios: [...emptyResultScenarioSet].sort((a, b) => a.localeCompare(b)),
    transformerWarnings,
  };
}

// NOTE: The v26 release gate (`scripts/lib/v26-benchmark-gate.cjs`)
// does not exist yet — it lands in S3 V26-14. When it does, it must
// import `BENCHMARK_REPORT_VERSION` from this module via a
// cross-source-checked test (mirroring the v23/v24/v25 pattern in
// `v25-benchmark.test.ts`).
