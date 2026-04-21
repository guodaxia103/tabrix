/**
 * Thin HTTP client for the native-server's MKEP Memory read routes
 * (see `app/native-server/src/server/memory-routes.ts`).
 *
 * Design notes
 * ------------
 * - Pure functions only. No Vue imports, no reactive state. This lets
 *   the module be tested under `vitest` with a trivial `fetch` mock
 *   and reused by the Sidepanel composable **and** any future
 *   background/popup consumer.
 * - Base URL is derived from `chrome.storage.local.nativeServerPort`
 *   with the 12306 fallback used elsewhere in the extension (see
 *   `popup/App.vue → getServerBaseUrl`). Localhost reaches the server
 *   without a bearer token because the server's `onRequest` hook
 *   allows loopback IPs (see `app/native-server/src/server/index.ts`).
 * - Errors always surface as `MemoryApiError` so callers can branch on
 *   `.kind` ∈ `{network, http, shape}` instead of pattern-matching
 *   message strings.
 */

import type {
  MemoryExecutionStep,
  MemoryReadSuccess,
  MemorySessionStepsResponseData,
  MemorySessionsResponseData,
  MemoryTaskResponseData,
} from '@tabrix/shared';
import { STORAGE_KEYS } from './constants';

/** Fallback port matches the native-server default. */
export const DEFAULT_NATIVE_SERVER_PORT = 12306;

/** Default page size for `/memory/sessions`; mirrors server-side default. */
export const DEFAULT_SESSIONS_PAGE_SIZE = 20;

/**
 * Strongly-typed failure modes produced by this client. Callers use
 * `err.kind` to drive UI copy (offline vs. server-side error vs. bug).
 */
export type MemoryApiErrorKind = 'network' | 'http' | 'shape';

export class MemoryApiError extends Error {
  public readonly kind: MemoryApiErrorKind;
  public readonly httpStatus?: number;
  public readonly body?: unknown;

