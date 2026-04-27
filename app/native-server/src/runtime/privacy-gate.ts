/**
 * V27-00 — Tabrix v2.7 Privacy Gate library.
 *
 * Goal: every v2.7 observation persistence path (operation log, in-memory
 * fact ring, Gate B evidence transformer) MUST funnel its record through
 * `redactForPersistence` so a regression that introduces a `cookie`,
 * `Authorization`, raw response body, or value-shaped string cannot land
 * unredacted. The library is types + pure functions only — no I/O, no
 * repository imports — so it is safe to call from both runtime and tests.
 *
 * Boundary:
 * - The gate REDACTS, it does not deny. The redacted record stays
 *   structurally identical to the input (same keys, same shape) so the
 *   downstream writer does not need to special-case redaction. Sensitive
 *   keys are dropped; sensitive scalar values are replaced with the
 *   sentinel `'[redacted]'`.
 * - The gate is closed-allowlist for headers and closed-blocklist for
 *   keys. Adding a new sensitive shape MUST happen here; callers do not
 *   get to opt opaque envelopes through.
 * - `assertNoSensitive` is the test-side companion: it throws so a unit
 *   test reproduces the exact key path that leaked.
 *
 * Cross-ref:
 * - SoT: `.claude/strategy/TABRIX_V2_7_CONTRACT_V1_zh.md` §4.
 * - Allowlist source: `app/native-server/src/memory/db/operation-log-metadata.ts`.
 */

const REDACTED = '[redacted]' as const;
export type RedactedSentinel = typeof REDACTED;

/**
 * Closed list of header names that MUST never reach persistence. Names
 * are matched case-insensitively. The list also covers the common
 * suffix patterns (`*-token`, `*-secret`, `*-key`) and prefix
 * (`x-auth-*`) via {@link isSensitiveHeaderName}.
 */
const SENSITIVE_HEADER_EXACT = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
]);

const SENSITIVE_HEADER_SUFFIXES = ['-token', '-secret', '-key'] as const;
const SENSITIVE_HEADER_PREFIXES = ['x-auth-', 'x-api-'] as const;

export function isSensitiveHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (SENSITIVE_HEADER_EXACT.has(normalized)) return true;
  for (const suffix of SENSITIVE_HEADER_SUFFIXES) {
    if (normalized.endsWith(suffix)) return true;
  }
  for (const prefix of SENSITIVE_HEADER_PREFIXES) {
    if (normalized.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Closed list of object keys that v2.7 observation MUST never persist.
 * Either the key carries raw user content (request/response body), a
 * non-stable browser id (`tabId`, `windowId`, `frameId`, `refId`,
 * `nodeId`), or a query/url surface that has not been pre-summarised
 * to `urlPattern`.
 */
const SENSITIVE_KEY_NAMES = new Set([
  // Raw bodies / texts
  'requestBody',
  'responseBody',
  'body',
  'payloadBody',
  'rawBody',
  'responseText',
  'requestText',
  'rawResponse',
  'rawRequest',
  // URL surfaces with query strings
  'url',
  'href',
  'search',
  'queryString',
  // Browser-side ids the operation log must not mirror verbatim
  'tabId',
  'windowId',
  'frameId',
  'refId',
  'nodeId',
]);

export function isSensitiveKeyName(name: string): boolean {
  return SENSITIVE_KEY_NAMES.has(name);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone-shaped: optional `+`, then 8+ digits possibly separated by space / `-` / `()` / `.`.
const PHONE_RE = /^\+?\d[\d\s().-]{7,}$/;
// Long opaque token: 32+ alnum / `_` / `-`. Tabrix-issued short ids are
// shorter (< 24 chars) so a 32+ run is treated as an external secret.
const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;
// Credit-card-shaped: 13–19 digits possibly separated by space / `-`.
const CREDIT_CARD_RE = /^\d(?:[\d\s-]{11,21}\d)$/;

/**
 * Heuristic: a string value looks sensitive (PII or secret) and should
 * be replaced with `'[redacted]'`. The classifier is intentionally
 * conservative — false positives only cost us a `[redacted]` in
 * evidence; false negatives leak data.
 */
export function isSensitiveValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (EMAIL_RE.test(trimmed)) return true;
  if (PHONE_RE.test(trimmed) && /\d{8,}/.test(trimmed.replace(/\D/g, ''))) return true;
  if (TOKEN_RE.test(trimmed)) return true;
  if (CREDIT_CARD_RE.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19) return true;
  }
  return false;
}

/** Closed-enum descriptor of *what* is being redacted. */
export type PrivacyGateRecordKind =
  | 'operation_log_metadata'
  | 'fact_snapshot'
  | 'lifecycle_event'
  | 'action_outcome'
  | 'tab_event'
  | 'generic';

interface RedactOptions {
  kind: PrivacyGateRecordKind;
}

const MAX_DEPTH = 8;

/**
 * Return a fresh deep-cloned record with all sensitive surfaces
 * stripped or replaced. Strategy:
 * - If a key is in {@link SENSITIVE_KEY_NAMES}, drop it.
 * - If the value is an object/array, recurse (capped at {@link MAX_DEPTH}).
 * - If the value is a string and looks sensitive per
 *   {@link isSensitiveValue}, replace with `'[redacted]'`.
 * - If the field name resembles an HTTP header bag (`headers`,
 *   `requestHeaders`, `responseHeaders`), filter sensitive header
 *   names per {@link isSensitiveHeaderName}.
 *
 * The returned object is structurally a fresh value — the caller is
 * free to mutate / persist it.
 */
export function redactForPersistence<T>(record: T, options: RedactOptions): T {
  return redactInner(record, options.kind, 0) as T;
}

function redactInner(value: unknown, kind: PrivacyGateRecordKind, depth: number): unknown {
  if (depth >= MAX_DEPTH) return null;
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    return isSensitiveValue(value) ? REDACTED : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactInner(entry, kind, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of entries) {
      if (isSensitiveKeyName(key)) continue;
      if (isHeaderBagKey(key) && raw && typeof raw === 'object') {
        out[key] = redactHeaderBag(raw as Record<string, unknown>);
        continue;
      }
      out[key] = redactInner(raw, kind, depth + 1);
    }
    return out;
  }
  return null;
}

function isHeaderBagKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'headers' || normalized === 'requestheaders' || normalized === 'responseheaders'
  );
}

function redactHeaderBag(bag: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(bag)) {
    if (isSensitiveHeaderName(name)) continue;
    if (typeof raw === 'string') {
      out[name] = isSensitiveValue(raw) ? REDACTED : raw;
    } else {
      out[name] = redactInner(raw, 'generic', 1);
    }
  }
  return out;
}

/** Result of {@link findSensitivePaths}. */
export interface SensitiveLeak {
  path: string;
  reason: 'sensitive_key_name' | 'sensitive_header_name' | 'sensitive_value_shape';
}

/**
 * Walk the input record and return every path whose key/value would be
 * stripped/redacted by {@link redactForPersistence}. Paths use a dotted
 * form (`metadata.headers.cookie`, `payload.0.responseBody`, …). Used
 * by {@link assertNoSensitive} and by the unit tests so a regression
 * pinpoints the offending key path instead of just failing equality.
 */
export function findSensitivePaths(record: unknown): SensitiveLeak[] {
  const out: SensitiveLeak[] = [];
  walk(record, '', 0, out);
  return out;
}

function walk(value: unknown, path: string, depth: number, out: SensitiveLeak[]): void {
  if (depth >= MAX_DEPTH) return;
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (isSensitiveValue(value)) out.push({ path, reason: 'sensitive_value_shape' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => walk(entry, `${path}.${i}`, depth + 1, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const here = path.length === 0 ? key : `${path}.${key}`;
      if (isSensitiveKeyName(key)) {
        out.push({ path: here, reason: 'sensitive_key_name' });
        continue;
      }
      if (isHeaderBagKey(key) && raw && typeof raw === 'object') {
        for (const [headerName, headerVal] of Object.entries(raw as Record<string, unknown>)) {
          const headerPath = `${here}.${headerName}`;
          if (isSensitiveHeaderName(headerName)) {
            out.push({ path: headerPath, reason: 'sensitive_header_name' });
            continue;
          }
          if (typeof headerVal === 'string' && isSensitiveValue(headerVal)) {
            out.push({ path: headerPath, reason: 'sensitive_value_shape' });
          }
        }
        continue;
      }
      walk(raw, here, depth + 1, out);
    }
  }
}

/** Throws an Error listing every sensitive path. Test-side companion. */
export function assertNoSensitive(record: unknown): void {
  const leaks = findSensitivePaths(record);
  if (leaks.length === 0) return;
  const summary = leaks.map((leak) => `${leak.path || '<root>'} (${leak.reason})`).join(', ');
  throw new Error(`PrivacyGate: sensitive content detected at: ${summary}`);
}

export const PRIVACY_REDACTED_SENTINEL: RedactedSentinel = REDACTED;
