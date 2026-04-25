/**
 * PageSnapshotService — Memory Phase 0.2.
 *
 * Parses `chrome_read_page` tool results and persists a structured
 * slice into `memory_page_snapshots`. Also synthesizes a
 * `historyRef` of the form `memory://snapshot/<uuid>` so downstream
 * callers get a stable handle to revisit the captured state.
 *
 * Design contract:
 * - Everything inside `recordFromReadPageResult` is defensive; any
 *   unexpected shape, JSON parse failure, or repo error results in
 *   `null` being returned and a one-line warning. The main tool
 *   result path must never be blocked by Memory bookkeeping.
 * - The service trims large fields aggressively. See
 *   `.tmp/memory-phase-0-2/outputs/readpage-shape.md` for the
 *   per-field rationale; the summary is:
 *   * Drop `fullSnapshot.*`, `memoryHints`, `frameContext` entirely.
 *   * Trim `interactiveElements` to the first 24 entries.
 *   * Keep `highValueObjects` slim (id/objectType/label/ref/...).
 */

import { randomUUID } from 'node:crypto';
import type { PageSnapshot, PageSnapshotRepository } from './db/page-snapshot-repository';

export interface RecordPageSnapshotInput {
  stepId: string;
  tabId?: number | null;
  /**
   * Raw `chrome_read_page` CallToolResult body. We accept `unknown`
   * so the caller does not have to re-assert types through the
   * post-processor boundary.
   */
  rawResult: unknown;
  /**
   * When provided, the service uses this value as `captured_at`.
   * Defaults to `new Date().toISOString()`.
   */
  nowIso?: string;
}

export interface RecordPageSnapshotResult {
  snapshotId: string;
  historyRef: string;
}

const MAX_INTERACTIVE_ELEMENTS = 24;
const HVO_SLIM_FIELDS = [
  'id',
  'kind',
  'label',
  'ref',
  'role',
  'actionType',
  'confidence',
  'objectType',
  'objectSubType',
  'region',
  'importance',
  'sourceKind',
] as const;

function safeParseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractTextBody(rawResult: unknown): string | null {
  if (!rawResult || typeof rawResult !== 'object') return null;
  const content = (rawResult as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (!first || typeof first !== 'object') return null;
  const type = (first as { type?: unknown }).type;
  const text = (first as { text?: unknown }).text;
  if (type !== 'text' || typeof text !== 'string') return null;
  return text;
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pickObject(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj[key];
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function pickArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}

function slimHighValueObject(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const src = entry as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of HVO_SLIM_FIELDS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return Object.keys(out).length > 0 ? out : null;
}

function stringifyOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function buildSnapshotFromReadPageBody(
  stepId: string,
  body: Record<string, unknown>,
  options?: { tabId?: number | null; nowIso?: string },
): PageSnapshot {
  const page = pickObject(body, 'page');
  const summary = pickObject(body, 'summary');
  const pageContext = pickObject(body, 'pageContext');
  const interactiveElements = pickArray(body, 'interactiveElements') ?? [];
  const candidateActions = pickArray(body, 'candidateActions') ?? [];
  const highValueObjects = pickArray(body, 'highValueObjects') ?? [];
  const l0 = pickObject(body, 'L0');
  const l1 = pickObject(body, 'L1');
  const l2 = pickObject(body, 'L2');

  const fallbackUsed = Boolean(pageContext && pageContext['fallbackUsed']);

  const trimmedInteractive = interactiveElements.slice(0, MAX_INTERACTIVE_ELEMENTS);
  const slimmedHvos = highValueObjects
    .map(slimHighValueObject)
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return {
    snapshotId: randomUUID(),
    stepId,
    tabId: options?.tabId ?? null,
    url: page ? pickString(page, 'url') : undefined,
    title: page ? pickString(page, 'title') : undefined,
    pageType: page ? pickString(page, 'pageType') : undefined,
    mode: pickString(body, 'mode'),
    pageRole: summary ? pickString(summary, 'pageRole') : undefined,
    primaryRegion: summary ? pickString(summary, 'primaryRegion') : undefined,
    quality: summary ? pickString(summary, 'quality') : undefined,
    taskMode: pickString(body, 'taskMode'),
    complexityLevel: pickString(body, 'complexityLevel'),
    sourceKind: pickString(body, 'sourceKind'),
    fallbackUsed,
    interactiveCount: interactiveElements.length,
    candidateActionCount: candidateActions.length,
    highValueObjectCount: highValueObjects.length,
    summaryBlob: stringifyOrNull(summary),
    pageContextBlob: stringifyOrNull(pageContext),
    highValueObjectsBlob: slimmedHvos.length > 0 ? JSON.stringify(slimmedHvos) : null,
    interactiveElementsBlob:
      trimmedInteractive.length > 0 ? JSON.stringify(trimmedInteractive) : null,
    candidateActionsBlob: candidateActions.length > 0 ? JSON.stringify(candidateActions) : null,
    protocolL0Blob: stringifyOrNull(l0),
    protocolL1Blob: stringifyOrNull(l1),
    protocolL2Blob: stringifyOrNull(l2),
    capturedAt: options?.nowIso ?? new Date().toISOString(),
  };
}

export function buildHistoryRef(snapshotId: string): string {
  return `memory://snapshot/${snapshotId}`;
}

export class PageSnapshotService {
  constructor(private readonly repo: PageSnapshotRepository) {}

  /**
   * Parse a `chrome_read_page` CallToolResult body and persist a
   * snapshot row. Returns `{ snapshotId, historyRef }` on success,
   * or `null` when the input cannot be parsed or persistence
   * fails. Callers must treat `null` as "keep going without
   * Memory", never as a fatal error.
   */
  public recordFromReadPageResult(input: RecordPageSnapshotInput): RecordPageSnapshotResult | null {
    try {
      const textBody = extractTextBody(input.rawResult);
      if (!textBody) return null;
      const parsed = safeParseJson(textBody);
      if (!parsed) return null;
      const snapshot = buildSnapshotFromReadPageBody(input.stepId, parsed, {
        tabId: input.tabId ?? null,
        nowIso: input.nowIso,
      });
      this.repo.insert(snapshot);
      return { snapshotId: snapshot.snapshotId, historyRef: buildHistoryRef(snapshot.snapshotId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.warn(`[tabrix/memory] page snapshot write failed: ${message}`);
      return null;
    }
  }

  public listByStep(stepId: string) {
    return this.repo.listByStep(stepId);
  }

  public get(snapshotId: string) {
    return this.repo.get(snapshotId);
  }

  /**
   * V26-04 (B-027): pass-through readers used by
   * `LivePageContextProvider`. We expose them on the service rather
   * than handing the repository out so the public boundary stays
   * "PageSnapshotService is the only Memory façade".
   */
  public findLatestForUrl(url: string) {
    return this.repo.findLatestForUrl(url);
  }

  public findLatestForPageRole(pageRole: string) {
    return this.repo.findLatestForPageRole(pageRole);
  }

  public findLatestGlobal() {
    return this.repo.findLatestGlobal();
  }

  public clear(): void {
    this.repo.clear();
  }
}
