/**
 * Tabrix v2.3.0 benchmark transformer (V23-06).
 *
 * Pure data transformer. No IO, no DOM, no network. Takes a list of
 * structured tool-call records (the kind a real-browser acceptance run
 * emits as NDJSON) and produces a deterministic v2.3.0 release-evidence
 * report covering K1–K4 plus the v2.3.0-specific safety counters
 * (probe count, lane-integrity violations, click attempts per step,
 * task completion).
 *
 * Why a transformer rather than a runner: the actual GitHub baseline
 * runs require a real Chrome session (`AGENTS.md` rule 14 + V23-02 §3).
 * That step is maintainer-only and intentionally not invoked from this
 * file. The maintainer's loop is:
 *
 *   1. Run the real-browser scenarios listed in
 *      `docs/RELEASE_NOTES_v2.3.0.md` §"Maintainer command list".
 *   2. The runner appends one `BenchmarkToolCallRecord`-shaped JSON line
 *      per tool invocation to `~/.chrome-mcp-agent/benchmarks/v23/<run>.ndjson`.
 *   3. `pnpm run benchmark:v23 -- --input <file>` calls
 *      `summariseBenchmarkRun(records)` and writes the report.
 *
 * This file owns step (3); steps (1) and (2) are owned by the
 * maintainer and the private `tabrix-private-tests` repo respectively.
 *
 * Schema invariants (do NOT break without bumping `BENCHMARK_REPORT_VERSION`):
 *  - Every K-metric is either a finite number or `null` (not `undefined`,
 *    not `NaN`). `null` means "no qualifying samples in this run".
 *  - Counter fields are integers ≥ 0.
 *  - Per-tool latency uses p50 not mean (matches PRD §K2 method column).
 *  - Lane-integrity violations are a hard release blocker — the gate in
 *    `scripts/check-release-readiness.mjs` refuses to ship if any are
 *    present.
 */

/** Bumped only when the report shape changes in a way release-check must learn about. */
export const BENCHMARK_REPORT_VERSION = 1 as const;

/**
 * Closed enum of tool-call statuses the v2.3.0 benchmark cares about.
 * Mirrors the existing `memory_steps.status` shape so the runner does
 * not need a translation layer.
 */
export type BenchmarkToolCallStatus = 'ok' | 'failed' | 'aborted';

/**
 * Lane integrity is a v2.3.0 V23-01 invariant: Tabrix-owned tools must
 * not silently fall through to a CDP / debugger lane.
 *  - `tabrix_owned`: the call ran on the explicit Tabrix-owned lane (good).
 *  - `cdp` / `debugger`: the call landed on a fallback lane, which is a
 *    governance violation and counted as such.
 *  - `unknown`: the runner didn't tag the call. Counted as "unknown" but
 *    NOT as a violation — we don't fail-close on missing data, we
 *    surface it as a `lanesUnknownCount` so the maintainer can decide.
 */
export type BenchmarkLane = 'tabrix_owned' | 'cdp' | 'debugger' | 'unknown';

export interface BenchmarkToolCallRecord {
  /**
   * Stable per-run sequence number (0-based). Lets the report reproduce
   * deterministic order even if the runner shuffles records.
   */
  seq: number;

  /** Logical scenario this call belongs to (e.g. `T5-G-GH-REPO-NAV-ISSUES`). */
  scenarioId: string;

  /** The MCP tool name — `chrome_click_element`, `chrome_read_page`, etc. */
  toolName: string;

  status: BenchmarkToolCallStatus;

  /** Wall-clock duration of the tool call in milliseconds. */
  durationMs: number;

  /**
   * Upstream MCP-side input tokens attributed to this call. The runner
   * is responsible for the attribution model. `null` is allowed and
   * means "the runner could not measure this call" — those records
   * are excluded from K1 averaging instead of being treated as 0.
   */
  inputTokens: number | null;

  /**
   * 0-indexed retry count. `0` means the call succeeded on first attempt.
   * Used for K4. Negative values are treated as 0.
   */
  retryCount: number;

  /** Whether this call ran a fallback path (different code path, not a retry of the same path). */
  fallbackUsed: boolean;

  lane: BenchmarkLane;

  /**
   * For `chrome_click_element` only: total click dispatches the runner
   * issued for the same logical step (e.g. retry-on-stale + verifier
   * re-fire). Other tools should leave this `null`. Used to compute
   * `meanClickAttemptsPerStep`.
   */
  clickAttempts?: number | null;
}

export interface BenchmarkScenarioRecord {
  scenarioId: string;
  /** Whether the scenario as a whole completed (independent of step-by-step outcomes). */
  completed: boolean;
}

export interface BenchmarkRunInput {
  /** Real-browser session-tracker run identifier (opaque). */
  runId: string;
  /** ISO-8601 timestamp of when the runner started. */
  runStartedAt: string;
  /** ISO-8601 timestamp of when the runner finished. */
  runEndedAt: string;
  /** Build the runner exercised. Echoed verbatim into the report header. */
  buildSha: string;
  /** Tool-call records (one per MCP tool dispatch). */
  toolCalls: BenchmarkToolCallRecord[];
  /** Scenario-level outcomes. */
  scenarios: BenchmarkScenarioRecord[];
}

export interface BenchmarkPerToolLatency {
  toolName: string;
  /** Number of `ok` calls included in the p50. */
  sampleCount: number;
  /** p50 (median) wall-clock duration in milliseconds. `null` when sampleCount=0. */
  p50Ms: number | null;
}

