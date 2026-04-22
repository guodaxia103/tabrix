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
import type { ContextStrategyName, TabrixChooseContextOutcome } from '@tabrix/shared';

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
    this.db
      .prepare(
        `INSERT INTO tabrix_choose_context_decisions (
           decision_id, intent_signature, page_role, site_family,
           strategy, fallback_strategy, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.decisionId,
        input.intentSignature,
        input.pageRole,
        input.siteFamily,
        input.strategy,
        input.fallbackStrategy,
        input.createdAt,
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
}
