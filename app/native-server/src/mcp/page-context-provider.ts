/**
 * Page Context Provider.
 *
 * Replaces hard-coded dispatcher counters with real counters drawn from the
 * most recent `memory_page_snapshots` row that matches the chooser call. The
 * chooser still runs as a pure function over already-resolved facts; this
 * provider is the only IO-touching adapter that surfaces those facts.
 *
 * Lookup order:
 *   1. `live_snapshot` — newest snapshot whose `url` exactly matches
 *      the caller-supplied `url`. Strongest signal: the page the
 *      agent is asking about is the page we have telemetry for.
 *   2. `memory_snapshot` — newest snapshot whose `pageRole` matches
 *      the caller-supplied `pageRole` when no URL match is found.
 *      Weaker but still real telemetry: same role bucket, recent
 *      enough that strategy-table complexity rules can fire.
 *   3. `fallback_zero` — no usable snapshot we can honestly tie to
 *      THIS chooser call. Returns zero counters with an explicit
 *      `cause` (`persistence_off` / `no_session_snapshots` /
 *      `no_matching_snapshot` / `no_task_snapshots` /
 *      `provider_error`) so chooser telemetry can answer "did we
 *      honestly not know, or did we lie with zeros?".
 *
 * The previous implementation tried a global "newest snapshot anywhere"
 * fallback when both URL and pageRole missed, and labelled it
 * `memory_snapshot`. That violated the "honest input" contract: feeding an
 * unrelated page's complexity counters to the dispatcher is the same shape of
 * dishonesty as hard-coded zeros. The global lookup was removed; when no
 * URL/pageRole match exists we surface `fallback_zero` with the precise cause
 * so telemetry stays trustworthy.
 *
 * Hard rules:
 *   - This module is read-only. It NEVER writes to
 *     `memory_page_snapshots`. It NEVER mutates the chooser input.
 *   - All errors below SQLite layer become `fallback_zero` with
 *     cause `provider_error` — the chooser hot path must not throw
 *     on a corrupt DB row.
 *   - No `process.env` reads here. Persistence-mode gating happens
 *     at the caller (the provider receives a `null` repo when
 *     persistence is `off`).
 */

import type { PageSnapshot } from '../memory/db/page-snapshot-repository';

export type DispatcherInputSource = 'live_snapshot' | 'memory_snapshot' | 'fallback_zero';

export type DispatcherInputFallbackCause =
  | 'persistence_off'
  | 'no_session_snapshots'
  | 'no_matching_snapshot'
  | 'no_task_snapshots'
  | 'provider_error';

export interface PageContextLookupInput {
  /** Optional URL the chooser caller is asking about. */
  url?: string | null;
  /** Optional pageRole hint from the chooser caller. */
  pageRole?: string | null;
}

export interface PageContextLookupResult {
  source: DispatcherInputSource;
  candidateActionsCount: number;
  hvoCount: number;
  fullReadByteLength: number;
  pageRole: string | null;
  /** Set only when `source === 'fallback_zero'`. */
  fallbackCause?: DispatcherInputFallbackCause;
}

export interface PageContextProvider {
  getContext(input: PageContextLookupInput): PageContextLookupResult;
}

/**
 * Narrow read surface the live provider needs from
 * `PageSnapshotRepository`. Intentionally does NOT include
 * `findLatestGlobal`: an unrelated newest snapshot is not honest dispatcher
 * input. The repository still exposes the global accessor for other callers
 * (e.g. operator tooling), but the provider must not consume it.
 */
export interface PageSnapshotReader {
  findLatestForUrl(url: string): PageSnapshot | undefined;
  findLatestForPageRole(pageRole: string): PageSnapshot | undefined;
}

export interface LivePageContextProviderOptions {
  /**
   * `null` when persistence is `off` — the provider then always
   * returns `fallback_zero` with cause `persistence_off`, matching
   * the chooser's existing "Memory unavailable" code path.
   */
  reader: PageSnapshotReader | null;
}

const FALLBACK_ZERO = (
  cause: DispatcherInputFallbackCause,
  pageRole: string | null,
): PageContextLookupResult => ({
  source: 'fallback_zero',
  candidateActionsCount: 0,
  hvoCount: 0,
  fullReadByteLength: 0,
  pageRole,
  fallbackCause: cause,
});

/**
 * Best-effort byte-length estimate for the dispatcher's
 * `fullReadByteLength` input. We sum the three protocol blob
 * lengths (when present) so the dispatcher's
 * `fullReadTokenEstimate` is grounded in the same NDJSON the
 * snapshot already serialised. Returns 0 when nothing is parseable —
 * the dispatcher treats 0 as "no estimate" and falls back to its
 * own heuristic.
 */
function estimateFullReadByteLength(snap: PageSnapshot): number {
  let total = 0;
  for (const blob of [snap.protocolL0Blob, snap.protocolL1Blob, snap.protocolL2Blob]) {
    if (typeof blob === 'string') total += blob.length;
  }
  return total;
}

function projectSnapshot(
  snap: PageSnapshot,
  source: 'live_snapshot' | 'memory_snapshot',
): PageContextLookupResult {
  return {
    source,
    candidateActionsCount: Number.isFinite(snap.candidateActionCount)
      ? snap.candidateActionCount
      : 0,
    hvoCount: Number.isFinite(snap.highValueObjectCount) ? snap.highValueObjectCount : 0,
    fullReadByteLength: estimateFullReadByteLength(snap),
    pageRole: typeof snap.pageRole === 'string' && snap.pageRole.length > 0 ? snap.pageRole : null,
  };
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePageRole(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class LivePageContextProvider implements PageContextProvider {
  private readonly reader: PageSnapshotReader | null;

  constructor(options: LivePageContextProviderOptions) {
    this.reader = options.reader;
  }

  getContext(input: PageContextLookupInput): PageContextLookupResult {
    const requestedPageRole = normalizePageRole(input.pageRole ?? null);
    if (this.reader === null) {
      return FALLBACK_ZERO('persistence_off', requestedPageRole);
    }
    try {
      const url = normalizeUrl(input.url ?? null);
      if (url) {
        const live = this.reader.findLatestForUrl(url);
        if (live) return projectSnapshot(live, 'live_snapshot');
      }
      if (requestedPageRole) {
        const byRole = this.reader.findLatestForPageRole(requestedPageRole);
        if (byRole) return projectSnapshot(byRole, 'memory_snapshot');
      }
      // NO global "newest snapshot anywhere" fallback: an unrelated page's
      // complexity is not honest dispatcher input. Surface a precise cause so
      // chooser telemetry remains diagnosable (operator can tell URL miss
      // apart from "we never had a hint" apart from "we had a hint but no row
      // matched").
      let cause: DispatcherInputFallbackCause;
      if (url) {
        cause = 'no_session_snapshots';
      } else if (requestedPageRole) {
        cause = 'no_matching_snapshot';
      } else {
        cause = 'no_task_snapshots';
      }
      return FALLBACK_ZERO(cause, requestedPageRole);
    } catch {
      return FALLBACK_ZERO('provider_error', requestedPageRole);
    }
  }
}

/**
 * Singleton-free factory used by `native-tool-handlers.ts` so tests
 * can construct a fresh provider per test. The native handler keeps
 * the construction inside its body to avoid shipping a global mutable
 * instance.
 */
export function createLivePageContextProvider(
  reader: PageSnapshotReader | null,
): PageContextProvider {
  return new LivePageContextProvider({ reader });
}
