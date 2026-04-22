import type { ReadPageHighValueObject, ReadPageInteractiveElement } from '@tabrix/shared';

/**
 * V23-03 / B-015 Markdown projection of a `read_page` snapshot.
 *
 * Why this exists as a separate file:
 *   - keeps `read-page.ts` focused on the DOM/accessibility-tree path
 *   - makes the projection itself a pure function so it is unit-testable
 *     without spinning up the full content-script pipeline
 *   - enforces by construction the §4.3 invariant from
 *     `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md`: Markdown is a
 *     READING surface, never an execution surface. The projection
 *     intentionally does NOT include `ref` / `targetRef` values, so
 *     downstream LLMs cannot accidentally try to drive clicks from the
 *     Markdown body — they MUST go back to the JSON `highValueObjects` /
 *     `candidateActions` for execution.
 */

interface BuildMarkdownProjectionParams {
  url: string;
  title: string;
  pageRole: string;
  primaryRegion: string | null;
  highValueObjects: readonly ReadPageHighValueObject[];
  interactiveElements: readonly ReadPageInteractiveElement[];
}

const MAX_HVO_LINES = 8;
const MAX_INTERACTIVE_LINES = 16;
const LOCATOR_LIKE_TEXT_RE = /^(?:ref_[a-z0-9_]+|tgt_[0-9a-f]{10})$/i;

function escapeMarkdown(value: string): string {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeReadableText(value: string): string {
  const escaped = escapeMarkdown(value);
  return LOCATOR_LIKE_TEXT_RE.test(escaped) ? '' : escaped;
}

function formatHighValueObjectLine(item: ReadPageHighValueObject): string {
  const label = sanitizeReadableText(item.label);
  const role = escapeMarkdown(String(item.role || ''));
  const href = escapeMarkdown(String(item.href || ''));
  const parts: string[] = [];
  if (role) parts.push(role);
  if (label) parts.push(`"${label}"`);
  if (href) parts.push(`→ ${href}`);
  if (parts.length === 0) return '';
  return `- ${parts.join(' ')}`;
}

function formatInteractiveLine(item: ReadPageInteractiveElement): string {
  const role = escapeMarkdown(String(item.role || ''));
  const name = sanitizeReadableText(String(item.name || ''));
  const href = escapeMarkdown(String(item.href || ''));
  if (!role && !name) return '';
  const head = name ? `${role || 'element'} "${name}"` : role || 'element';
  return href ? `- ${head} → ${href}` : `- ${head}`;
}

/**
 * Build a Markdown projection from the structured layers.
 *
 * Contract guarantees:
 *   - returns `''` only when there is genuinely nothing to project (no
 *     title/url/HVOs/interactive elements). Callers MUST treat empty
 *     output as "Markdown projection unavailable for this snapshot",
 *     not as a successful empty page.
 *   - does NOT mutate any of its inputs.
 *   - never embeds DOM `ref` / stable `targetRef` values, so the output
 *     cannot be used as an execution locator (per §4.3).
 */
export function buildMarkdownProjection(params: BuildMarkdownProjectionParams): string {
  const title = escapeMarkdown(params.title);
  const url = escapeMarkdown(params.url);
  const pageRole = escapeMarkdown(params.pageRole);
  const primaryRegion = escapeMarkdown(String(params.primaryRegion || ''));

  const lines: string[] = [];

  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }

  const headerEntries: string[] = [];
  if (url) headerEntries.push(`URL: ${url}`);
  if (pageRole) headerEntries.push(`Page role: ${pageRole}`);
  if (primaryRegion) headerEntries.push(`Primary region: ${primaryRegion}`);
  if (headerEntries.length > 0) {
    lines.push(...headerEntries);
    lines.push('');
  }

  const hvoLines: string[] = [];
  for (const item of params.highValueObjects) {
    if (hvoLines.length >= MAX_HVO_LINES) break;
    const line = formatHighValueObjectLine(item);
    if (line) hvoLines.push(line);
  }
  if (hvoLines.length > 0) {
    lines.push('## Top objects');
    lines.push(...hvoLines);
    lines.push('');
  }

  // Interactive elements section is helpful for reading but secondary
  // to the curated HVO list. We still cap it tightly so a long page
  // does not blow the Markdown payload back up to JSON-sized cost.
  const seenLabels = new Set<string>();
  const interactiveLines: string[] = [];
  for (const item of params.interactiveElements) {
    if (interactiveLines.length >= MAX_INTERACTIVE_LINES) break;
    const dedupKey = `${String(item.role || '').toLowerCase()}|${String(item.name || '').toLowerCase()}`;
    if (seenLabels.has(dedupKey)) continue;
    seenLabels.add(dedupKey);
    const line = formatInteractiveLine(item);
    if (line) interactiveLines.push(line);
  }
  if (interactiveLines.length > 0) {
    lines.push('## Interactive elements');
    lines.push(...interactiveLines);
    lines.push('');
  }

  // Trailing blank lines are harmless but ugly; trim them so the
  // projection has a stable byte-count for callers that diff or hash it.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * V23-03 artifact-ref kind for the Markdown projection. Pure constant so
 * the click bridge / L2 routing can deterministically distinguish DOM
 * snapshot artifacts from Markdown projection artifacts without parsing
 * the URL.
 */
export const MARKDOWN_ARTIFACT_KIND = 'dom_markdown' as const;

export function buildMarkdownArtifactRef(tabId: number): string {
  const safeTabId = Number.isFinite(tabId) ? tabId : 0;
  return `artifact://read_page/tab-${safeTabId}/markdown`;
}
