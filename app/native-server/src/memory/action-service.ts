/**
 * ActionService — Memory Phase 0.3.
 *
 * Records DOM-interaction tool calls (`chrome_click_element`,
 * `chrome_fill_or_select`, `chrome_navigate`, `chrome_keyboard`) as
 * `memory_actions` rows and synthesizes a `memory://action/<uuid>`
 * historyRef.
 *
 * Design contract (mirrors Phase 0.2 / PageSnapshotService):
 * - **Defensive.** Any parsing / DB failure returns `null` and logs
 *   a single warning. The main tool-call path must never be blocked
 *   by Memory bookkeeping.
 * - **Never persists plaintext sensitive values.** For
 *   `chrome_fill_or_select`, the `value` arg is redacted into a
 *   summary `{kind, type, length, sha256}` and `result_blob` is
 *   omitted entirely because the extension's result message may
 *   echo the submitted value (see
 *   `.tmp/memory-phase-0-3/outputs/action-tools.md` §4).
 * - **pre_snapshot_ref** is looked up lazily via the injected
 *   `PageSnapshotRepository.findLatestInSessionForTab` query.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../logging/logger';
import type {
  ActionRepository,
  MemoryAction,
  MemoryActionKind,
  MemoryActionStatus,
  MemoryNavigateMode,
  PageSnapshotRepository,
} from './db';

const memoryLogger = logger.child('memory');

export interface RecordActionInput {
  stepId: string;
  sessionId: string;
  toolName: string;
  args: unknown;
  rawResult: CallToolResult;
  nowIso?: string;
}

export interface RecordActionResult {
  actionId: string;
  historyRef: string;
}

export const ACTION_KIND_BY_TOOL: Readonly<Record<string, MemoryActionKind>> = Object.freeze({
  chrome_click_element: 'click',
  chrome_fill_or_select: 'fill',
  chrome_navigate: 'navigate',
  chrome_keyboard: 'keyboard',
});

export function buildActionHistoryRef(actionId: string): string {
  return `memory://action/${actionId}`;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function pickBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === 'boolean' ? v : null;
}

function extractTextBody(rawResult: CallToolResult): string | null {
  if (!rawResult.content || !Array.isArray(rawResult.content) || rawResult.content.length === 0) {
    return null;
  }
  const first = rawResult.content[0] as { type?: string; text?: string };
  if (first?.type !== 'text' || typeof first?.text !== 'string') return null;
  return first.text;
}

function parseJsonBody(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Compute the value redaction summary for `chrome_fill_or_select`. We
 * deliberately throw away the plaintext and keep only a content-safe
 * fingerprint so downstream can (if ever needed) verify a literal
 * match without ever re-reading the original.
 */
export function redactFillValue(value: unknown): string {
  const type = value === null ? 'null' : typeof value;
  if (typeof value === 'string') {
    const sha256 = createHash('sha256').update(value).digest('hex');
    return JSON.stringify({ kind: 'redacted', type: 'string', length: value.length, sha256 });
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    const sha256 = createHash('sha256').update(String(value)).digest('hex');
    return JSON.stringify({ kind: 'redacted', type, sha256 });
  }
  return JSON.stringify({ kind: 'redacted', type });
}

function sanitizeArgs(toolName: string, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  const copy: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  if (toolName === 'chrome_fill_or_select' && 'value' in copy) {
    copy.value = '[redacted]';
  }
  return copy;
}

function inferNavigateMode(args: unknown): MemoryNavigateMode {
  if (!args || typeof args !== 'object') return 'url';
  const a = args as Record<string, unknown>;
  const refresh = pickBoolean(a, 'refresh');
  if (refresh === true) return 'refresh';
  const url = pickString(a, 'url');
  if (url === 'back') return 'back';
  if (url === 'forward') return 'forward';
  const newWindow = pickBoolean(a, 'newWindow');
  if (newWindow === true) return 'new_tab';
  return 'url';
}

function inferStatus(
  rawResult: CallToolResult,
  parsedBody: Record<string, unknown> | null,
): { status: MemoryActionStatus; errorCode: string | null } {
  if (rawResult.isError === true) {
    return { status: 'failed', errorCode: 'tool_error' };
  }
  if (parsedBody) {
    const successField = parsedBody['success'];
    if (successField === false) return { status: 'soft_failure', errorCode: 'soft_failure' };
  }
  return { status: 'success', errorCode: null };
}

/**
 * Extract the narrow set of action-specific fields that belong in
 * stable columns. Kept deliberately terse — anything not hit here
 * is preserved (with redactions) in `args_blob` / `result_blob`.
 */
