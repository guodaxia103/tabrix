/**
 * V27-04b — Tabrix v2.7 Complexity Profiler.
 *
 * Pure function over the V27-02 fact snapshot. Asks one question only:
 * "what is the dominant SHAPE of this page?". It does NOT consult
 * readiness signals — readiness is V27-04a. The two arms compose only
 * inside `composeLayerBudget()` (see `v27-layer-budget.ts`).
 *
 * The classifier is deterministic: given the same
 * `BrowserFactSnapshot`, it returns the same `ComplexityProfile`
 * (modulo `producedAtMs`, which the caller controls via `options.now`).
 *
 * Privacy: the input snapshot is already brand-neutral (V27-02
 * guarantee). This module never reads raw URLs, headers, raw HTML, or
 * innerText. Decisions ride on closed-enum metadata only:
 *   - `noiseClass`, `sizeClass`, `method`, `pathPattern` shape
 *     (e.g. trailing `/.../:id` segment) for the network arm,
 *   - the `regionHashes` keys (allowlist of brand-neutral region tags)
 *     for the DOM arm.
 *
 * Boundary: no I/O, no logging, no globals.
 */

import type {
  BrowserFactSnapshot,
  ComplexityKind,
  ComplexityProfile,
  DomRegionFingerprint,
  NetworkRequestFact,
} from '@tabrix/shared';

/** Confidence floor for the `'unknown'` verdict. The producer reports
 *  what little it does know rather than zero, so consumers can still
 *  distinguish "we have no data" from "we have negative data". */
const COMPLEXITY_UNKNOWN_CONFIDENCE = 0.2;

/** Single decisive signal — confident verdict but not absolute. */
const COMPLEXITY_SINGLE_SIGNAL_CONFIDENCE = 0.7;

/** Two corroborating signals (e.g. region tag + matching network
 *  shape) — high confidence. */
const COMPLEXITY_TWO_SIGNAL_CONFIDENCE = 0.9;

/** Three or more corroborating signals — at-the-ceiling confidence. */
const COMPLEXITY_THREE_SIGNAL_CONFIDENCE = 1.0;

/**
 * Closed-enum allowlist of brand-neutral region tags V27-04 understands.
 * The allowlist mirrors the V27-02 region-fingerprint helper (see
 * `v27-fact-fingerprint.ts`); any tag outside the list is treated as a
 * "shell" hint (i.e. degrades the verdict to `simple` if no other
 * signal beats it).
 */
const KNOWN_REGION_TAGS = [
  'header',
  'main_list',
  'detail_panel',
  'document_body',
  'transactional_form',
  'media_player',
  'app_shell',
  'footer',
] as const;
type KnownRegionTag = (typeof KNOWN_REGION_TAGS)[number];

const KNOWN_REGION_TAG_SET: ReadonlySet<string> = new Set(KNOWN_REGION_TAGS);

export interface ComplexityClassifyOptions {
  /** Optional clock for tests; defaults to the snapshot's
   *  `producedAtMs` (so the verdict is deterministic). */
  now?: () => number;
}

/**
 * Compute a `ComplexityProfile` from a fact snapshot.
 *
 * The profiler runs two orthogonal arms:
 *   - DOM arm: maps the strongest known region tag to a complexity kind
 *     using `mapRegionTagToKind()`.
 *   - Network arm: maps the dominant usable network fact's shape to a
 *     complexity kind using `mapNetworkShapeToKind()`.
 *
 * The two arm verdicts are then merged: if they agree, the merged kind
 * gets a two-signal confidence boost; if they disagree, the merged
 * verdict honours the DOM arm (since DOM region tags are more
 * decisive than network shape) but downgrades the confidence to single
 * signal. If both arms abstain, the verdict is `'unknown'`.
 */
export function classifyComplexity(
  snapshot: BrowserFactSnapshot,
  options: ComplexityClassifyOptions = {},
): ComplexityProfile {
  const now = options.now ?? (() => snapshot.producedAtMs);

  const domVerdict = domArm(snapshot.domFingerprint);
  const netVerdict = networkArm(snapshot.networkFacts);

  if (!domVerdict && !netVerdict) {
    return wrap('unknown', COMPLEXITY_UNKNOWN_CONFIDENCE, now());
  }

  if (domVerdict && netVerdict && domVerdict.kind === netVerdict.kind) {
    return wrap(domVerdict.kind, COMPLEXITY_TWO_SIGNAL_CONFIDENCE, now());
  }

  if (domVerdict && netVerdict && domVerdict.kind !== netVerdict.kind) {
    return wrap(domVerdict.kind, COMPLEXITY_SINGLE_SIGNAL_CONFIDENCE, now());
  }

  if (domVerdict) {
    return wrap(domVerdict.kind, COMPLEXITY_SINGLE_SIGNAL_CONFIDENCE, now());
  }

  return wrap(netVerdict!.kind, COMPLEXITY_SINGLE_SIGNAL_CONFIDENCE, now());
}

interface ArmVerdict {
  kind: ComplexityKind;
}

/**
 * DOM arm — maps the strongest known region tag in the fingerprint to
 * a complexity kind. The mapping is deliberately conservative: a
 * single decisive tag wins, and ties prefer the more "expensive" kind
 * (so the layer budget composer is biased towards over-investigation
 * rather than under-investigation).
 */
function domArm(fingerprint: DomRegionFingerprint | null): ArmVerdict | null {
  if (!fingerprint) return null;
  const tags = Object.keys(fingerprint.regionHashes).filter((tag) => KNOWN_REGION_TAG_SET.has(tag));
  if (tags.length === 0) return null;

  // Walk in priority order: the first tag that matches wins. Priority
  // descends from "cheap shell" to "expensive content" so the most
  // specific / most expensive kind wins.
  const priority: KnownRegionTag[] = [
    'media_player',
    'transactional_form',
    'document_body',
    'detail_panel',
    'main_list',
    'app_shell',
    'header',
    'footer',
  ];
  for (const candidate of priority) {
    if (tags.includes(candidate)) {
      return { kind: mapRegionTagToKind(candidate) };
    }
  }
  return null;
}

