/**
 * V23-04 / B-018 v1.5 — `tabrix_choose_context` telemetry repository.
 *
 * Single-purpose append-only writer for two SQLite tables:
 *
 *   - `tabrix_choose_context_decisions` — one row per chooser invocation
 *     that returned `status='ok'`. Captures the resolved bucket
 *     (`intent_signature` / `pageRole` / `siteFamily`) plus the chosen
 *     `strategy` and `fallback_strategy`. Backs the
 *     `release:choose-context-stats` script and lets us answer "which
 *     strategy did the chooser pick last week?" without replaying.
 *
 *   - `tabrix_choose_context_outcomes` — one row per
 *     `tabrix_choose_context_record_outcome` MCP call. Pure write-back.
 *     `decision_id` is a FK back to the decisions table so the
 *     aggregation script can compute reuse / fallback ratios per
 *     strategy.
 *
 * No reads from upstream tools. Outcome recording is the *only* way a
 * row leaves this module's process boundary, and it is gated by the
 * `tabrix_choose_context_record_outcome` tool risk tier (P0,
 * pure-INSERT). The DDL itself lives in
 * `app/native-server/src/memory/db/schema.ts` so all Memory tables
 * stay in one place.
 *
 * Privacy: we never store the raw `intent` string. `intent_signature`
 * is the same B-013 normalized form that already drives experience
 * lookups (lower-cased, redacted). `page_role` is structural,
 * `site_family` is the closed B-018 enum.
 */

import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from '../db/client';
import type {
  ContextStrategyName,
  ExecutionRecentDecisionSummary,
  ExecutionReliabilitySignalSummary,
  ExecutionSavingsSummary,
  ExecutionTopActionPathSummary,
  LayerDispatchReason,
  LayerSourceRoute,
  ReadPageRequestedLayer,
  ReplayEligibilityBlockReason,
  TabrixChooseContextOutcome,
} from '@tabrix/shared';

export interface RecordChooseContextDecisionInput {
  /** Pre-generated decision id. Caller owns it so it can echo the same id back to the MCP caller without an extra round-trip. */
  decisionId: string;
  intentSignature: string;
  pageRole: string | null;
  siteFamily: string | null;
  strategy: ContextStrategyName;
  fallbackStrategy: ContextStrategyName | null;
  /** ISO timestamp. Caller-supplied so tests stay deterministic. */
  createdAt: string;
  // ---------------------------------------------------------------
  // V25-02 layer-dispatch telemetry. All optional so callers that
  // pre-date V25-02 (and ad-hoc tests) keep working unchanged.
  // ---------------------------------------------------------------
  /** Selected layer envelope. Mirrors `read_page.requestedLayer`. */
  chosenLayer?: ReadPageRequestedLayer | null;
  /** Closed reason key from the V25-02 Strategy Table. */
  layerDispatchReason?: LayerDispatchReason | null;
  /** Locked 4-value source route. */
  sourceRoute?: LayerSourceRoute | null;
  /** Free-text reason recorded only on the dispatcher fail-safe path. */
  fallbackCause?: string | null;
  /** ceil(byteLength/4) for the chosen layer envelope. */
  tokenEstimateChosen?: number | null;
  /** ceil(byteLength/4) for the full L0+L1+L2 read. */
  tokenEstimateFullRead?: number | null;
  /** `tokenEstimateFullRead - tokenEstimateChosen`, never negative. */
  tokensSavedEstimate?: number | null;
  /** Telemetry-only knowledge family hint. MUST NOT drive routing. */
  knowledgeEndpointFamily?: string | null;
  // ---------------------------------------------------------------
  // V24-03 ranked-replay audit fields persisted in V25-02 (M2 binding).
  // ---------------------------------------------------------------
  rankedCandidateCount?: number | null;
  replayEligibleBlockedBy?: ReplayEligibilityBlockReason | null;
  replayFallbackDepth?: number | 'cold' | null;
  // ---------------------------------------------------------------
  // V26-04 (B-027) honest dispatcher inputs. Both optional — callers
  // that pre-date V26-04 (and tests) keep working unchanged. The
  // `dispatcher_input_source` column is closed-enum at the SQL
  // boundary too, but the writer accepts a free string so it does
  // not have to import `DispatcherInputSource` from the chooser
  // module (avoids a circular dep).
  // ---------------------------------------------------------------
  dispatcherInputSource?: string | null;
  fallbackCauseV26?: string | null;
}