  constructor(
    kind: MemoryApiErrorKind,
    message: string,
    options: { httpStatus?: number; body?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'MemoryApiError';
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Resolve the local native-server base URL, respecting the user's
 * configured port. Falls back to 12306 whenever the storage API is
 * unavailable (tests, restricted contexts) or the stored value is
 * invalid.
 */
export async function resolveMemoryApiBaseUrl(): Promise<string> {
  const port = await readConfiguredPort();
  return `http://127.0.0.1:${port}`;
}

async function readConfiguredPort(): Promise<number> {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage || typeof storage.get !== 'function') {
    return DEFAULT_NATIVE_SERVER_PORT;
  }
  const raw = await new Promise<unknown>((resolve) => {
    try {
      const maybePromise = storage.get([STORAGE_KEYS.NATIVE_SERVER_PORT], (items) => {
        resolve(items?.[STORAGE_KEYS.NATIVE_SERVER_PORT]);
      }) as unknown;
      // Some polyfills make `.get` return a Promise instead of using
      // the callback. Resolve via whichever arrives first.
      if (isThenable(maybePromise)) {
        void maybePromise
          .then((items) => resolve(items?.[STORAGE_KEYS.NATIVE_SERVER_PORT]))
          .catch(() => resolve(undefined));
      }
    } catch {
      resolve(undefined);
    }
  });
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : DEFAULT_NATIVE_SERVER_PORT;
}

export interface FetchRecentSessionsOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
  /** Override the base URL. Useful for integration tests. */
  baseUrl?: string;
}

/** `GET /memory/sessions?limit=&offset=` */
export async function fetchRecentSessions(
  options: FetchRecentSessionsOptions = {},
): Promise<MemorySessionsResponseData> {
  const limit = clampInt(options.limit ?? DEFAULT_SESSIONS_PAGE_SIZE, 1, 500);
  const offset = clampInt(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER);
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  const url = `${base}/memory/sessions?limit=${limit}&offset=${offset}`;
  return readEnvelope<MemorySessionsResponseData>(url, options.signal);
}

export interface FetchSessionStepsOptions {
  signal?: AbortSignal;
  baseUrl?: string;
}

/** `GET /memory/sessions/:sessionId/steps` */
export async function fetchSessionSteps(
  sessionId: string,
  options: FetchSessionStepsOptions = {},
): Promise<MemorySessionStepsResponseData> {
  if (!sessionId) {
    throw new MemoryApiError('shape', 'sessionId is required');
  }
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  const url = `${base}/memory/sessions/${encodeURIComponent(sessionId)}/steps`;
  return readEnvelope<MemorySessionStepsResponseData>(url, options.signal);
}

export interface FetchTaskOptions {
  signal?: AbortSignal;
  baseUrl?: string;
}

/** `GET /memory/tasks/:taskId` */
export async function fetchMemoryTask(
  taskId: string,
  options: FetchTaskOptions = {},
): Promise<MemoryTaskResponseData> {
  if (!taskId) {
    throw new MemoryApiError('shape', 'taskId is required');
  }
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  const url = `${base}/memory/tasks/${encodeURIComponent(taskId)}`;
  return readEnvelope<MemoryTaskResponseData>(url, options.signal);
}

async function readEnvelope<TData>(url: string, signal?: AbortSignal): Promise<TData> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    throw new MemoryApiError('network', `Network error contacting ${url}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new MemoryApiError('shape', 'Response body was not valid JSON', {
      httpStatus: response.status,
      cause,
    });
  }

  if (!response.ok) {
    throw new MemoryApiError('http', extractErrorMessage(parsed, response.status), {
      httpStatus: response.status,
      body: parsed,
    });
  }

  if (!isMemorySuccessEnvelope<TData>(parsed)) {
    throw new MemoryApiError('shape', 'Unexpected response envelope shape', {
      httpStatus: response.status,
      body: parsed,
    });
  }

  return parsed.data;
}

function isMemorySuccessEnvelope<TData>(value: unknown): value is MemoryReadSuccess<TData> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'ok' &&
    'data' in (value as Record<string, unknown>)
  );
}

function extractErrorMessage(body: unknown, httpStatus: number): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { message?: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message;
  }
  return `HTTP ${httpStatus}`;
}

function isThenable(value: unknown): value is Promise<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Prefix that identifies a Memory "historyRef" inside the `artifactRefs`
 * array of a step. See `app/native-server/src/memory/page-snapshot-service.ts`
 * (`buildHistoryRef`) for the canonical producer.
 */
export const MEMORY_HISTORY_REF_PREFIX = 'memory://';

/**
 * Return the first `memory://…` entry from a step's `artifactRefs`.
 *
 * A step can carry multiple artifacts (e.g. `artifact://read_page/...`
 * alongside a `memory://snapshot/<uuid>`). The sidepanel only exposes
 * the *memory*-scheme ref because that's what re-resolves through the
 * MCP `getPageSnapshot` lookup — the `artifact://` kind is internal.
 *
 * Returns `null` when no memory ref is present; callers use that to
 * disable the "Copy historyRef" button rather than silently copying
 * an empty string.
 */
export function extractHistoryRef(step: Pick<MemoryExecutionStep, 'artifactRefs'>): string | null {
  if (!step?.artifactRefs || !Array.isArray(step.artifactRefs)) return null;
  for (const ref of step.artifactRefs) {
    if (typeof ref === 'string' && ref.startsWith(MEMORY_HISTORY_REF_PREFIX)) {
      return ref;
    }
  }
  return null;
}

/**
 * Best-effort copy to the system clipboard.
 *
 * We prefer `navigator.clipboard.writeText` because it works inside
 * the extension sidepanel origin without requiring a user gesture
 * on Chromium. Falls back to a hidden textarea + `document.execCommand`
 * when the async clipboard API is unavailable (older Chromium builds
 * or restricted iframes). Returns `true` on success, `false` on any
 * failure — callers surface that as UI feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