function mapRegionTagToKind(tag: KnownRegionTag): ComplexityKind {
  switch (tag) {
    case 'media_player':
      return 'media';
    case 'transactional_form':
      return 'transactional';
    case 'document_body':
      return 'document';
    case 'detail_panel':
      return 'detail';
    case 'main_list':
      return 'list_or_search';
    case 'app_shell':
      return 'complex_app';
    case 'header':
    case 'footer':
      return 'simple';
    default: {
      const _exhaustive: never = tag;
      void _exhaustive;
      return 'unknown';
    }
  }
}

/**
 * Network arm — buckets usable network facts (i.e. `noiseClass !==
 * 'analytics' | 'asset' | 'telemetry' | 'auth' | 'private'`) into a
 * complexity kind. The classifier counts only `usable` facts so an
 * ad-heavy page does not get reclassified as `transactional`.
 */
function networkArm(facts: NetworkRequestFact[]): ArmVerdict | null {
  const usable = facts.filter((f) => f.noiseClass === 'usable');
  if (usable.length === 0) return null;

  let listish = 0;
  let detailish = 0;
  let documentish = 0;
  let transactional = 0;
  let mediaish = 0;
  let appish = 0;

  for (const fact of usable) {
    if (looksTransactional(fact)) transactional++;
    if (looksMedia(fact)) mediaish++;
    if (looksList(fact)) listish++;
    if (looksDetail(fact)) detailish++;
    if (looksDocument(fact)) documentish++;
    if (looksApp(fact)) appish++;
  }

  // Pick the strongest signal. If multiple buckets tie at top, prefer
  // the more expensive kind (matches the DOM-arm bias).
  const buckets: Array<[ComplexityKind, number]> = [
    ['media', mediaish],
    ['transactional', transactional],
    ['document', documentish],
    ['detail', detailish],
    ['list_or_search', listish],
    ['complex_app', appish],
  ];

  let best: [ComplexityKind, number] | null = null;
  for (const candidate of buckets) {
    if (candidate[1] === 0) continue;
    if (best === null || candidate[1] > best[1]) best = candidate;
  }

  if (best === null) return null;
  return { kind: best[0] };
}

function looksTransactional(fact: NetworkRequestFact): boolean {
  return (
    fact.method === 'POST' ||
    fact.method === 'PUT' ||
    fact.method === 'PATCH' ||
    fact.method === 'DELETE'
  );
}

function looksMedia(fact: NetworkRequestFact): boolean {
  if (!fact.contentType) return false;
  const ct = fact.contentType.toLowerCase();
  return ct.startsWith('video/') || ct.startsWith('audio/');
}

function looksDocument(fact: NetworkRequestFact): boolean {
  if (!fact.contentType) return false;
  const ct = fact.contentType.toLowerCase();
  if (ct === 'application/pdf') return true;
  if (ct.startsWith('text/markdown')) return true;
  // Long-form HTML responses are documents only when the path itself
  // suggests it (article / post / docs / wiki / pages segments).
  if (
    ct.startsWith('text/html') &&
    fact.method === 'GET' &&
    fact.sizeClass !== 'small' &&
    /(?:^|\/)(?:articles?|posts?|docs?|wiki|pages?)(?:\/|$)/i.test(fact.pathPattern)
  ) {
    return true;
  }
  return false;
}

function looksList(fact: NetworkRequestFact): boolean {
  // A list / search response is a GET that returns medium+ JSON-shaped
  // payload AND has at least one query key (filter / page / q / cursor /
  // limit). The check stays brand-neutral by only inspecting the closed
  // enum + the query-key array.
  if (fact.method !== 'GET') return false;
  if (!fact.contentType || !fact.contentType.toLowerCase().includes('json')) return false;
  if (fact.sizeClass !== 'medium' && fact.sizeClass !== 'large') return false;
  if (fact.queryKeys.length === 0) return false;
  return true;
}

function looksDetail(fact: NetworkRequestFact): boolean {
  // Detail responses are GETs to an `:id`-style trailing segment with a
  // small/medium JSON payload and zero "search-y" query keys. We
  // approximate `:id` by "path's last segment is alphanumeric and 4+
  // chars".
  if (fact.method !== 'GET') return false;
  if (!fact.contentType || !fact.contentType.toLowerCase().includes('json')) return false;
  if (fact.sizeClass === 'large' || fact.sizeClass === 'empty') return false;
  if (fact.queryKeys.length > 1) return false;
  const lastSeg = fact.pathPattern.split('/').filter(Boolean).pop();
  if (!lastSeg) return false;
  return lastSeg.length >= 4 && /^[a-z0-9_-]+$/i.test(lastSeg);
}

function looksApp(fact: NetworkRequestFact): boolean {
  if (fact.contentType && fact.contentType.toLowerCase().includes('event-stream')) return true;
  if (
    fact.resourceType === 'websocket' ||
    fact.resourceType === 'eventsource' ||
    fact.resourceType === 'WebSocket'
  ) {
    return true;
  }
  return false;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function wrap(kind: ComplexityKind, confidence: number, producedAtMs: number): ComplexityProfile {
  return {
    kind,
    confidence: clampUnit(confidence),
    producedAtMs,
  };
}

/**
 * Re-export for tests + the layer-budget composer.
 */
export const COMPLEXITY_CONFIDENCE_FLOOR = COMPLEXITY_UNKNOWN_CONFIDENCE;