export interface RecordChooseContextOutcomeInput {
  decisionId: string;
  outcome: TabrixChooseContextOutcome;
  /** ISO timestamp. Caller-supplied so tests stay deterministic. */
  recordedAt: string;
}

export type RecordChooseContextOutcomeResult =
  | { status: 'ok'; outcomeId: string }
  | { status: 'unknown_decision' };

export interface ChooseContextDecisionRow {
  decisionId: string;
  intentSignature: string;
  pageRole: string | null;
  siteFamily: string | null;
  strategy: ContextStrategyName;
  fallbackStrategy: ContextStrategyName | null;
  createdAt: string;
}

export interface ChooseContextStrategyAggregateRow {
  strategy: ContextStrategyName;
  decisions: number;
  /**
   * Outcome counts. A single decision can in principle have multiple
   * outcome rows (e.g. retried then completed). The aggregation
   * intentionally counts every recorded outcome separately so the
   * release report can spot "decisions we kept retrying" without us
   * inventing a closed-state machine on top.
   */
  outcomes: Record<TabrixChooseContextOutcome, number>;
}

interface DecisionDbRow {
  decision_id: string;
  intent_signature: string;
  page_role: string | null;
  site_family: string | null;
  strategy: string;
  fallback_strategy: string | null;
  created_at: string;
}

interface OutcomeAggRow {
  strategy: string;
  outcome: TabrixChooseContextOutcome | null;
  n: number;
}

interface DecisionCountRow {
  strategy: string;
  n: number;
}

function rowToDecision(row: DecisionDbRow): ChooseContextDecisionRow {
  return {
    decisionId: row.decision_id,
    intentSignature: row.intent_signature,
    pageRole: row.page_role,
    siteFamily: row.site_family,
    strategy: row.strategy as ContextStrategyName,
    fallbackStrategy: (row.fallback_strategy ?? null) as ContextStrategyName | null,
    createdAt: row.created_at,
  };
}

export class ChooseContextTelemetryRepository {
  constructor(private readonly db: SqliteDatabase) {}