function extractStableFields(
  kind: MemoryActionKind,
  args: Record<string, unknown>,
  parsedBody: Record<string, unknown> | null,
): {
  tabId: number | null;
  windowId: number | null;
  targetRef: string | null;
  targetSelector: string | null;
  targetFrameId: number | null;
  urlRequested: string | null;
  urlBefore: string | null;
  urlAfter: string | null;
  keySpec: string | null;
  valueSummary: string | null;
} {
  const tabId = pickNumber(args, 'tabId');
  const windowId = pickNumber(args, 'windowId');
  const targetRef = pickString(args, 'ref');
  const targetSelector = pickString(args, 'selector');
  const targetFrameId = pickNumber(args, 'frameId');
  const urlRequested = kind === 'navigate' ? pickString(args, 'url') : null;
  const urlAfter = parsedBody
    ? (pickString(parsedBody, 'finalUrl') ?? pickString(parsedBody, 'url'))
    : null;
  const keySpec = kind === 'keyboard' ? pickString(args, 'keys') : null;
  const valueSummary =
    kind === 'fill' && 'value' in args
      ? redactFillValue((args as { value?: unknown }).value)
      : null;
  return {
    tabId,
    windowId,
    targetRef,
    targetSelector,
    targetFrameId,
    urlRequested,
    urlBefore: null,
    urlAfter,
    keySpec,
    valueSummary,
  };
}

export function buildActionFromTool(params: {
  stepId: string;
  sessionId: string;
  toolName: string;
  args: unknown;
  rawResult: CallToolResult;
  preSnapshotRef: string | null;
  nowIso?: string;
}): MemoryAction | null {
  const kind = ACTION_KIND_BY_TOOL[params.toolName];
  if (!kind) return null;

  const rawArgs =
    params.args && typeof params.args === 'object' ? (params.args as Record<string, unknown>) : {};
  const bodyText = extractTextBody(params.rawResult);
  const parsedBody = bodyText ? parseJsonBody(bodyText) : null;
  const { status, errorCode } = inferStatus(params.rawResult, parsedBody);
  const stable = extractStableFields(kind, rawArgs, parsedBody);
  const navigateMode = kind === 'navigate' ? inferNavigateMode(rawArgs) : null;

  const sanitizedArgs = sanitizeArgs(params.toolName, rawArgs);
  const argsBlob = JSON.stringify(sanitizedArgs);
  const resultBlob = kind === 'fill' ? null : (bodyText ?? null);

  return {
    actionId: randomUUID(),
    stepId: params.stepId,
    sessionId: params.sessionId,
    toolName: params.toolName,
    actionKind: kind,
    navigateMode,
    tabId: stable.tabId,
    windowId: stable.windowId,
    targetRef: stable.targetRef,
    targetSelector: stable.targetSelector,
    targetFrameId: stable.targetFrameId,
    urlRequested: stable.urlRequested,
    urlBefore: stable.urlBefore,
    urlAfter: stable.urlAfter,
    keySpec: stable.keySpec,
    valueSummary: stable.valueSummary,
    status,
    errorCode,
    preSnapshotRef: params.preSnapshotRef,
    argsBlob,
    resultBlob,
    capturedAt: params.nowIso ?? new Date().toISOString(),
  };
}

export class ActionService {
  constructor(
    private readonly repo: ActionRepository,
    private readonly snapshots: PageSnapshotRepository,
  ) {}

  public recordFromToolCall(input: RecordActionInput): RecordActionResult | null {
    try {
      const kind = ACTION_KIND_BY_TOOL[input.toolName];
      if (!kind) return null;
      const capturedAt = input.nowIso ?? new Date().toISOString();

      const tabId = (() => {
        if (!input.args || typeof input.args !== 'object') return null;
        const v = (input.args as { tabId?: unknown }).tabId;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      })();

      let preSnapshotRef: string | null = null;
      if (tabId !== null) {
        const latest = this.snapshots.findLatestInSessionForTab({
          sessionId: input.sessionId,
          tabId,
          beforeIso: capturedAt,
        });
        if (latest) preSnapshotRef = `memory://snapshot/${latest.snapshotId}`;
      }

      const action = buildActionFromTool({
        stepId: input.stepId,
        sessionId: input.sessionId,
        toolName: input.toolName,
        args: input.args,
        rawResult: input.rawResult,
        preSnapshotRef,
        nowIso: capturedAt,
      });
      if (!action) return null;

      this.repo.insert(action);
      return { actionId: action.actionId, historyRef: buildActionHistoryRef(action.actionId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      memoryLogger.warn('action write failed', { errorMessage: message });
      return null;
    }
  }

  public listBySession(sessionId: string) {
    return this.repo.listBySession(sessionId);
  }

  public listByStep(stepId: string) {
    return this.repo.listByStep(stepId);
  }

  public get(actionId: string) {
    return this.repo.get(actionId);
  }

  public clear(): void {
    this.repo.clear();
  }
}
