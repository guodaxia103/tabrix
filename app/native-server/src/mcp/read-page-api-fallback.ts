import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiKnowledgeFetch, ApiKnowledgeReadFallback } from '../api/api-knowledge';

type ApiReadFallbackCause = 'api_timeout' | 'semantic_mismatch' | 'api_unavailable';
type AcceptanceApiFault = 'network_timeout' | 'semantic_mismatch';

export interface ApiReadFallbackEvidence {
  kind: 'read_page_fallback';
  readPageAvoided: false;
  sourceKind: 'dom_json';
  sourceRoute: string;
  fallbackCause: ApiReadFallbackCause;
  fallbackUsed: 'dom_compact';
  fallbackEntryLayer: 'L0+L1';
  apiFamily?: string;
  apiTelemetry: ApiKnowledgeReadFallback['telemetry'];
}

function estimateJsonTokens(value: unknown): number {
  try {
    return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
  } catch {
    return 0;
  }
}

export function estimateApiRowsTokenSavings(args: {
  rows: unknown[];
  rowCount: number;
  recordedFullReadTokenEstimate: number;
  /**
   * `true` iff the upstream reader returned ok with an empty row list.
   * When set, we short-circuit to the conservative
   * `'unavailable_empty_api_rows'` bucket regardless of any recorded
   * full-read estimate. Older logic could fall through to
   * `'full_read_estimate_minus_api_rows'` when the chooser had a
   * higher full-read estimate, which over-claimed token savings on
   * verified-empty answers.
   */
  emptyResult?: boolean;
}): {
  tokenEstimateChosen: number;
  tokenEstimateFullRead: number;
  tokensSavedEstimate: number;
  tokensSavedEstimateSource:
    | 'full_read_estimate_minus_api_rows'
    | 'api_rows_payload_floor'
    | 'unavailable_empty_api_rows';
} {
  const tokenEstimateChosen = estimateJsonTokens({
    kind: 'api_rows',
    rows: args.rows,
    rowCount: args.rowCount,
    compact: true,
  });
  // Verified-empty results MUST NOT inflate the tokens-saved estimate
  // off a hypothetical full-read estimate.
  // Short-circuit to the conservative bucket so Gate B / release
  // notes never claim savings for "the API answered with no rows".
  if (args.emptyResult || args.rowCount === 0) {
    return {
      tokenEstimateChosen,
      tokenEstimateFullRead: Math.max(0, Math.floor(args.recordedFullReadTokenEstimate)),
      tokensSavedEstimate: 0,
      tokensSavedEstimateSource: 'unavailable_empty_api_rows',
    };
  }
  if (args.recordedFullReadTokenEstimate > tokenEstimateChosen) {
    const tokenEstimateFullRead = Math.floor(args.recordedFullReadTokenEstimate);
    return {
      tokenEstimateChosen,
      tokenEstimateFullRead,
      tokensSavedEstimate: tokenEstimateFullRead - tokenEstimateChosen,
      tokensSavedEstimateSource: 'full_read_estimate_minus_api_rows',
    };
  }
  const rowsOnlyEstimate = estimateJsonTokens(args.rows);
  const tokenEstimateFullRead = tokenEstimateChosen + rowsOnlyEstimate;
  return {
    tokenEstimateChosen,
    tokenEstimateFullRead,
    tokensSavedEstimate: rowsOnlyEstimate,
    tokensSavedEstimateSource: 'api_rows_payload_floor',
  };
}

export function normalizeApiFallbackCause(reason: string | null | undefined): ApiReadFallbackCause {
  if (reason === 'network_timeout') return 'api_timeout';
  if (reason === 'semantic_mismatch') return 'semantic_mismatch';
  return 'api_unavailable';
}

export function readAcceptanceApiFault(args: unknown): AcceptanceApiFault | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const value = (args as { __tabrixAcceptanceApiFault?: unknown }).__tabrixAcceptanceApiFault;
  return value === 'network_timeout' || value === 'semantic_mismatch' ? value : null;
}

export function apiFaultFetchOverride(
  fault: AcceptanceApiFault | null,
): ApiKnowledgeFetch | undefined {
  if (fault !== 'network_timeout') return undefined;
  return () => new Promise(() => undefined);
}

export function apiFaultDataPurposeOverride(
  fault: AcceptanceApiFault | null,
  current: string | undefined,
): string | undefined {
  if (fault !== 'semantic_mismatch') return current;
  return current === 'issue_list' ? 'search_list' : 'issue_list';
}

export function stripInternalReadPageArgs(args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = { ...(args as Record<string, unknown>) };
  delete out.__tabrixAcceptanceApiFault;
  return out;
}

export function withFallbackEvidence(
  rawResult: CallToolResult,
  evidence: ApiReadFallbackEvidence | null,
): CallToolResult {
  if (!evidence || !Array.isArray(rawResult.content)) return rawResult;

  let attached = false;
  const content = rawResult.content.map((item) => {
    if (
      attached ||
      !item ||
      typeof item !== 'object' ||
      (item as { type?: unknown }).type !== 'text' ||
      typeof (item as { text?: unknown }).text !== 'string'
    ) {
      return item;
    }

    try {
      const parsed = JSON.parse((item as { text: string }).text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return item;
      attached = true;
      return {
        ...item,
        text: JSON.stringify({
          ...parsed,
          ...evidence,
        }),
      };
    } catch {
      return item;
    }
  });

  return attached ? { ...rawResult, content } : rawResult;
}