  /**
   * Append a decision row. Pure-INSERT; no upserts, no re-keying.
   * Throws on PK collision so we never silently drop a decision id.
   */
  recordDecision(input: RecordChooseContextDecisionInput): void {
    const blockedByValue = input.replayEligibleBlockedBy ?? null;
    const fallbackDepthValue =
      input.replayFallbackDepth === undefined || input.replayFallbackDepth === null
        ? null
        : input.replayFallbackDepth === 'cold'
          ? -1 // sentinel for "no candidates surfaced"; chosen so positive depths stay 1:1 with V24-05 K7
          : input.replayFallbackDepth;
    this.db
      .prepare(
        `INSERT INTO tabrix_choose_context_decisions (
           decision_id, intent_signature, page_role, site_family,
           strategy, fallback_strategy, created_at,
           chosen_layer, layer_dispatch_reason, source_route, fallback_cause,
           token_estimate_chosen, token_estimate_full_read, tokens_saved_estimate,
           knowledge_endpoint_family,
           ranked_candidate_count, replay_eligible_blocked_by, replay_fallback_depth,
           dispatcher_input_source, fallback_cause_v26
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.decisionId,
        input.intentSignature,
        input.pageRole,
        input.siteFamily,
        input.strategy,
        input.fallbackStrategy,
        input.createdAt,
        input.chosenLayer ?? null,
        input.layerDispatchReason ?? null,
        input.sourceRoute ?? null,
        input.fallbackCause ?? null,
        input.tokenEstimateChosen ?? null,
        input.tokenEstimateFullRead ?? null,
        input.tokensSavedEstimate ?? null,
        input.knowledgeEndpointFamily ?? null,
        input.rankedCandidateCount ?? null,
        blockedByValue,
        fallbackDepthValue,
        input.dispatcherInputSource ?? null,
        input.fallbackCauseV26 ?? null,
      );
  }

  /**
   * Append an outcome row. Returns `{ status: 'unknown_decision' }`
   * when the `decisionId` does not exist so the MCP layer can
   * distinguish "decision id we forgot about" from "permission denied".
   */
  recordOutcome(input: RecordChooseContextOutcomeInput): RecordChooseContextOutcomeResult {
    // We use a dedicated SELECT rather than relying on the FK
    // constraint to fire because better-sqlite3 surfaces FK errors as
    // generic SqliteError, which we would have to string-match. An
    // explicit existence probe is one extra cheap query and gives the
    // caller a clean structural status code.
    const exists = this.db
      .prepare(`SELECT 1 AS x FROM tabrix_choose_context_decisions WHERE decision_id = ?`)
      .get(input.decisionId) as { x: number } | undefined;
    if (!exists) {
      return { status: 'unknown_decision' };
    }

    const outcomeId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO tabrix_choose_context_outcomes (
           outcome_id, decision_id, outcome, recorded_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(outcomeId, input.decisionId, input.outcome, input.recordedAt);
    return { status: 'ok', outcomeId };
  }

  findDecision(decisionId: string): ChooseContextDecisionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM tabrix_choose_context_decisions WHERE decision_id = ?`)
      .get(decisionId) as DecisionDbRow | undefined;
    return row ? rowToDecision(row) : null;
  }

  /**
   * Aggregation feeding `pnpm run release:choose-context-stats`.
   * Optional `since` filter (ISO string) clips the strategy
   * distribution to a recent window; aggregation always groups by
   * `strategy` so ratios are stable across small windows.
   */
  aggregateStrategies(since?: string): ChooseContextStrategyAggregateRow[] {
    const decisionsSql = since
      ? `SELECT strategy, COUNT(*) AS n
           FROM tabrix_choose_context_decisions
          WHERE created_at >= ?
          GROUP BY strategy`
      : `SELECT strategy, COUNT(*) AS n
           FROM tabrix_choose_context_decisions
          GROUP BY strategy`;
    const decisionRows = (
      since ? this.db.prepare(decisionsSql).all(since) : this.db.prepare(decisionsSql).all()
    ) as DecisionCountRow[];

    const outcomesSql = since
      ? `SELECT d.strategy AS strategy, o.outcome AS outcome, COUNT(*) AS n
           FROM tabrix_choose_context_outcomes o
           JOIN tabrix_choose_context_decisions d ON d.decision_id = o.decision_id
          WHERE d.created_at >= ?
          GROUP BY d.strategy, o.outcome`
      : `SELECT d.strategy AS strategy, o.outcome AS outcome, COUNT(*) AS n
           FROM tabrix_choose_context_outcomes o
           JOIN tabrix_choose_context_decisions d ON d.decision_id = o.decision_id
          GROUP BY d.strategy, o.outcome`;
    const outcomeRows = (
      since ? this.db.prepare(outcomesSql).all(since) : this.db.prepare(outcomesSql).all()
    ) as OutcomeAggRow[];

    const acc = new Map<string, ChooseContextStrategyAggregateRow>();
    const empty = (): ChooseContextStrategyAggregateRow['outcomes'] => ({
      reuse: 0,
      fallback: 0,
      completed: 0,
      retried: 0,
    });
    for (const row of decisionRows) {
      acc.set(row.strategy, {
        strategy: row.strategy as ContextStrategyName,
        decisions: row.n,
        outcomes: empty(),
      });
    }
    for (const row of outcomeRows) {
      const slot = acc.get(row.strategy) ?? {
        strategy: row.strategy as ContextStrategyName,
        decisions: 0,
        outcomes: empty(),
      };
      if (row.outcome) slot.outcomes[row.outcome] = row.n;
      acc.set(row.strategy, slot);
    }
    return Array.from(acc.values()).sort((a, b) => b.decisions - a.decisions);
  }

