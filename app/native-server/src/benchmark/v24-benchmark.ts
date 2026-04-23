/**
 * Tabrix v2.4.0 benchmark transformer (V24-05).
 *
 * Pure data transformer. No IO, no DOM, no network. Takes a list of
 * structured tool-call records (the same NDJSON shape v23 uses) plus
 * the new pair-aware `kind: 'pair'` records that bind tool-call
 * sequence numbers to first-touch / second-touch passes of the same
 * scenario, and produces a deterministic v2.4.0 release-evidence
 * report.
 *
 * Why a separate transformer rather than extending v23: the v2.3.0
 * release gate is the v2.3.0 ship contract — its report shape is
 * frozen at `BENCHMARK_REPORT_VERSION = 1` (cross-source-checked by
 * `v23-benchmark.test.ts`). v2.4.0 adds:
 *
 *   - Pair-aware schema: each KPI scenario runs twice (first_touch /
 *     second_touch). K5 (second-touch speedup) and K8 (token saving
 *     ratio, `(first - second) / first`, higher is better) are
 *     MEDIANS across pairs, not means.
 *   - Replay eligibility distribution: tool calls carry the V24-03
 *     chooser strategy + `replayEligibleBlockedBy` reason so the
 *     report can show "cold | replay | reuse | knowledge_light"
 *     distribution and "blocked because: capability_off | …".
 *   - A `pairCount >= 3` invariant per KPI scenario before K5..K8 are
 *     considered evidence-graded.
 *
 * This transformer owns step (3) of the maintainer loop:
 *
 *   1. Real-browser scenarios listed in
 *      `docs/RELEASE_NOTES_v2.4.0_DRAFT.md` §"Maintainer command list".
 *   2. The runner appends one NDJSON line per tool invocation +
 *      one per scenario + one per pair to the run file.
 *   3. `pnpm run benchmark:v24 -- --input <file>` calls
 *      `summariseBenchmarkRunV24(records)` and writes the report.
 *
 * The actual real-browser run is maintainer-only (`AGENTS.md` rule 14).
 *
 * Schema invariants (do NOT break without bumping
 * `BENCHMARK_REPORT_VERSION`):
 *  - Every K-metric is either a finite number or `null` (not
 *    `undefined`, not `NaN`). `null` means "no qualifying samples".
 *  - Counter fields are integers ≥ 0.
 *  - Per-tool latency uses p50 not mean (matches v23).
 *  - Lane-integrity violations are a hard release blocker — the gate
 *    in `scripts/lib/v24-benchmark-gate.cjs` refuses to ship if any
 *    are present.
 *  - K5..K8 are EVIDENCE-ONLY in v2.4 (the gate emits `WARN:` reasons
 *    when they breach guidance, not hard failures).
 *  - `pairCount >= 3` per KPI scenario IS a hard requirement.
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

/**
 * v24 report version. Independent counter from v23. Bumped only when
 * the v24 report shape changes in a way the v24 release gate must
 * learn about.
 */
export const BENCHMARK_REPORT_VERSION = 1 as const;

/**
 * Re-export v23 primitives that v24 explicitly re-uses. Keeping the
 * re-export here means `v24-benchmark.test.ts` and the gate can
 * import everything from one module without reaching into v23.
 */
export type {
  BenchmarkLane,
  BenchmarkLaneCounters,
  BenchmarkPerToolLatency,
  BenchmarkScenarioRecord,
  BenchmarkToolCallRecord,
  BenchmarkToolCallStatus,
};

/**
 * v23 report version, re-exported so the v24 gate can assert that the
 * two transformers do not silently merge their schemas.
 */
export const V23_REPORT_VERSION = V23_BENCHMARK_REPORT_VERSION;

/**
 * Closed enum of v24 chooser strategies. Mirrors
 * `ContextStrategyName` in `packages/shared/src/choose-context.ts`
 * exactly; we hard-code the union here rather than depending on the
 * shared package because the benchmark transformer must remain
 * shared-package-version-tolerant (a maintainer running an older NDJSON
 * against a newer transformer must still get a clean error rather than
 * a TypeScript build break).
 */
