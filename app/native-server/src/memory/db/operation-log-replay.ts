/**
 * V26-PGB-05 — read-only operation-log replay helper.
 *
 * Goal: a downstream tool (test fixture, CLI, dashboard) can pass a
 * `taskSessionId` (the value the caller stored as
 * `operation_memory_logs.session_id`) and get back a closed-shape
 * per-step summary that explains *why* every step took the path it
 * did. This is the public companion to V26-FIX-07 ("metadata block
 * proves the write was structured") — FIX-07 made the data
 * available; PGB-05 makes it actually readable for replay/post-mortem
 * without re-deriving anything from raw column strings.
 *
 * Privacy boundary (unchanged):
 * - The helper is read-only. It MUST NOT mutate the repository or
 *   write into Experience.
 * - It reads only the closed-vocabulary fields that V26-FIX-07
 *   guarantees are pre-summarised; it does not surface any raw HTTP
 *   body, cookie, Authorization header, or full URL.
 *
 * Failure isolation:
 * - The helper takes a *minimal structural reader interface* —
 *   `OperationLogReplayReader` — so the caller can pass any object
 *   that exposes `listBySession`. The session-manager already
 *   isolates write failures behind a try/catch (`recordOperationLog`)
 *   so a transient DB hiccup never blocks the main MCP call. The
 *   replay helper is read-only; if the caller's reader throws, the
 *   caller (CLI / test) handles it — the production read shim does
 *   not depend on this helper.
 */

import type { OperationMemoryLog } from './operation-memory-log-repository';
import { NOT_APPLICABLE, type OperationLogMetadata } from './operation-log-metadata';

/**
 * Closed-enum classification of a single step's effective route.
 * Derived from the persisted `selectedDataSource` / `resultKind` /
 * `metadata.emptyResult` triple so a downstream replay UI does not
 * have to re-derive it from raw column strings.
 *
 * Values:
 * - `'api_success'`        — `selectedDataSource='api_rows'` and
 *                            metadata.emptyResult `!== 'true'`.
 * - `'api_empty'`          — `selectedDataSource='api_rows'` and
 *                            metadata.emptyResult `=== 'true'`.
 * - `'api_fallback'`       — the chooser proposed an API path but the
 *                            shim had to fall back to DOM
 *                            (`resultKind='read_page_fallback'` or
 *                            `selectedDataSource='dom_json'` paired
 *                            with a non-`not_applicable` decisionReason).
 * - `'read_page_skipped'`  — `resultKind='read_page_skipped'` (the
 *                            chooser short-circuited the read entirely
 *                            via experience replay or knowledge).
 * - `'read_page_warning'`  — `resultKind='read_page_warning'` (the
 *                            shim refused the read for budget reasons).
 * - `'read_page'`          — plain DOM read with no explicit fallback
 *                            evidence — i.e. the legacy bridge path.
 * - `'tool_call'`          — anything else (chrome_navigate,
 *                            chrome_network_capture, …). The helper
 *                            does NOT try to invent a closed enum for
 *                            arbitrary native tools; it just labels
 *                            them as `'tool_call'`.
 */
export type OperationLogReplayRouteOutcome =
  | 'api_success'
  | 'api_empty'
  | 'api_failure'
  | 'api_fallback'
  | 'read_page_skipped'
  | 'read_page_warning'
  | 'read_page'
  | 'tool_call';

export type OperationLogReplayCoverage = 'explained' | 'partial' | 'legacy_default';

export interface OperationLogReplayEvidence {
  executionMode: string | null;
  readerMode: string | null;
  endpointSource: string | null;
  lookupChosenReason: string | null;
  correlationConfidence: string | null;
  retiredEndpointSource: string | null;
  semanticValidation: string | null;
  layerContractReason: string | null;
  fallbackEntryLayer: string | null;
  apiFinalReason: string | null;
  privacyCheck: string | null;
  relevanceCheck: string | null;
}

/**
 * Closed-shape per-step replay record. Every field is the
 * pre-summarised, redacted form of the underlying column /
 * metadata field — there is no raw API response, no raw DOM, and no
 * URL with a query string here.
 */
