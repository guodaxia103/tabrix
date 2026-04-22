/**
 * B-011 stable targetRef builder.
 *
 * Pure, synchronous, dependency-free helpers that derive a deterministic
 * `targetRef` for each high-value object surfaced by `read_page`. The
 * resulting value:
 *   - Stays the same across reloads, cosmetic class toggles, and minor
 *     ordering changes WHEN the underlying logical object is unchanged
 *     (same accessible name, role, link target, semantic sub-type).
 *   - Differs whenever any of the identity-bearing properties change in a
 *     way that would mean "this is a different object now".
 *   - Carries a tiny ordinal tiebreaker (0, 1, 2, ...) so visually
 *     identical siblings (e.g. two unlabelled icon buttons in the same
 *     toolbar) still receive distinct refs.
 *
 * The output is `tgt_<10-hex>` from a 53-bit cyrb53 hash. cyrb53 is chosen
 * over SHA-1 because the rest of the HVO pipeline is synchronous and
 * lives inside the background script — pulling in `crypto.subtle` would
 * force the entire build into async without measurable benefit at this
 * collision scale (10-hex of 53-bit space is plenty for snapshot-scoped
 * uniqueness).
 */

import { STABLE_TARGET_REF_PREFIX, type ReadPageHighValueObject } from '@tabrix/shared';

const STABLE_REF_HEX_LENGTH = 10;
const NORMALIZED_LABEL_MAX_LENGTH = 80;
const NORMALIZED_HREF_MAX_LENGTH = 80;

/**
 * Inputs needed to compute a stable targetRef. Exposed for tests so a
 * single object can be hashed without going through the full HVO pipeline.
 */
export interface StableTargetRefInputs {
  pageRole: string | null | undefined;
  objectSubType?: string | null;
  role?: string | null;
  label?: string | null;
  href?: string | null;
  /**
   * 0-based ordinal among objects sharing the same identity tuple
   * `(pageRole, objectSubType, role, normalizedLabel, hrefBucket)`.
   *
   * Most objects in real GitHub pages get ordinal=0 because their `href`
   * already disambiguates. Ordinal only matters for visually-duplicate
   * siblings.
   */
  ordinal: number;
}

const WHITESPACE_RE = /\s+/g;
const LEADING_TRAILING_SLASH_RE = /^\/+|\/+$/g;

export function normalizeLabel(input: unknown): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.replace(WHITESPACE_RE, ' ').trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.length <= NORMALIZED_LABEL_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, NORMALIZED_LABEL_MAX_LENGTH);
}

export function normalizeRole(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase();
}

export function normalizeSubType(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim();
}

export function normalizePageRole(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) return 'unknown';
  return input.trim();
}

/**
 * Reduce an `href` to a path-shape that is stable under host churn,
 * tracking parameters, and identity-prefix variation.
 *
 * Rules (intentionally tiny — B-011 v1 is not a full URL canonicalizer):
 *   1. Strip protocol+host so reloads via slightly different mirrors
 *      (e.g. `https://github.com` vs an in-app extension proxy) match.
 *   2. Drop the query string and fragment — these encode UI state, not
 *      object identity.
 *   3. Collapse `+` and `%20` runs to a single space marker (rare on
 *      GitHub but prevents obvious drift).
 *   4. Lowercase.
 *
 * Returns `''` for inputs that are not URL-shaped, so the hash key
 * gracefully degrades to label+role identity for non-link HVOs.
 */
export function normalizeHrefBucket(input: unknown): string {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  let pathish = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
      const u = new URL(
        trimmed.startsWith('//') ? `https:${trimmed}` : trimmed,
        'https://placeholder.invalid',
      );
      pathish = u.pathname || '/';
    } else {
      const hashIndex = trimmed.indexOf('#');
      const queryIndex = trimmed.indexOf('?');
      const cutIndex = [hashIndex, queryIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      pathish = cutIndex !== undefined ? trimmed.slice(0, cutIndex) : trimmed;
    }
  } catch {
    pathish = trimmed.split('#')[0].split('?')[0];
  }
  pathish = pathish.replace(LEADING_TRAILING_SLASH_RE, '/');
  if (pathish.length > NORMALIZED_HREF_MAX_LENGTH) {
    pathish = pathish.slice(0, NORMALIZED_HREF_MAX_LENGTH);
  }
  return pathish.toLowerCase();
}

