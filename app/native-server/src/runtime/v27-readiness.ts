/**
 * V27-04a — Tabrix v2.7 Readiness Profiler.
 *
 * Pure function over the V27-02 fact snapshot. Asks one question only:
 * "is the page in a state where a list-shaped read would be wasted?".
 * It does NOT classify what the page IS — that is V27-04b
 * (`v27-complexity.ts`). The two arms compose only inside
 * `composeLayerBudget()` (see `v27-layer-budget.ts`).
 *
 * The classifier is deterministic: given the same
 * `BrowserFactSnapshot`, it returns the same `ReadinessProfile` (modulo
 * `producedAtMs`, which the caller controls via `options.now`).
 *
 * Privacy: the input snapshot is already brand-neutral (V27-02
 * guarantee). This module never reads raw URLs, headers, or DOM
 * strings. The output carries closed-enum readiness states only.
 *
 * Boundary: no I/O, no logging, no globals. The runtime composes the
 * verdict with operation-log metadata; no side effects here.
 */

import type {
  BrowserFactSnapshot,
  ReadinessProfile,
  ReadinessSignals,
  ReadinessState,
} from '@tabrix/shared';

const READINESS_TRUE = 'true' as const;
const READINESS_FALSE = 'false' as const;

/** Confidence the profiler assigns to a single corroborating signal.
 *  Two signals push confidence to `0.95`; three+ to `1.0`. The floor
 *  is `READINESS_BASE_CONFIDENCE` for a single-signal verdict. */
const READINESS_BASE_CONFIDENCE = 0.6;
const READINESS_TWO_SIGNAL_CONFIDENCE = 0.95;
const READINESS_THREE_SIGNAL_CONFIDENCE = 1.0;

/** Confidence for the negative verdicts. The producer is more
 *  confident about `error`/`empty` than about positive verdicts because
 *  the negative paths usually have a single decisive signal (e.g.
 *  `documentComplete='false' AND networkQuiet='true'`). */
const READINESS_NEGATIVE_CONFIDENCE = 0.85;

/** Confidence floor for the `'unknown'` verdict — the producer reports
 *  what little it does know rather than zero, so consumers can still
 *  distinguish "we have no data" from "we have negative data". */
const READINESS_UNKNOWN_CONFIDENCE = 0.2;

export interface ReadinessClassifyOptions {
  /** Optional clock for tests; defaults to the snapshot's
   *  `producedAtMs` (so the verdict is deterministic). */
  now?: () => number;
}

/**
 * Compute a `ReadinessProfile` from a fact snapshot.
 *
 * Decision tree (closed enum, matches the V27-04 SoT):
 *   1. If readiness signals carry an explicit error or the network arm
 *      reports a hard failure (HTTP 5xx + zero usable network facts),
 *      return `'error'`.
 *   2. If `documentComplete='true' AND keyRegionReady='false' AND
 *      networkQuiet='true'`, return `'empty'`.
 *   3. If `routeStable='true' AND networkQuiet='true'`, return
 *      `'route_stable'` (strongest "ready").
 *   4. If `keyRegionReady='true' AND networkQuiet='true'`, return
 *      `'network_key_done'`.
 *   5. If `keyRegionReady='true'`, return `'key_region_ready'`.
 *   6. If `documentComplete='true'`, return `'document_complete'`.
 *   7. Otherwise, return `'unknown'` (zero useful signals).
 *
 * The branches are ordered so the strongest verdict wins; the rule
 * order is pinned by the V27-04 unit test.
 */
export function classifyReadiness(
  snapshot: BrowserFactSnapshot,
  options: ReadinessClassifyOptions = {},
): ReadinessProfile {
  const now = options.now ?? (() => snapshot.producedAtMs);
  const signals = snapshot.readiness;

  const contributing: ReadinessState[] = [];

  if (isError(snapshot)) {
    contributing.push('error');
    return wrap('error', READINESS_NEGATIVE_CONFIDENCE, contributing, now());
  }

  if (isEmpty(signals)) {
    contributing.push('empty');
    return wrap('empty', READINESS_NEGATIVE_CONFIDENCE, contributing, now());
  }

  // Positive verdicts. Collect every "true" signal so consumers can
  // diagnose why the verdict landed where it did.
  if (signals.documentComplete === READINESS_TRUE) contributing.push('document_complete');
  if (signals.keyRegionReady === READINESS_TRUE) contributing.push('key_region_ready');
  if (
    (signals.keyRegionReady === READINESS_TRUE || signals.routeStable === READINESS_TRUE) &&
    signals.networkQuiet === READINESS_TRUE
  ) {
    contributing.push('network_key_done');
  }
  if (signals.routeStable === READINESS_TRUE && signals.networkQuiet === READINESS_TRUE) {
    contributing.push('route_stable');
  }

  if (contributing.includes('route_stable')) {
    return wrap('route_stable', confidenceFor(contributing.length), contributing, now());
  }
  if (contributing.includes('network_key_done')) {
    return wrap('network_key_done', confidenceFor(contributing.length), contributing, now());
  }
  if (contributing.includes('key_region_ready')) {
    return wrap('key_region_ready', confidenceFor(contributing.length), contributing, now());
  }
  if (contributing.includes('document_complete')) {
    return wrap('document_complete', confidenceFor(contributing.length), contributing, now());
  }

  return wrap('unknown', READINESS_UNKNOWN_CONFIDENCE, [], now());
}

function isError(snapshot: BrowserFactSnapshot): boolean {
  // Hard error: every captured network fact is a server error AND we
  // have at least one network fact (so we are not just "no data").
  if (snapshot.networkFacts.length === 0) return false;
  return snapshot.networkFacts.every((fact) => fact.status !== null && fact.status >= 500);
}

function isEmpty(signals: ReadinessSignals): boolean {
  return (
    signals.documentComplete === READINESS_TRUE &&
    signals.keyRegionReady === READINESS_FALSE &&
    signals.networkQuiet === READINESS_TRUE
  );
}

function confidenceFor(numSignals: number): number {
  if (numSignals >= 3) return READINESS_THREE_SIGNAL_CONFIDENCE;
  if (numSignals === 2) return READINESS_TWO_SIGNAL_CONFIDENCE;
  return READINESS_BASE_CONFIDENCE;
}

function wrap(
  state: ReadinessState,
  confidence: number,
  contributing: ReadinessState[],
  producedAtMs: number,
): ReadinessProfile {
  return {
    state,
    confidence: clampUnit(confidence),
    contributingSignals: dedupe(contributing),
    producedAtMs,
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function dedupe(values: ReadinessState[]): ReadinessState[] {
  const seen = new Set<ReadinessState>();
  const out: ReadinessState[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Re-exports — used by `v27-layer-budget.ts` and the tests.
 */
export const READINESS_CONFIDENCE_FLOOR = READINESS_UNKNOWN_CONFIDENCE;
export const READINESS_NEGATIVE_FLOOR = READINESS_NEGATIVE_CONFIDENCE;
