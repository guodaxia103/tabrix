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
  /** V26-07 API telemetry, kept redacted and optional for legacy NDJSON. */
  apiTelemetry?: BenchmarkApiTelemetryV26 | null;
  /** V26-03 task totals copied from skip-read envelopes. */
  taskTotals?: BenchmarkTaskTotalsV26 | null;
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
 * Closed enum of v26 transformer warning codes. Open-ended `string`
 * NOT accepted — the transformer is the only producer.
 */
export type BenchmarkTransformerWarningCodeV26 =
  | 'malformed_duration'
  | 'missing_timestamps'
  | 'invalid_component'
  | 'invalid_chosen_source';

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
    | 'dispatcher_input_source_missing';
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
  evidenceKind: BenchmarkEvidenceKindV26;
  evidenceStatus: BenchmarkEvidenceStatusV26;
  evidenceFindings: BenchmarkEvidenceFindingV26[];
  /**
   * Total `waitedMs` summed across all records that recorded a finite
   * non-negative `waitedMs`. `null` when no qualifying samples.
   */
  totalWaitedMs: number | null;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isComponent(value: unknown): value is BenchmarkStepComponent {
  return typeof value === 'string' && COMPONENT_ENUM.has(value as BenchmarkStepComponent);
}

function isChosenSource(value: unknown): value is BenchmarkChosenSource {
  return typeof value === 'string' && CHOSEN_SOURCE_ENUM.has(value as BenchmarkChosenSource);
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
  );
  const tokensSavedEstimateTotal = Math.max(
    v25Summary.layerMetrics.tokensSavedEstimateTotal,
    maxNonNegativeFromTaskTotals(toolCalls, 'tokensSavedEstimateTotal'),
  );
  const medianDuration = quantile(
    [...validDurations].sort((a, b) => a - b),
    0.5,
  );
  const apiKnowledgeHitRate = apiAttemptCount === 0 ? null : apiHitCount / apiAttemptCount;
  const tabHygienePresent = v25Summary.tabHygiene !== null;
  const evidenceKind: BenchmarkEvidenceKindV26 =
    input.evidenceKind ??
    (input.buildSha === 'fixture' || input.runId.toLowerCase().includes('fixture')
      ? 'fixture'
      : 'unknown');
  const evidenceFindings = buildEvidenceFindings({
    apiAttemptCount,
    dispatcherInputSourceCount,
    readPageAvoidedCount,
    tokensSavedEstimateTotal,
    tabHygienePresent,
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
    evidenceKind,
    evidenceStatus,
    evidenceFindings,
    totalWaitedMs: waitedMsSamples > 0 ? waitedMsTotal : null,
    transformerWarnings,
  };
}

// NOTE: The v26 release gate (`scripts/lib/v26-benchmark-gate.cjs`)
// does not exist yet — it lands in S3 V26-14. When it does, it must
// import `BENCHMARK_REPORT_VERSION` from this module via a
// cross-source-checked test (mirroring the v23/v24/v25 pattern in
// `v25-benchmark.test.ts`).
