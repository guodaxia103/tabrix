/**
 * V26-05 (B-028) — Task Session Context + Read Budget.
 *
 * Per-task in-process state for the `chrome_read_page` hot path. The
 * goal (V4.1 §0.1 / §6 / §11) is to stop redundant DOM reads from
 * accumulating cost while keeping the v2.5 happy path bit-identical
 * for the very first read of a page.
 *
 * Hard rules implemented here:
 *
 * 1. Default initial layer for any allowed read is `L0+L1` — replay
 *    and API fallback paths are NOT allowed to enter the DOM at L2;
 *    they earn the L2 budget only after L0+L1 produced a verifier or
 *    target-evidence signal that demands it.
 * 2. Read budget is configurable via `TABRIX_READ_BUDGET_PER_TASK`
 *    (positive integer; falls back to 6 — the V4.1 §6 default).
 * 3. URL OR pageRole change invalidates `lastReadLayer` and
 *    `targetRefsSeen` so a fresh page on the same task starts clean.
 * 4. Layer demotion (e.g. `L0+L1+L2 → L0`) is allowed but flagged via
 *    `reason='layer_demotion'` so callers can surface the warning.
 *
 * Pure module: no IO, no SQLite, no React/Vue. State lives only in
 * the parent `SessionManager` instance and is reset on
 * `finishSession`. Process restart resets cleanly because nothing is
 * persisted (V4.1 §0.1: "task session context is a runtime cap, not
 * a persisted budget").
 */

import type { ReadPageRequestedLayer } from '@tabrix/shared';

/**
 * Default read budget per task. Sized to "a small handful of fresh
 * reads is fine, more than that is almost certainly a runaway loop"
 * — the V4.1 §6 baseline. Override via `TABRIX_READ_BUDGET_PER_TASK`.
 */
export const DEFAULT_READ_BUDGET_PER_TASK = 6;

/**
 * Hard upper bound for the env override. Anything larger almost
 * certainly indicates a typo (e.g. `60` instead of `6`) so we cap at
 * 100 — large enough that any legitimate workflow we've measured
 * fits under it, small enough that a runaway client cannot starve
 * the bridge by accident.
 */
const READ_BUDGET_HARD_CAP = 100;

/**
 * Closed enum for `chosenSource` on a `chrome_read_page` outcome we
 * have actually observed. Mirrors `BenchmarkLayerSourceRoute` in
 * spirit — we keep them decoupled because the runtime needs to
 * survive an unknown source string from a malformed extension reply
 * without crashing. Open-ended at the API boundary, narrowed to a
 * union here for type-safety on the gate's own bookkeeping.
 */
export type TaskReadSource =
  | 'dom_json'
  | 'markdown_projection'
  | 'knowledge_api'
  | 'experience_replay'
  | 'unknown';

/**
 * `shouldAllowReadPage` answer. Always returns a `suggestedLayer` so
 * callers do not need to re-derive the V4.1 §0.1 default (`L0+L1`).
 */
export interface ShouldAllowReadPageResult {
  /**
   * `false` only when the task is over budget. Layer demotions and
   * "no fresh evidence" reads are allowed but flagged via `reason`.
   */
  allowed: boolean;
  /**
   * Human-readable justification. Empty string when `allowed=true`
   * and there is nothing to flag.
   */
  reason: '' | 'read_budget_exceeded' | 'read_redundant' | 'layer_demotion';
  /**
   * The layer the gate thinks the caller SHOULD use, regardless of
   * what they requested. Always `'L0+L1'` for a first read on this
   * page; matches the requested layer otherwise.
   */
  suggestedLayer: ReadPageRequestedLayer;
  /**
   * Snapshot of the task's read budget after this decision so the
   * caller can put it in a structured warning payload without
   * re-reading the context.
   */
  readPageCount: number;
  readBudget: number;
}

export interface NoteReadPageInput {
  layer: ReadPageRequestedLayer;
  source: TaskReadSource;
  /**
   * Stable target refs the read surfaced (V25-04 / V26-04 contract).
   * Folded into `targetRefsSeen` so a follow-up read for the same
   * targets is bucketed as redundant.
   */
  targetRefs?: ReadonlyArray<string> | null;
  /**
   * API endpoint families the read absorbed (e.g. `'github_issues'`).
   * Same idea as `targetRefs` but for the Knowledge layer.
   */
  apiFamilies?: ReadonlyArray<string> | null;
}