export interface BenchmarkLaneCounters {
  tabrixOwnedCount: number;
  cdpCount: number;
  debuggerCount: number;
  unknownCount: number;
  /** Hard release blocker if non-zero. `cdpCount + debuggerCount`. */
  violationCount: number;
}

export interface BenchmarkSummary {
  reportVersion: typeof BENCHMARK_REPORT_VERSION;
  runId: string;
  runStartedAt: string;
  runEndedAt: string;
  buildSha: string;

  /** Total tool calls in the run. Independent of status. */
  totalToolCalls: number;
  /** Scenario-level completion ratio: completed / total. `null` when no scenarios. */
  scenarioCompletionRate: number | null;
  totalScenarios: number;
  completedScenarios: number;

  /** K1 — average input tokens per task. `null` when no scenarios with measurable tokens. */
  k1MeanInputTokensPerTask: number | null;

  /**
   * K2 — per-tool p50 latency. Only `ok` calls contribute. Sorted by
   * `toolName` ascending so the report file diff is stable.
   */
  k2PerToolLatencyMs: BenchmarkPerToolLatency[];

  /** K3 — multi-step task success rate. Equal to `scenarioCompletionRate` for v1 — kept separate so the schema can diverge later without renaming. */
  k3TaskSuccessRate: number | null;

  /** K4a — fraction of tool calls with `retryCount > 0`. */
  k4ToolRetryRate: number | null;
  /** K4b — fraction of tool calls with `fallbackUsed=true`. */
  k4FallbackRate: number | null;

  /**
   * v2.3.0-specific counter: total number of `chrome_read_page` calls
   * (probe). The release gate uses this to confirm V23-01's
   * "low-value probe reduction" landed in the wild — a regression here
   * is a soft warning, not a hard fail.
   */
  readPageProbeCount: number;

  /** v2.3.0-specific lane-integrity counters. `violationCount > 0` is a hard release blocker. */
  laneCounters: BenchmarkLaneCounters;

  /**
   * v2.3.0-specific: mean click attempts per logical step. `null` when
   * the runner did not tag any click record with `clickAttempts`. A
   * value > 1 indicates click-verifier flakiness (B-024 / V23-01).
   */
  meanClickAttemptsPerStep: number | null;
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

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function safeNonNegative(value: number): number {
  return value < 0 || !Number.isFinite(value) ? 0 : value;
}

/**
 * Project a finished real-browser run into a v2.3.0 release-evidence
 * report. Pure function. Re-running with the same input must produce
 * an identical output (the `JSON.stringify` of this is what release-check
 * diffs against).
 */
export function summariseBenchmarkRun(input: BenchmarkRunInput): BenchmarkSummary {
  const toolCalls = input.toolCalls ?? [];
  const scenarios = input.scenarios ?? [];

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
    k1MeanInputTokensPerTask,
    k2PerToolLatencyMs,
    k3TaskSuccessRate,
    k4ToolRetryRate,
    k4FallbackRate,
    readPageProbeCount,
    laneCounters,
    meanClickAttemptsPerStep,
  };
}

/**
 * Hard release-gate predicate. Returns the list of reasons the report
 * is not ship-grade for v2.3.0; an empty array means "ship-grade".
 *
 * Used by `scripts/check-release-readiness.mjs` for v2.3.0+ tags.
 *
 * v1 thresholds are intentionally minimum-viable. The maintainer can
 * tighten them in a follow-up; loosening them requires a documented
 * decision (the comment in `release-check` calls this out).
 */
export interface BenchmarkGateThresholds {
  /** Maximum allowed tool retry rate (K4a). Default 0.10 per PRD §K4. */
  maxToolRetryRate: number;
  /** Minimum scenario completion rate (K3). Default 0.85 per PRD §K3. */
  minScenarioCompletionRate: number;
}

export const DEFAULT_BENCHMARK_GATE_THRESHOLDS: BenchmarkGateThresholds = {
  maxToolRetryRate: 0.1,
  minScenarioCompletionRate: 0.85,
};

export function evaluateBenchmarkGate(
  summary: BenchmarkSummary,
  thresholds: BenchmarkGateThresholds = DEFAULT_BENCHMARK_GATE_THRESHOLDS,
): string[] {
  const reasons: string[] = [];

  if (summary.reportVersion !== BENCHMARK_REPORT_VERSION) {
    reasons.push(
      `report version mismatch: expected ${BENCHMARK_REPORT_VERSION}, got ${summary.reportVersion}`,
    );
  }

  if (summary.totalScenarios === 0) {
    reasons.push('no scenarios in run — release evidence is empty');
  }

  if (summary.laneCounters.violationCount > 0) {
    reasons.push(
      `lane-integrity violations present: cdp=${summary.laneCounters.cdpCount}, debugger=${summary.laneCounters.debuggerCount}`,
    );
  }

  if (
    summary.k3TaskSuccessRate !== null &&
    summary.k3TaskSuccessRate < thresholds.minScenarioCompletionRate
  ) {
    reasons.push(
      `K3 task success rate ${summary.k3TaskSuccessRate.toFixed(3)} below threshold ${thresholds.minScenarioCompletionRate}`,
    );
  }

  if (summary.k4ToolRetryRate !== null && summary.k4ToolRetryRate > thresholds.maxToolRetryRate) {
    reasons.push(
      `K4 tool retry rate ${summary.k4ToolRetryRate.toFixed(3)} above threshold ${thresholds.maxToolRetryRate}`,
    );
  }

  return reasons;
}