  /** Test convenience. Removes all decision and outcome rows. */
  clear(): void {
    this.db.exec(
      `DELETE FROM tabrix_choose_context_outcomes; DELETE FROM tabrix_choose_context_decisions;`,
    );
  }

  // ============================================================
  // V25-03 — Sidepanel "Execution" tab read helpers.
  //
  // All methods below return UI-shaped DTOs that the
  // `/execution/**` HTTP routes echo verbatim. They are pure reads
  // off the existing `tabrix_choose_context_decisions` and
  // `tabrix_choose_context_outcomes` tables — no joins to
  // `memory_sessions`, no pulls from `memory_steps.tool_input`,
  // and no exposure of raw `intent` text. The intent_signature is
  // already structurally normalized (B-013) before persistence so
  // it is safe to expose as a UI chip.
  // ============================================================

  /**
   * Most recent decisions, newest first. The returned shape is
   * intentionally UI-flat (no nested objects) so the route can
   * stream it without further mapping.
   */
  listRecentExecutionDecisions(limit: number): ExecutionRecentDecisionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT decision_id            AS decisionId,
                created_at             AS createdAt,
                intent_signature       AS intentSignature,
                page_role              AS pageRole,
                site_family            AS siteFamily,
                strategy               AS strategy,
                fallback_strategy      AS fallbackStrategy,
                chosen_layer           AS chosenLayer,
                layer_dispatch_reason  AS layerDispatchReason,
                source_route           AS sourceRoute,
                fallback_cause         AS fallbackCause,
                tokens_saved_estimate  AS tokensSavedEstimate
           FROM tabrix_choose_context_decisions
          ORDER BY created_at DESC, decision_id DESC
          LIMIT ?`,
      )
      .all(limit) as Array<{
      decisionId: string;
      createdAt: string;
      intentSignature: string;
      pageRole: string | null;
      siteFamily: string | null;
      strategy: string;
      fallbackStrategy: string | null;
      chosenLayer: string | null;
      layerDispatchReason: string | null;
      sourceRoute: string | null;
      fallbackCause: string | null;
      tokensSavedEstimate: number | null;
    }>;
    return rows.map((row) => ({
      decisionId: row.decisionId,
      createdAt: row.createdAt,
      intentSignature: row.intentSignature,
      pageRole: row.pageRole && row.pageRole.length > 0 ? row.pageRole : null,
      siteFamily: row.siteFamily && row.siteFamily.length > 0 ? row.siteFamily : null,
      strategy: row.strategy as ContextStrategyName,
      fallbackStrategy: (row.fallbackStrategy ?? null) as ContextStrategyName | null,
      chosenLayer: (row.chosenLayer ?? null) as ReadPageRequestedLayer | null,
      layerDispatchReason: (row.layerDispatchReason ?? null) as LayerDispatchReason | null,
      sourceRoute: (row.sourceRoute ?? null) as LayerSourceRoute | null,
      fallbackCause: row.fallbackCause ?? null,
      tokensSavedEstimate:
        row.tokensSavedEstimate === null || row.tokensSavedEstimate === undefined
          ? null
          : row.tokensSavedEstimate,
    }));
  }

  countAllExecutionDecisions(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM tabrix_choose_context_decisions`)
      .get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /**
   * Aggregate "tokens saved" + per-layer counts + last replay outcome.
   * Returns zeroed shape on a virgin DB (UI never sees `null` rates).
   */
  summarizeExecutionSavings(): Omit<ExecutionSavingsSummary, 'persistenceMode'> {
    const layerCounts: ExecutionSavingsSummary['layerCounts'] = {
      L0: 0,
      'L0+L1': 0,
      'L0+L1+L2': 0,
      unknown: 0,
    };

    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS decisionCount,
                COALESCE(SUM(tokens_saved_estimate), 0) AS tokensSavedEstimateSum
           FROM tabrix_choose_context_decisions`,
      )
      .get() as { decisionCount: number; tokensSavedEstimateSum: number } | undefined;

    const layerRows = this.db
      .prepare(
        `SELECT chosen_layer AS chosenLayer, COUNT(*) AS n
           FROM tabrix_choose_context_decisions
          GROUP BY chosen_layer`,
      )
      .all() as Array<{ chosenLayer: string | null; n: number }>;
    for (const row of layerRows) {
      const key = (row.chosenLayer ?? 'unknown') as ReadPageRequestedLayer | 'unknown';
      if (key === 'L0' || key === 'L0+L1' || key === 'L0+L1+L2' || key === 'unknown') {
        layerCounts[key] = (layerCounts[key] ?? 0) + row.n;
      } else {
        // Unknown layer label: count under the 'unknown' bucket so we
        // never silently drop rows from the displayed total.
        layerCounts.unknown += row.n;
      }
    }

    const lastReplayRow = this.db
      .prepare(
        `SELECT d.decision_id AS decisionId,
                d.created_at  AS createdAt,
                (SELECT o.outcome
                   FROM tabrix_choose_context_outcomes o
                  WHERE o.decision_id = d.decision_id
                  ORDER BY o.recorded_at DESC, o.outcome_id DESC
                  LIMIT 1)   AS outcome
           FROM tabrix_choose_context_decisions d
          WHERE d.strategy = 'experience_replay'
          ORDER BY d.created_at DESC, d.decision_id DESC
          LIMIT 1`,
      )
      .get() as { decisionId: string; createdAt: string; outcome: string | null } | undefined;

    return {
      decisionCount: totals?.decisionCount ?? 0,
      tokensSavedEstimateSum: totals?.tokensSavedEstimateSum ?? 0,
      layerCounts,
      lastReplay: lastReplayRow
        ? {
            decisionId: lastReplayRow.decisionId,
            createdAt: lastReplayRow.createdAt,
            outcome: (lastReplayRow.outcome ?? null) as TabrixChooseContextOutcome | null,
          }
        : null,
    };
  }

  /**
   * Top-N intent buckets ordered by decision count DESC. Ties broken
   * by `lastSeenAt` DESC, then `intentSignature` ASC for determinism.
   */
  topExecutionActionPaths(limit: number): ExecutionTopActionPathSummary[] {
    const rows = this.db
      .prepare(
        `SELECT intent_signature AS intentSignature,
                page_role        AS pageRole,
                site_family      AS siteFamily,
                COUNT(*)         AS decisionCount,
                MAX(created_at)  AS lastSeenAt
           FROM tabrix_choose_context_decisions
          GROUP BY intent_signature, page_role, site_family
          ORDER BY decisionCount DESC,
                   lastSeenAt DESC,
                   intent_signature ASC
          LIMIT ?`,
      )
      .all(limit) as Array<{
      intentSignature: string;
      pageRole: string | null;
      siteFamily: string | null;
      decisionCount: number;
      lastSeenAt: string;
    }>;
    if (rows.length === 0) return [];

    // Resolve top strategy per bucket via a second deterministic pass.
    // Done in JS to avoid a window-function dependency on the SQLite
    // build embedded by better-sqlite3 (we already lean on COALESCE
    // and basic GROUP BY above).
    const placeholders = rows
      .map(
        () =>
          // NOTE: SQLite treats double-quoted strings as identifiers in
          // strict mode. We use single-quoted '' for the empty-string
          // sentinel so the IN-list comparison stays a value comparison.
          "(intent_signature = ? AND COALESCE(page_role, '') = COALESCE(?, '') AND COALESCE(site_family, '') = COALESCE(?, ''))",
      )
      .join(' OR ');
    const params: (string | null)[] = [];
    for (const row of rows) {
      params.push(row.intentSignature, row.pageRole, row.siteFamily);
    }
    const stratRows = this.db
      .prepare(
        `SELECT intent_signature AS intentSignature,
                page_role        AS pageRole,
                site_family      AS siteFamily,
                strategy         AS strategy,
                COUNT(*)         AS n
           FROM tabrix_choose_context_decisions
          WHERE ${placeholders}
          GROUP BY intent_signature, page_role, site_family, strategy
          ORDER BY n DESC, strategy ASC`,
      )
      .all(...params) as Array<{
      intentSignature: string;
      pageRole: string | null;
      siteFamily: string | null;
      strategy: string;
      n: number;
    }>;

    const stratByKey = new Map<string, ContextStrategyName>();
    const keyOf = (intent: string, role: string | null, family: string | null) =>
      `${intent}|${role ?? ''}|${family ?? ''}`;
    for (const row of stratRows) {
      const k = keyOf(row.intentSignature, row.pageRole, row.siteFamily);
      if (!stratByKey.has(k)) {
        stratByKey.set(k, row.strategy as ContextStrategyName);
      }
    }

    return rows.map((row) => ({
      intentSignature: row.intentSignature,
      pageRole: row.pageRole && row.pageRole.length > 0 ? row.pageRole : null,
      siteFamily: row.siteFamily && row.siteFamily.length > 0 ? row.siteFamily : null,
      decisionCount: row.decisionCount,
      lastSeenAt: row.lastSeenAt,
      topStrategy:
        stratByKey.get(keyOf(row.intentSignature, row.pageRole, row.siteFamily)) ??
        ('read_page_required' as ContextStrategyName),
    }));
  }

  reliabilitySignals(): Omit<ExecutionReliabilitySignalSummary, 'persistenceMode'> {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS decisionCount,
                SUM(CASE WHEN source_route = 'dispatcher_fallback_safe' THEN 1 ELSE 0 END) AS fallbackSafeCount
           FROM tabrix_choose_context_decisions`,
      )
      .get() as { decisionCount: number; fallbackSafeCount: number | null } | undefined;
    const decisionCount = totals?.decisionCount ?? 0;
    const fallbackSafeCount = totals?.fallbackSafeCount ?? 0;

    const sourceRouteCounts: ExecutionReliabilitySignalSummary['sourceRouteCounts'] = {
      read_page_required: 0,
      experience_replay_skip_read: 0,
      knowledge_supported_read: 0,
      dispatcher_fallback_safe: 0,
      unknown: 0,
    };
    const routeRows = this.db
      .prepare(
        `SELECT source_route AS sourceRoute, COUNT(*) AS n
           FROM tabrix_choose_context_decisions
          GROUP BY source_route`,
      )
      .all() as Array<{ sourceRoute: string | null; n: number }>;
    for (const row of routeRows) {
      const key = (row.sourceRoute ?? 'unknown') as LayerSourceRoute | 'unknown';
      if (
        key === 'read_page_required' ||
        key === 'experience_replay_skip_read' ||
        key === 'knowledge_supported_read' ||
        key === 'dispatcher_fallback_safe' ||
        key === 'unknown'
      ) {
        sourceRouteCounts[key] = (sourceRouteCounts[key] ?? 0) + row.n;
      } else {
        sourceRouteCounts.unknown += row.n;
      }
    }

    const blockedRows = this.db
      .prepare(
        `SELECT replay_eligible_blocked_by AS reason, COUNT(*) AS n
           FROM tabrix_choose_context_decisions
          WHERE replay_eligible_blocked_by IS NOT NULL
            AND replay_eligible_blocked_by <> ''
            AND replay_eligible_blocked_by <> 'none'
          GROUP BY replay_eligible_blocked_by`,
      )
      .all() as Array<{ reason: string; n: number }>;
    const replayBlockedByCounts: Record<string, number> = {};
    for (const row of blockedRows) {
      replayBlockedByCounts[row.reason] = row.n;
    }

    const fallbackSafeRate =
      decisionCount === 0 ? 0 : Math.round((fallbackSafeCount / decisionCount) * 10000) / 10000;

    return {
      decisionCount,
      fallbackSafeCount,
      fallbackSafeRate,
      sourceRouteCounts,
      replayBlockedByCounts,
    };
  }
}