export interface ShouldAllowReadPageInput {
  /**
   * The layer the caller WANTS. The gate may suggest a different
   * layer (always `'L0+L1'` on a first read).
   */
  requestedLayer: ReadPageRequestedLayer;
}

/**
 * Resolve `TABRIX_READ_BUDGET_PER_TASK` from a process.env-shaped
 * map. Pure — accepts the env so tests do not have to mutate the
 * real `process.env`. Invalid values fall back to the default
 * silently (no warning spam — env mistypes are common and the gate
 * must keep the v2.5 happy path running).
 */
export function resolveReadBudgetFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  const raw = env['TABRIX_READ_BUDGET_PER_TASK'];
  if (raw === undefined || raw === null) return DEFAULT_READ_BUDGET_PER_TASK;
  const trimmed = String(raw).trim();
  if (trimmed === '') return DEFAULT_READ_BUDGET_PER_TASK;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_READ_BUDGET_PER_TASK;
  }
  return Math.min(parsed, READ_BUDGET_HARD_CAP);
}

export interface TaskSessionContextOptions {
  /**
   * Override the read budget directly (test seam). When omitted, the
   * context resolves it from `process.env.TABRIX_READ_BUDGET_PER_TASK`
   * via `resolveReadBudgetFromEnv`.
   */
  readBudget?: number;
  /**
   * Inject the env reader (test seam — defaults to `process.env`).
   * Only consulted when `readBudget` is omitted.
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * In-memory per-task gate. Lives inside `SessionManager` keyed by
 * `taskId`. Constructed once per `startSession`, dropped on
 * `finishSession`.
 *
 * Single-threaded by design: Node's event loop guarantees that
 * `noteReadPage` and `shouldAllowReadPage` cannot interleave for the
 * same task instance, so we do not need explicit locking.
 */
export class TaskSessionContext {
  /**
   * Most recent URL we have observed via `noteUrlChange`. `null`
   * before the first navigation/read on this task.
   */
  public currentUrl: string | null = null;

  /**
   * Most recent pageRole, sourced from V26-04's `PageContextProvider`
   * when available.
   */
  public pageRole: string | null = null;

  /**
   * Layer of the most recent SUCCESSFUL read. `null` before the
   * first read OR after a URL/pageRole change invalidated it.
   */
  public lastReadLayer: ReadPageRequestedLayer | null = null;

  /**
   * Source route of the most recent successful read.
   */
  public lastReadSource: TaskReadSource | null = null;

  /**
   * Stable refs we have already surfaced. A read that requests the
   * same set of refs at the same layer is bucketed as redundant.
   */
  public readonly targetRefsSeen = new Set<string>();

  /**
   * API endpoint families the Knowledge layer has already returned
   * for this task. Same redundancy idea as `targetRefsSeen`.
   */
  public readonly apiEndpointFamiliesSeen = new Set<string>();

  /**
   * Number of reads this task has actually executed (includes
   * redundant reads — they cost the bridge a round-trip even when
   * they reuse the projection). Compared against `readBudget` in
   * `shouldAllowReadPage`.
   */
  public readPageCount = 0;

  /**
   * Resolved read budget. Frozen at construction time so a mid-task
   * env mutation cannot retroactively shrink the cap underneath an
   * agent that is already half-way through a workflow.
   */
  public readonly readBudget: number;

  constructor(options?: TaskSessionContextOptions) {
    if (options?.readBudget !== undefined) {
      const cap = options.readBudget;
      if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap <= 0) {
        throw new Error(
          `TaskSessionContext readBudget must be a positive integer, received ${String(cap)}`,
        );
      }
      this.readBudget = Math.min(cap, READ_BUDGET_HARD_CAP);
    } else {
      this.readBudget = resolveReadBudgetFromEnv(options?.env ?? process.env);
    }
  }