export interface OperationLogReplayStep {
  ordinal: number;
  stepId: string;
  toolName: string;
  selectedDataSource: string | null;
  sourceRoute: string | null;
  decisionReason: string | null;
  /**
   * V26-PGB-05 — closed-vocab cause for the fallback. Pulled from
   * `metadata.fallbackPlan` when explicit; otherwise derived from
   * the `fallbackUsed` column. `null` when the step did not fall
   * back. Surfaced separately from `decisionReason` so a replay
   * reader can answer "why did this step deviate from the chooser's
   * plan?" without re-deriving it.
   */
  fallbackCause: string | null;
  /**
   * V26-PGB-05 — closed-vocab outcome marker. `null` when the step
   * was not an API read (DOM read, navigate, capture, …). Mirrors
   * the V26-PGB-01 closed marker.
   */
  emptyResult: 'true' | 'false' | null;
  durationMs: number | null;
  success: boolean;
  routeOutcome: OperationLogReplayRouteOutcome;
  evidence: OperationLogReplayEvidence;
  coverage: OperationLogReplayCoverage;
}

/** Closed structural summary of one operation chain. */
export interface OperationLogReplaySummary {
  sessionId: string;
  stepCount: number;
  /** Total wall-clock duration across all steps with a non-null durationMs. */
  totalDurationMs: number;
  /** Closed-vocab counts so a replay UI can show stats at a glance. */
  routeOutcomeDistribution: Record<OperationLogReplayRouteOutcome, number>;
  coverage: {
    explainedSteps: number;
    partialSteps: number;
    legacyDefaultSteps: number;
    failureSteps: number;
  };
  steps: OperationLogReplayStep[];
}

/**
 * Minimal structural reader contract. Any object that exposes
 * `listBySession` (the {@link OperationMemoryLogRepository} signature)
 * satisfies it; the helper does NOT depend on the concrete
 * repository class so a test fixture can hand-roll an in-memory
 * reader.
 */
export interface OperationLogReplayReader {
  listBySession(sessionId: string): OperationMemoryLog[];
}

function classifyRoute(log: OperationMemoryLog): OperationLogReplayRouteOutcome {
  const dataSource = log.selectedDataSource ?? null;
  const resultKind = log.resultKind ?? null;
  const emptyResult = pickEmptyResult(log.metadata);
  if (!log.success && (dataSource === 'api_rows' || resultKind === 'api_rows')) {
    return 'api_failure';
  }
  if (dataSource === 'api_rows') {
    return emptyResult === 'true' ? 'api_empty' : 'api_success';
  }
  if (resultKind === 'read_page_fallback') return 'api_fallback';
  if (resultKind === 'read_page_skipped') return 'read_page_skipped';
  if (resultKind === 'read_page_warning') return 'read_page_warning';
  if (resultKind === 'read_page' || dataSource === 'dom_json') return 'read_page';
  return 'tool_call';
}

function pickEmptyResult(metadata: OperationLogMetadata): 'true' | 'false' | null {
  const value = metadata.emptyResult;
  if (value === 'true' || value === 'false') return value;
  return null;
}

function pickFallbackCause(log: OperationMemoryLog): string | null {
  const metadataFallback =
    log.metadata.fallbackPlan && log.metadata.fallbackPlan !== NOT_APPLICABLE
      ? log.metadata.fallbackPlan
      : null;
  if (metadataFallback && metadataFallback !== 'none') return metadataFallback;
  const columnFallback = log.fallbackUsed ?? null;
  if (columnFallback && columnFallback !== 'none') return columnFallback;
  return null;
}

function pickMetadataValue(value: string): string | null {
  return value && value !== NOT_APPLICABLE ? value : null;
}

function buildEvidence(metadata: OperationLogMetadata): OperationLogReplayEvidence {
  return {
    executionMode: pickMetadataValue(metadata.executionMode),
    readerMode: pickMetadataValue(metadata.readerMode),
    endpointSource: pickMetadataValue(metadata.endpointSource),
    lookupChosenReason: pickMetadataValue(metadata.lookupChosenReason),
    correlationConfidence: pickMetadataValue(metadata.correlationConfidence),
    retiredEndpointSource: pickMetadataValue(metadata.retiredEndpointSource),
    semanticValidation: pickMetadataValue(metadata.semanticValidation),
    layerContractReason: pickMetadataValue(metadata.layerContractReason),
    fallbackEntryLayer: pickMetadataValue(metadata.fallbackEntryLayer),
    apiFinalReason: pickMetadataValue(metadata.apiFinalReason),
    privacyCheck: pickMetadataValue(metadata.privacyCheck),
    relevanceCheck: pickMetadataValue(metadata.relevanceCheck),
  };
}

