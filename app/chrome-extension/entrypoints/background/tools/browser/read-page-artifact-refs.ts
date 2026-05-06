import type { ReadPageArtifactRef } from '@tabrix/shared';
import { buildMarkdownArtifactRef, MARKDOWN_ARTIFACT_KIND } from './read-page-markdown';

export type SnapshotArtifactRef = ReadPageArtifactRef;

export function buildArtifactRefs(tabId: number, includeMarkdown: boolean): SnapshotArtifactRef[] {
  const safeTabId = Number.isFinite(tabId) ? tabId : 0;
  const refs: SnapshotArtifactRef[] = [
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/normal` },
    { kind: 'dom_snapshot', ref: `artifact://read_page/tab-${safeTabId}/full` },
  ];
  if (includeMarkdown) {
    refs.push({ kind: MARKDOWN_ARTIFACT_KIND, ref: buildMarkdownArtifactRef(safeTabId) });
  }
  return refs;
}