/**
 * cyrb53 — small, fast, well-distributed non-crypto hash. Public-domain
 * algorithm by bryc (https://github.com/bryc). Chosen because:
 *   - synchronous + zero dependencies
 *   - 53-bit output gives ~10^16 buckets, ample for per-snapshot uniqueness
 *   - matches existing `userscript.ts` content-hashing style in this repo
 */
export function cyrb53(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function toHex(num: number, length: number): string {
  const hex = num.toString(16);
  if (hex.length >= length) return hex.slice(-length);
  return hex.padStart(length, '0');
}

/**
 * Compose the stable identity tuple. Exposed for tests so callers can
 * verify that two different inputs really do collapse onto the same key.
 */
export function buildStableKey(inputs: StableTargetRefInputs): string {
  const parts = [
    normalizePageRole(inputs.pageRole),
    normalizeSubType(inputs.objectSubType ?? ''),
    normalizeRole(inputs.role ?? ''),
    normalizeLabel(inputs.label ?? ''),
    normalizeHrefBucket(inputs.href ?? ''),
    String(Math.max(0, Math.floor(Number(inputs.ordinal) || 0))),
  ];
  return parts.join('\u0001');
}

/**
 * Compute a stable targetRef. Returns `tgt_<10-hex>` or `null` when the
 * input has no identity-bearing signal at all (no label, no role, no
 * href, no subType — extremely rare in practice).
 */
export function computeStableTargetRef(inputs: StableTargetRefInputs): string | null {
  const hasIdentitySignal = Boolean(
    normalizeLabel(inputs.label ?? '') ||
    normalizeRole(inputs.role ?? '') ||
    normalizeHrefBucket(inputs.href ?? '') ||
    normalizeSubType(inputs.objectSubType ?? ''),
  );
  if (!hasIdentitySignal) return null;
  const key = buildStableKey(inputs);
  const hash = cyrb53(key);
  return `${STABLE_TARGET_REF_PREFIX}${toHex(hash, STABLE_REF_HEX_LENGTH)}`;
}

/**
 * Assign stable targetRefs to a ranked list of HVOs in-place-style by
 * returning a new annotated array. Ordinals are computed automatically:
 * the first occurrence of an identity tuple is `0`, subsequent matches
 * get `1, 2, …`. Order of `objects` MUST be deterministic across
 * snapshots for ordinal stability — the read-page-task-protocol layer
 * already ensures this via `rankScoredObjects`.
 */
export function annotateStableTargetRefs<T extends ReadPageHighValueObject>(
  objects: readonly T[],
  pageRole: string | null,
): T[] {
  const counters = new Map<string, number>();
  const out: T[] = [];
  for (const obj of objects) {
    const baseKey = [
      normalizePageRole(pageRole),
      normalizeSubType(obj.objectSubType ?? ''),
      normalizeRole(obj.role ?? ''),
      normalizeLabel(obj.label ?? ''),
      normalizeHrefBucket(obj.href ?? ''),
    ].join('\u0001');
    const ordinal = counters.get(baseKey) ?? 0;
    counters.set(baseKey, ordinal + 1);
    const targetRef = computeStableTargetRef({
      pageRole,
      objectSubType: obj.objectSubType,
      role: obj.role,
      label: obj.label,
      href: obj.href,
      ordinal,
    });
    if (targetRef) {
      out.push({ ...obj, targetRef });
    } else {
      out.push(obj);
    }
  }
  return out;
}

/**
 * Build a compact `read://<host>/<pageRoleSlug>/<sha8>` style historyRef
 * so HVO targetRefs can be correlated back to the snapshot they were
 * first seen in. Pure helper kept here so it shares normalization with
 * the targetRef builder.
 */
export function buildHistoryRef(params: {
  url: string | null | undefined;
  pageRole: string | null | undefined;
  contentSeed?: string | null;
}): string | null {
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (!url) return null;
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.host || '';
    path = parsed.pathname || '/';
  } catch {
    host = 'local';
    path = url;
  }
  const slug = normalizePageRole(params.pageRole)
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase();
  const seed = `${host}\u0001${path}\u0001${slug}\u0001${params.contentSeed ?? ''}`;
  const hex = toHex(cyrb53(seed), 8);
  return `read://${host || 'local'}/${slug || 'unknown'}/${hex}`;
}