function classifyCoverage(
  log: OperationMemoryLog,
  evidence: OperationLogReplayEvidence,
  fallbackCause: string | null,
): OperationLogReplayCoverage {
  const evidenceValues = Object.values(evidence).filter((value) => value !== null);
  if (
    evidenceValues.length === 0 &&
    !log.sourceRoute &&
    !log.decisionReason &&
    !log.resultKind &&
    !fallbackCause
  ) {
    return 'legacy_default';
  }
  const hasDecision = Boolean(log.sourceRoute || log.decisionReason || evidence.executionMode);
  const hasSource = Boolean(
    log.selectedDataSource || evidence.endpointSource || evidence.readerMode,
  );
  const hasFailureReason = log.success || Boolean(fallbackCause || evidence.apiFinalReason);
  return hasDecision && hasSource && hasFailureReason ? 'explained' : 'partial';
}

/**
 * Build a closed-shape replay summary for a single session. Returns
 * an empty summary (`stepCount=0`, every distribution bucket at 0)
 * when the reader has no rows for `sessionId`. Never throws on
 * malformed metadata — the reader contract guarantees a fully-formed
 * `OperationLogMetadata` thanks to V26-FIX-07's wrapper.
 */
export function summariseOperationChain(
  reader: OperationLogReplayReader,
  sessionId: string,
): OperationLogReplaySummary {
  const logs = reader.listBySession(sessionId);
  const steps: OperationLogReplayStep[] = logs.map((log, index) => {
    const evidence = buildEvidence(log.metadata);
    const fallbackCause = pickFallbackCause(log);
    return {
      ordinal: index + 1,
      stepId: log.stepId,
      toolName: log.toolName,
      selectedDataSource: log.selectedDataSource ?? null,
      sourceRoute: log.sourceRoute ?? null,
      decisionReason: log.decisionReason ?? null,
      fallbackCause,
      emptyResult: pickEmptyResult(log.metadata),
      durationMs: log.durationMs ?? null,
      success: log.success,
      routeOutcome: classifyRoute(log),
      evidence,
      coverage: classifyCoverage(log, evidence, fallbackCause),
    };
  });
  const routeOutcomeDistribution: Record<OperationLogReplayRouteOutcome, number> = {
    api_success: 0,
    api_empty: 0,
    api_failure: 0,
    api_fallback: 0,
    read_page_skipped: 0,
    read_page_warning: 0,
    read_page: 0,
    tool_call: 0,
  };
  const coverage = {
    explainedSteps: 0,
    partialSteps: 0,
    legacyDefaultSteps: 0,
    failureSteps: 0,
  };
  let totalDurationMs = 0;
  for (const step of steps) {
    routeOutcomeDistribution[step.routeOutcome] += 1;
    if (step.coverage === 'explained') coverage.explainedSteps += 1;
    if (step.coverage === 'partial') coverage.partialSteps += 1;
    if (step.coverage === 'legacy_default') coverage.legacyDefaultSteps += 1;
    if (!step.success) coverage.failureSteps += 1;
    if (typeof step.durationMs === 'number' && Number.isFinite(step.durationMs)) {
      totalDurationMs += Math.max(0, step.durationMs);
    }
  }
  return {
    sessionId,
    stepCount: steps.length,
    totalDurationMs,
    routeOutcomeDistribution,
    coverage,
    steps,
  };
}

/**
 * Render a summary as a short, multi-line text block suitable for
 * CLI output / Gate B replay artefacts. Closed-vocab fields only —
 * no raw URLs, no raw bodies. Useful for a maintainer-private
 * replay-summary CLI to dump alongside the NDJSON evidence.
 */
export function renderOperationChainSummary(summary: OperationLogReplaySummary): string {
  const lines: string[] = [
    `# operation chain (sessionId=${summary.sessionId})`,
    `- stepCount: ${summary.stepCount}`,
    `- totalDurationMs: ${summary.totalDurationMs}`,
    `- routeOutcomeDistribution: ${JSON.stringify(summary.routeOutcomeDistribution)}`,
    `- coverage: ${JSON.stringify(summary.coverage)}`,
    '',
    '| ord | tool | dataSource | route | reason | fallback | empty | ms | ok | outcome | coverage |',
    '|---:|---|---|---|---|---|---:|---:|---:|---|---|',
  ];
  for (const step of summary.steps) {
    lines.push(
      [
        step.ordinal,
        step.toolName,
        step.selectedDataSource ?? '-',
        step.sourceRoute ?? '-',
        step.decisionReason ?? '-',
        step.fallbackCause ?? '-',
        step.emptyResult ?? '-',
        step.durationMs ?? '-',
        step.success ? 'true' : 'false',
        step.routeOutcome,
        step.coverage,
      ]
        .map((value) => String(value))
        .join(' | '),
    );
  }
  return lines.join('\n');
}