export type BenchmarkChooserStrategy =
  | 'experience_replay'
  | 'experience_reuse'
  | 'knowledge_light'
  | 'read_page_required'
  | 'read_page_markdown'
  | 'cold';

/**
 * Closed enum of `replayEligibleBlockedBy` reasons. Mirrors
 * `ReplayEligibilityBlockReason` in
 * `packages/shared/src/choose-context.ts` (V24-03). Same
 * shared-version-tolerance rationale as `BenchmarkChooserStrategy`.
 */
export type BenchmarkReplayBlockReason =
  | 'capability_off'
  | 'unsupported_step_kind'
  | 'non_portable_args'
  | 'non_github_pageRole'
  | 'below_threshold'
  | 'stale_locator'
  | 'none';

/**
 * Per-pair binding. Each KPI scenario emits two pairs (one
 * `first_touch` and one `second_touch`); the runner provides the
 * sequence numbers of the tool calls that belong to each role. K5..K8
 * use these bindings to compute per-pair deltas.
 *
 * Cross-pair invariants enforced by the transformer:
 *  - `pairIndex` ≥ 0.
 *  - `toolCallSeqs` references valid `seq` values from the run.
 *  - Within a single `(scenarioId, pairIndex)`, both `first_touch` and
 *    `second_touch` roles must be present for the pair to count as a
 *    "complete pair" for K5..K8.
 */
export interface BenchmarkPairRecord {
  pairIndex: number;
  scenarioId: string;
  role: 'first_touch' | 'second_touch';
  toolCallSeqs: number[];
}

/**
 * Per-tool-call v24 metadata. The runner attaches the V24-03 chooser
 * strategy + `replayEligibleBlockedBy` reason to every tool call it
 * emits so the transformer can derive `replayEligibilityDistribution`
 * without re-reading the chooser's telemetry table (which the chooser
 * intentionally does NOT extend in v2.4 — see V24-03 plan §2.5).
 *
 * Every field is optional so older NDJSON files (or runs against a
 * pre-V24-03 native server) still parse cleanly; the transformer
 * counts those calls under the `unknown` bucket of the distribution.
 */
export interface BenchmarkToolCallRecordV24 extends BenchmarkToolCallRecord {
  chooserStrategy?: BenchmarkChooserStrategy;
  chooserBlockedBy?: BenchmarkReplayBlockReason;
  /**
   * Total LLM-side input tokens attributed to this tool call (the
   * v23 `inputTokens` field). Mirrored here so K8 (token saving
   * ratio, `(first - second) / first`, higher is better) can read it
   * without poking back into the v23 type. Optional; `null` is allowed
   * and means "the runner did not measure it".
   */
  tokensIn?: number | null;
}

export interface BenchmarkRunInputV24 {
  runId: string;
  runStartedAt: string;
  runEndedAt: string;
  buildSha: string;
  /** Optional list of scenario ids to treat as KPI scenarios for K5..K8. Empty list means "every scenario is a KPI scenario". */
  kpiScenarioIds?: string[];
  toolCalls: BenchmarkToolCallRecordV24[];
  scenarios: BenchmarkScenarioRecord[];
  pairs: BenchmarkPairRecord[];
}

export interface BenchmarkPairAggregateStats {
  /** Number of complete (`first_touch` + `second_touch`) pairs in the scenario. */
  pairCount: number;
  /** Number of pairs missing one of the two roles. Surfaces runner bugs. */
  incompletePairs: number;
  k5SecondTouchSpeedupMedian: number | null;
  k5SecondTouchSpeedupMin: number | null;
  k5SecondTouchSpeedupMax: number | null;
  k5SecondTouchSpeedupStddev: number | null;
  k6ReplaySuccessRateMedian: number | null;
  k6ReplaySuccessRateMin: number | null;
  k6ReplaySuccessRateMax: number | null;
  k6ReplaySuccessRateStddev: number | null;
  k7ReplayFallbackRateMedian: number | null;
  k7ReplayFallbackRateMin: number | null;
  k7ReplayFallbackRateMax: number | null;
  k7ReplayFallbackRateStddev: number | null;
  k8TokenSavingRatioMedian: number | null;
  k8TokenSavingRatioMin: number | null;
  k8TokenSavingRatioMax: number | null;
  k8TokenSavingRatioStddev: number | null;
}

