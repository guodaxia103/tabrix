/**
 * V25-03 — Thin HTTP client for the native-server's `/execution/*`
 * read routes (see `app/native-server/src/server/execution-routes.ts`).
 *
 * Mirrors `memory-api-client.ts` so both sidepanel surfaces share a
 * single error model and base-URL resolution path. Reuses
 * `resolveMemoryApiBaseUrl` rather than re-implementing port discovery
 * — the routes live on the same fastify instance.
 */

import type {
  ExecutionRecentDecisionsResponseData,
  ExecutionReliabilitySignalSummary,
  ExecutionSavingsSummary,
  ExecutionTopActionPathsResponseData,
} from '@tabrix/shared';
import {
  EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
  EXECUTION_RECENT_DECISIONS_LIMIT_MAX,
  EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
  EXECUTION_TOP_ACTION_PATHS_LIMIT_MAX,
} from '@tabrix/shared';
import { MemoryApiError, resolveMemoryApiBaseUrl } from './memory-api-client';

export type ExecutionApiErrorKind = 'network' | 'http' | 'shape';

/** Re-export so callers can pattern-match on the same `.kind` taxonomy. */
export { MemoryApiError as ExecutionApiError };

export interface FetchExecutionRecentDecisionsOptions {
  limit?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

export async function fetchExecutionRecentDecisions(
  options: FetchExecutionRecentDecisionsOptions = {},
): Promise<ExecutionRecentDecisionsResponseData> {
  const limit = clampInt(
    options.limit ?? EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
    1,
    EXECUTION_RECENT_DECISIONS_LIMIT_MAX,
  );
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readOk<ExecutionRecentDecisionsResponseData>(
    `${base}/execution/decisions/recent?limit=${limit}`,
    options.signal,
  );
}

export interface FetchExecutionSummaryOptions {
  signal?: AbortSignal;
  baseUrl?: string;
}

export async function fetchExecutionSavingsSummary(
  options: FetchExecutionSummaryOptions = {},
): Promise<ExecutionSavingsSummary> {
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readOk<ExecutionSavingsSummary>(`${base}/execution/savings/summary`, options.signal);
}

export interface FetchExecutionTopActionPathsOptions {
  limit?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

export async function fetchExecutionTopActionPaths(
  options: FetchExecutionTopActionPathsOptions = {},
): Promise<ExecutionTopActionPathsResponseData> {
  const limit = clampInt(
    options.limit ?? EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
    1,
    EXECUTION_TOP_ACTION_PATHS_LIMIT_MAX,
  );
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readOk<ExecutionTopActionPathsResponseData>(
    `${base}/execution/action-paths/top?limit=${limit}`,
    options.signal,
  );
}

export async function fetchExecutionReliabilitySignals(
  options: FetchExecutionSummaryOptions = {},
): Promise<ExecutionReliabilitySignalSummary> {
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readOk<ExecutionReliabilitySignalSummary>(
    `${base}/execution/reliability/signals`,
    options.signal,
  );
}

async function readOk<TData>(url: string, signal?: AbortSignal): Promise<TData> {
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
  if (!isOkEnvelope<TData>(parsed)) {
    throw new MemoryApiError('shape', 'Unexpected response envelope shape', {
      httpStatus: response.status,
      body: parsed,
    });
  }
  return parsed.data;
}

function isOkEnvelope<TData>(value: unknown): value is { status: 'ok'; data: TData } {
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

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