  /**
   * Record a navigation or first observation of a URL. When the URL
   * OR the pageRole changes, we invalidate `lastReadLayer`,
   * `lastReadSource`, and `targetRefsSeen` so a follow-up read on
   * the new page is treated as a fresh first read (still subject to
   * the budget, but not bucketed as redundant). `apiEndpointFamiliesSeen`
   * is intentionally preserved across navigations — Knowledge hits
   * are URL-agnostic on purpose.
   *
   * Idempotent: passing the same `(url, pageRole)` is a no-op.
   */
  public noteUrlChange(url: string | null, pageRole?: string | null): void {
    const nextUrl = typeof url === 'string' && url.length > 0 ? url : null;
    const nextRole = typeof pageRole === 'string' && pageRole.length > 0 ? pageRole : null;
    const urlChanged = nextUrl !== this.currentUrl;
    const roleChanged = nextRole !== null && nextRole !== this.pageRole;
    this.currentUrl = nextUrl;
    if (nextRole !== null) this.pageRole = nextRole;
    if (urlChanged || roleChanged) {
      this.lastReadLayer = null;
      this.lastReadSource = null;
      this.targetRefsSeen.clear();
    }
  }

  /**
   * Record a successful `chrome_read_page` outcome. Increments
   * `readPageCount` exactly once per call. The caller is responsible
   * for invoking this AFTER the bridge returns success — failed
   * reads do not consume the budget (V4.1 §6 — "honest budget").
   */
  public noteReadPage(input: NoteReadPageInput): void {
    this.readPageCount += 1;
    this.lastReadLayer = input.layer;
    this.lastReadSource = input.source;
    if (input.targetRefs) {
      for (const ref of input.targetRefs) {
        if (typeof ref === 'string' && ref.length > 0) this.targetRefsSeen.add(ref);
      }
    }
    if (input.apiFamilies) {
      for (const family of input.apiFamilies) {
        if (typeof family === 'string' && family.length > 0)
          this.apiEndpointFamiliesSeen.add(family);
      }
    }
  }

  /**
   * Gate. Returns the structured decision the `register-tools`
   * `chrome_read_page` shim turns into either a forwarded bridge
   * call or a structured warning `CallToolResult`.
   *
   * Decision tree:
   *   1. Budget exceeded → `allowed=false`, `reason='read_budget_exceeded'`.
   *   2. Same URL, same requested layer as last read → allowed but
   *      flagged `reason='read_redundant'` (caller may choose to
   *      short-circuit and reuse the cached projection).
   *   3. Layer demotion (requested < lastReadLayer) → allowed but
   *      flagged `reason='layer_demotion'` so the operator can spot
   *      pathological L2→L0 churn.
   *   4. Otherwise → allowed cleanly.
   *
   * Suggested layer is always `'L0+L1'` for the very first read on
   * the current page (V4.1 §0.1 hard rule); otherwise echoes back
   * the requested layer.
   */
  public shouldAllowReadPage(input: ShouldAllowReadPageInput): ShouldAllowReadPageResult {
    const requested = input.requestedLayer;
    const isFirstReadOnPage = this.lastReadLayer === null;
    const suggestedLayer: ReadPageRequestedLayer = isFirstReadOnPage ? 'L0+L1' : requested;

    if (this.readPageCount >= this.readBudget) {
      return {
        allowed: false,
        reason: 'read_budget_exceeded',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    if (!isFirstReadOnPage && this.lastReadLayer === requested) {
      return {
        allowed: true,
        reason: 'read_redundant',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    if (!isFirstReadOnPage && layerRank(requested) < layerRank(this.lastReadLayer!)) {
      return {
        allowed: true,
        reason: 'layer_demotion',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    return {
      allowed: true,
      reason: '',
      suggestedLayer,
      readPageCount: this.readPageCount,
      readBudget: this.readBudget,
    };
  }
}

/**
 * Total order on the read-page layers — used for demotion detection.
 * Kept private to this module; the public surface only ever consumes
 * the `'L0' | 'L0+L1' | 'L0+L1+L2'` strings.
 */
function layerRank(layer: ReadPageRequestedLayer): number {
  switch (layer) {
    case 'L0':
      return 0;
    case 'L0+L1':
      return 1;
    case 'L0+L1+L2':
      return 2;
    default:
      return 0;
  }
}