export interface BenchmarkPairBucket {
  pairIndex: number;
  /** First-touch wall-clock duration sum (ms) across the pair's tool calls. */
  firstTouchDurationMs: number | null;
  /** Second-touch wall-clock duration sum (ms) across the pair's tool calls. */
  secondTouchDurationMs: number | null;
  /** First-touch input-token sum across the pair's tool calls (null = not measurable). */
  firstTouchTokensIn: number | null;
  /** Second-touch input-token sum across the pair's tool calls. */
  secondTouchTokensIn: number | null;
  /** Number of replay-tagged tool calls in the second touch (chooserStrategy = 'experience_replay' OR fallbackUsed=false but the second touch ran a replay path). */
  secondTouchReplayCount: number;
  /** Number of replay-tagged tool calls that succeeded (status='ok'). */
  secondTouchReplaySuccessCount: number;
  /** Number of second-touch tool calls that fell back (`fallbackUsed=true` OR chooserStrategy != 'experience_replay'). */
  secondTouchFallbackCount: number;
  /** Total tool calls in the second touch (used for fallback-rate denominator). */
  secondTouchTotalCount: number;
  /** Whether the pair contributes to K5..K8 — must have both roles AND non-null durations. */
  complete: boolean;
}

export interface BenchmarkScenarioPairBlock {
  scenarioId: string;
  /** Per-pair primitive numbers. Sorted by pairIndex ASC for stable output. */
  perPair: BenchmarkPairBucket[];
  aggregate: BenchmarkPairAggregateStats;
}

export interface BenchmarkReplayEligibilityCounters {
  experience_replay: number;
  experience_reuse: number;
  knowledge_light: number;
  read_page_required: number;
  read_page_markdown: number;
  cold: number;
  unknown: number;
}

export interface BenchmarkReplayBlockedByCounters {
  capability_off: number;
  unsupported_step_kind: number;
  non_portable_args: number;
  non_github_pageRole: number;
  below_threshold: number;
  stale_locator: number;
  none: number;
  unknown: number;
}

export interface BenchmarkSummaryV24 {
  reportVersion: typeof BENCHMARK_REPORT_VERSION;
  runId: string;
  runStartedAt: string;
  runEndedAt: string;
  buildSha: string;

  totalToolCalls: number;
  scenarioCompletionRate: number | null;
  totalScenarios: number;
  completedScenarios: number;
  /** KPI scenario ids the gate must enforce `pairCount >= 3` on. Mirrors input. */
  kpiScenarioIds: string[];

  /** v23-equivalent K1..K4 carried forward. */
  k1MeanInputTokensPerTask: number | null;
  k2PerToolLatencyMs: BenchmarkPerToolLatency[];
  k3TaskSuccessRate: number | null;
  k4ToolRetryRate: number | null;
  k4FallbackRate: number | null;

  /** v23-equivalent counters carried forward. */
  readPageProbeCount: number;
  laneCounters: BenchmarkLaneCounters;
  meanClickAttemptsPerStep: number | null;

  /** Per-scenario pair block. Sorted by scenarioId ASC for stable output. */
  pairs: BenchmarkScenarioPairBlock[];

  /** Run-wide MEDIAN across every complete pair. `null` when no complete pairs. */
  k5SecondTouchSpeedup: number | null;
  k6ReplaySuccessRate: number | null;
  k7ReplayFallbackRate: number | null;
  k8TokenSavingRatio: number | null;

  /** Distribution of chooser strategies across all tool calls. */
  replayEligibilityDistribution: BenchmarkReplayEligibilityCounters;
  /** Distribution of `replayEligibleBlockedBy` across all tool calls. */
  replayEligibilityBlockedBy: BenchmarkReplayBlockedByCounters;
}

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

function minOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0]!;
  for (let i = 1; i < values.length; i += 1) if (values[i]! < m) m = values[i]!;
  return m;
}

function maxOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0]!;
  for (let i = 1; i < values.length; i += 1) if (values[i]! > m) m = values[i]!;
  return m;
}

function stddevOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  if (values.length === 1) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function safeNonNegative(value: number): number {
  return value < 0 || !Number.isFinite(value) ? 0 : value;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

interface PairBindingKey {
  scenarioId: string;
  pairIndex: number;
}

interface PairBuckets {
  firstTouchSeqs: Set<number>;
  secondTouchSeqs: Set<number>;
}

function bucketPairBindings(pairs: BenchmarkPairRecord[]): Map<string, Map<number, PairBuckets>> {
  const byScenario = new Map<string, Map<number, PairBuckets>>();
  for (const pair of pairs) {
    if (!byScenario.has(pair.scenarioId)) {
      byScenario.set(pair.scenarioId, new Map());
    }
    const scenarioMap = byScenario.get(pair.scenarioId)!;
    if (!scenarioMap.has(pair.pairIndex)) {
      scenarioMap.set(pair.pairIndex, {
        firstTouchSeqs: new Set(),
        secondTouchSeqs: new Set(),
      });
    }
    const bucket = scenarioMap.get(pair.pairIndex)!;
    const target = pair.role === 'first_touch' ? bucket.firstTouchSeqs : bucket.secondTouchSeqs;
    for (const seq of pair.toolCallSeqs) {
      if (Number.isInteger(seq) && seq >= 0) {
        target.add(seq);
      }
    }
  }
  return byScenario;
}

function projectPairBucket(
  pairIndex: number,
  buckets: PairBuckets,
  callsBySeq: Map<number, BenchmarkToolCallRecordV24>,
): BenchmarkPairBucket {
  const firstTouchCalls: BenchmarkToolCallRecordV24[] = [];
  for (const seq of buckets.firstTouchSeqs) {
    const call = callsBySeq.get(seq);
    if (call) firstTouchCalls.push(call);
  }
  const secondTouchCalls: BenchmarkToolCallRecordV24[] = [];
  for (const seq of buckets.secondTouchSeqs) {
    const call = callsBySeq.get(seq);
    if (call) secondTouchCalls.push(call);
  }

  const firstTouchDurationMs = firstTouchCalls.length
    ? firstTouchCalls.reduce(
        (acc, c) => acc + (Number.isFinite(c.durationMs) ? c.durationMs : 0),
        0,
      )
    : null;
  const secondTouchDurationMs = secondTouchCalls.length
    ? secondTouchCalls.reduce(
        (acc, c) => acc + (Number.isFinite(c.durationMs) ? c.durationMs : 0),
        0,
      )
    : null;

  const firstTouchTokensSamples = firstTouchCalls
    .map((c) => (typeof c.tokensIn === 'number' ? c.tokensIn : c.inputTokens))
    .filter(isNumber);
  const firstTouchTokensIn = firstTouchTokensSamples.length
    ? firstTouchTokensSamples.reduce((acc, v) => acc + v, 0)
    : null;
  const secondTouchTokensSamples = secondTouchCalls
    .map((c) => (typeof c.tokensIn === 'number' ? c.tokensIn : c.inputTokens))
    .filter(isNumber);
  const secondTouchTokensIn = secondTouchTokensSamples.length
    ? secondTouchTokensSamples.reduce((acc, v) => acc + v, 0)
    : null;

  let secondTouchReplayCount = 0;
  let secondTouchReplaySuccessCount = 0;
  let secondTouchFallbackCount = 0;
  for (const call of secondTouchCalls) {
    const isReplayPath = call.chooserStrategy === 'experience_replay';
    const fellBack = call.fallbackUsed === true || (call.chooserStrategy && !isReplayPath);
    if (isReplayPath) {
      secondTouchReplayCount += 1;
      if (call.status === 'ok') secondTouchReplaySuccessCount += 1;
    }
    if (fellBack) {
      secondTouchFallbackCount += 1;
    }
  }

  const complete =
    buckets.firstTouchSeqs.size > 0 &&
    buckets.secondTouchSeqs.size > 0 &&
    firstTouchDurationMs !== null &&
    secondTouchDurationMs !== null;

  return {
    pairIndex,
    firstTouchDurationMs,
    secondTouchDurationMs,
    firstTouchTokensIn,
    secondTouchTokensIn,
    secondTouchReplayCount,
    secondTouchReplaySuccessCount,
    secondTouchFallbackCount,
    secondTouchTotalCount: secondTouchCalls.length,
    complete,
  };
}

function aggregatePairBuckets(buckets: BenchmarkPairBucket[]): BenchmarkPairAggregateStats {
  const completePairs = buckets.filter((b) => b.complete);
  const incompletePairs = buckets.length - completePairs.length;

  const k5Samples: number[] = [];
  const k6Samples: number[] = [];
  const k7Samples: number[] = [];
  const k8Samples: number[] = [];

  for (const bucket of completePairs) {
    if (
      isNumber(bucket.firstTouchDurationMs) &&
      isNumber(bucket.secondTouchDurationMs) &&
      bucket.secondTouchDurationMs > 0
    ) {
      k5Samples.push(bucket.firstTouchDurationMs / bucket.secondTouchDurationMs);
    }
    if (bucket.secondTouchReplayCount > 0) {
      k6Samples.push(bucket.secondTouchReplaySuccessCount / bucket.secondTouchReplayCount);
    }
    if (bucket.secondTouchTotalCount > 0) {
      k7Samples.push(bucket.secondTouchFallbackCount / bucket.secondTouchTotalCount);
    }
    if (
      isNumber(bucket.firstTouchTokensIn) &&
      isNumber(bucket.secondTouchTokensIn) &&
      bucket.firstTouchTokensIn > 0
    ) {
      // v2.4.0 closeout review fix: K8 is the TOKEN SAVING RATIO,
      // `(first - second) / first`. Higher is better; 1.0 = "second
      // touch spent zero tokens", 0.0 = "second touch spent the same
      // as first touch", negative = "second touch was MORE expensive".
      // This replaces the earlier `second / first` "lower is better"
      // formulation that the closeout review flagged as inverted vs.
      // the documented gate target (`>= 0.40` saving).
      k8Samples.push(
        (bucket.firstTouchTokensIn - bucket.secondTouchTokensIn) / bucket.firstTouchTokensIn,
      );
    }
  }

  return {
    pairCount: completePairs.length,
    incompletePairs,
    k5SecondTouchSpeedupMedian: median(k5Samples),
    k5SecondTouchSpeedupMin: minOrNull(k5Samples),
    k5SecondTouchSpeedupMax: maxOrNull(k5Samples),
    k5SecondTouchSpeedupStddev: stddevOrNull(k5Samples),
    k6ReplaySuccessRateMedian: median(k6Samples),
    k6ReplaySuccessRateMin: minOrNull(k6Samples),
    k6ReplaySuccessRateMax: maxOrNull(k6Samples),
    k6ReplaySuccessRateStddev: stddevOrNull(k6Samples),
    k7ReplayFallbackRateMedian: median(k7Samples),
    k7ReplayFallbackRateMin: minOrNull(k7Samples),
    k7ReplayFallbackRateMax: maxOrNull(k7Samples),
    k7ReplayFallbackRateStddev: stddevOrNull(k7Samples),
    k8TokenSavingRatioMedian: median(k8Samples),
    k8TokenSavingRatioMin: minOrNull(k8Samples),
    k8TokenSavingRatioMax: maxOrNull(k8Samples),
    k8TokenSavingRatioStddev: stddevOrNull(k8Samples),
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

function emptyBlockedByCounters(): BenchmarkReplayBlockedByCounters {
  return {
    capability_off: 0,
    unsupported_step_kind: 0,
    non_portable_args: 0,
    non_github_pageRole: 0,
    below_threshold: 0,
    stale_locator: 0,
    none: 0,
    unknown: 0,
  };
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

function isBlockReason(v: unknown): v is BenchmarkReplayBlockReason {
  return (
    v === 'capability_off' ||
    v === 'unsupported_step_kind' ||
    v === 'non_portable_args' ||
    v === 'non_github_pageRole' ||
    v === 'below_threshold' ||
    v === 'stale_locator' ||
    v === 'none'
  );
}

/**
 * Project a finished real-browser run into a v2.4.0 release-evidence
 * report. Pure function. Re-running with the same input must produce
 * an identical output.
 */
export function summariseBenchmarkRunV24(input: BenchmarkRunInputV24): BenchmarkSummaryV24 {
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

  const tokenSamples = toolCalls
    .map((c) => c.inputTokens)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const tokenSum = tokenSamples.reduce((acc, v) => acc + v, 0);
  const k1MeanInputTokensPerTask =
    totalScenarios > 0 && tokenSamples.length > 0 ? tokenSum / totalScenarios : null;

  const groupedByTool = new Map<string, number[]>();
  for (const call of toolCalls) {
    if (call.status !== 'ok') continue;
    const arr = groupedByTool.get(call.toolName) ?? [];
    if (Number.isFinite(call.durationMs)) arr.push(call.durationMs);
    groupedByTool.set(call.toolName, arr);
  }
  const k2PerToolLatencyMs: BenchmarkPerToolLatency[] = [...groupedByTool.entries()]
    .map(([toolName, durations]) => ({
      toolName,
      sampleCount: durations.length,
      p50Ms: median(durations),
    }))
    .sort((a, b) => a.toolName.localeCompare(b.toolName));

  const k3TaskSuccessRate = scenarioCompletionRate;
  const retried = toolCalls.filter((c) => safeNonNegative(c.retryCount) > 0).length;
  const fallbacks = toolCalls.filter((c) => c.fallbackUsed === true).length;
  const k4ToolRetryRate = ratio(retried, totalToolCalls);
  const k4FallbackRate = ratio(fallbacks, totalToolCalls);

  const readPageProbeCount = toolCalls.filter((c) => c.toolName === 'chrome_read_page').length;
  const laneCounters: BenchmarkLaneCounters = {
    tabrixOwnedCount: toolCalls.filter((c) => c.lane === 'tabrix_owned').length,
    cdpCount: toolCalls.filter((c) => c.lane === 'cdp').length,
    debuggerCount: toolCalls.filter((c) => c.lane === 'debugger').length,
    unknownCount: toolCalls.filter((c) => c.lane === 'unknown').length,
    violationCount: 0,
  };
  laneCounters.violationCount = laneCounters.cdpCount + laneCounters.debuggerCount;

  const clickAttemptSamples = toolCalls
    .filter((c) => c.toolName === 'chrome_click_element')
    .map((c) => c.clickAttempts)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1);
  const meanClickAttemptsPerStep =
    clickAttemptSamples.length > 0
      ? clickAttemptSamples.reduce((acc, v) => acc + v, 0) / clickAttemptSamples.length
      : null;

  const callsBySeq = new Map<number, BenchmarkToolCallRecordV24>();
  for (const call of toolCalls) {
    if (Number.isInteger(call.seq)) callsBySeq.set(call.seq, call);
  }

  const pairBindings = bucketPairBindings(pairs);
  const pairsBlocks: BenchmarkScenarioPairBlock[] = [];
  const allCompleteBuckets: BenchmarkPairBucket[] = [];

  for (const [scenarioId, scenarioMap] of pairBindings.entries()) {
    const buckets: BenchmarkPairBucket[] = [];
    for (const [pairIndex, pairBuckets] of scenarioMap.entries()) {
      const bucket = projectPairBucket(pairIndex, pairBuckets, callsBySeq);
      buckets.push(bucket);
      if (bucket.complete) allCompleteBuckets.push(bucket);
    }
    buckets.sort((a, b) => a.pairIndex - b.pairIndex);
    pairsBlocks.push({
      scenarioId,
      perPair: buckets,
      aggregate: aggregatePairBuckets(buckets),
    });
  }
  pairsBlocks.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

  const allK5: number[] = [];
  const allK6: number[] = [];
  const allK7: number[] = [];
  const allK8: number[] = [];
  for (const bucket of allCompleteBuckets) {
    if (
      isNumber(bucket.firstTouchDurationMs) &&
      isNumber(bucket.secondTouchDurationMs) &&
      bucket.secondTouchDurationMs > 0
    ) {
      allK5.push(bucket.firstTouchDurationMs / bucket.secondTouchDurationMs);
    }
    if (bucket.secondTouchReplayCount > 0) {
      allK6.push(bucket.secondTouchReplaySuccessCount / bucket.secondTouchReplayCount);
    }
    if (bucket.secondTouchTotalCount > 0) {
      allK7.push(bucket.secondTouchFallbackCount / bucket.secondTouchTotalCount);
    }
    if (
      isNumber(bucket.firstTouchTokensIn) &&
      isNumber(bucket.secondTouchTokensIn) &&
      bucket.firstTouchTokensIn > 0
    ) {
      // v2.4.0 closeout review fix: see the matching note in
      // `aggregatePairBuckets` above. K8 = (first - second) / first,
      // higher is better, target ≥ 0.40.
      allK8.push(
        (bucket.firstTouchTokensIn - bucket.secondTouchTokensIn) / bucket.firstTouchTokensIn,
      );
    }
  }

  const replayEligibilityDistribution = emptyEligibilityCounters();
  const replayEligibilityBlockedBy = emptyBlockedByCounters();
  for (const call of toolCalls) {
    if (isChooserStrategy(call.chooserStrategy)) {
      replayEligibilityDistribution[call.chooserStrategy] += 1;
    } else {
      replayEligibilityDistribution.unknown += 1;
    }
    if (isBlockReason(call.chooserBlockedBy)) {
      replayEligibilityBlockedBy[call.chooserBlockedBy] += 1;
    } else if (call.chooserBlockedBy === undefined) {
      replayEligibilityBlockedBy.unknown += 1;
    } else {
      replayEligibilityBlockedBy.unknown += 1;
    }
  }

  return {
    reportVersion: BENCHMARK_REPORT_VERSION,
    runId: input.runId,
    runStartedAt: input.runStartedAt,
    runEndedAt: input.runEndedAt,
    buildSha: input.buildSha,
    totalToolCalls,
    scenarioCompletionRate,
    totalScenarios,
    completedScenarios,
    kpiScenarioIds,
    k1MeanInputTokensPerTask,
    k2PerToolLatencyMs,
    k3TaskSuccessRate,
    k4ToolRetryRate,
    k4FallbackRate,
    readPageProbeCount,
    laneCounters,
    meanClickAttemptsPerStep,
    pairs: pairsBlocks,
    k5SecondTouchSpeedup: median(allK5),
    k6ReplaySuccessRate: median(allK6),
    k7ReplayFallbackRate: median(allK7),
    k8TokenSavingRatio: median(allK8),
    replayEligibilityDistribution,
    replayEligibilityBlockedBy,
  };
}

// NOTE: `evaluateBenchmarkGateV24` lives in
// `scripts/lib/v24-benchmark-gate.cjs` (CommonJS). Same rationale as
// the v23 split — the gate must be loadable by both Jest tests
// (`require()`) and the ESM scripts (`scripts/benchmark-v24.mjs`,
// `scripts/check-release-readiness.mjs`) without depending on the
// native-server `dist/` build artifact. A Jest test in
// `v24-benchmark.test.ts` asserts that
// `BENCHMARK_REPORT_VERSION_EXPECTED` over there matches
// `BENCHMARK_REPORT_VERSION` here, so the report shape and the gate
// cannot drift silently.
