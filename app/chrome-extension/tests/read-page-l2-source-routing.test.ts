/**
 * V23-03 / B-015 — L2 source routing contract tests.
 *
 * Why these tests exist:
 *
 *   `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §11.5 says the L2
 *   layer of the read_page task protocol must explicitly route callers
 *   to the *right* deeper source instead of dumping all sources at once.
 *   Concretely:
 *
 *     - DOM JSON is always available (it is the execution truth, §4.1)
 *       so `domJsonRef` MUST always be populated when a DOM snapshot
 *       artifact is present.
 *     - Markdown projection is opt-in via `read_page(render='markdown')`
 *       so `markdownRef` MUST be `null` by default and populated only
 *       when the upstream caller explicitly requested Markdown.
 *     - API Knowledge (B-017) does not yet have a runtime call surface
 *       so `knowledgeRef` MUST be `null` until that lands. We assert it
 *       so a future accidental "leak" of half-implemented knowledge
 *       routing is caught here.
 *
 *   Without these tests it is easy to regress L2 back to "emit all
 *   refs in `detailRefs`" which would silently re-couple Markdown and
 *   API Knowledge to the JSON path and undo the §11.5 invariant.
 */

import { describe, expect, it } from 'vitest';
import { buildTaskProtocol } from '@/entrypoints/background/tools/browser/read-page-task-protocol';

function createBaseParams(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'compact' as const,
    currentUrl: 'https://example.com/',
    currentTitle: 'Example',
    pageType: 'web_page',
    pageRole: 'web_page',
    primaryRegion: null,
    interactiveElements: [
      { ref: 'ref_a', role: 'link', name: 'Read more' },
      { ref: 'ref_b', role: 'button', name: 'Subscribe' },
    ] as any[],
    candidateActions: [
      {
        id: 'ca_click_ref_a',
        actionType: 'click',
        targetRef: 'ref_a',
        confidence: 0.8,
        matchReason: 'interactive clickable candidate from structured snapshot',
        locatorChain: [{ type: 'aria', value: 'Read more' }],
      },
    ] as any[],
    artifactRefs: [
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-7/normal' },
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-7/full' },
    ],
    pageContext: {
      filter: 'interactive',
      depth: 3,
      focus: null,
      scheme: 'https',
      viewport: { width: 1280, height: 720, dpr: 1 },
      sparse: false,
      fallbackUsed: false,
      fallbackSource: null,
      refMapCount: 2,
      markedElementsCount: 0,
    },
    contentSummary: {
      charCount: 1000,
      normalizedLength: 900,
      lineCount: 24,
      quality: 'usable',
    },
    ...overrides,
  };
}

describe('read_page L2 source routing (V23-03 §11.5)', () => {
  it('populates domJsonRef from the first dom_snapshot artifact and leaves markdown/knowledge null by default', () => {
    const protocol = buildTaskProtocol(createBaseParams());

    expect(protocol.L2.available).toBe(true);
    expect(protocol.L2.domJsonRef).toBe('artifact://read_page/tab-7/normal');
    expect(protocol.L2.markdownRef).toBeNull();
    expect(protocol.L2.knowledgeRef).toBeNull();
    // Backwards-compat: legacy `detailRefs` still enumerates raw refs so
    // callers on the v1 shape do not break, but the strongly-typed
    // routing fields are now the canonical surface.
    expect(protocol.L2.detailRefs).toContain('artifact://read_page/tab-7/normal');
    expect(protocol.L2.expansions).toContain('dom_snapshot');
    expect(protocol.L2.expansions).not.toContain('readable_markdown');
  });

  it('populates markdownRef only when read-page passes a markdownArtifactRef and adds readable_markdown to expansions', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        artifactRefs: [
          { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-7/normal' },
          { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-7/full' },
          { kind: 'dom_markdown', ref: 'artifact://read_page/tab-7/markdown' },
        ],
        markdownArtifactRef: 'artifact://read_page/tab-7/markdown',
      }),
    );

    expect(protocol.L2.domJsonRef).toBe('artifact://read_page/tab-7/normal');
    expect(protocol.L2.markdownRef).toBe('artifact://read_page/tab-7/markdown');
    expect(protocol.L2.knowledgeRef).toBeNull();
    expect(protocol.L2.expansions).toEqual(
      expect.arrayContaining(['dom_snapshot', 'readable_markdown']),
    );
  });

  it('keeps markdownRef null when the markdown artifact is in artifactRefs but the caller did not request markdown', () => {
    // Defensive: the protocol layer must NOT auto-discover markdown
    // from artifactRefs alone. Only an explicit markdownArtifactRef
    // (set by read-page.ts when render='markdown') should flip the
    // routing on. This guards against a future refactor that
    // "helpfully" auto-routes Markdown for json-mode callers and
    // silently re-couples reading + execution surfaces.
    const protocol = buildTaskProtocol(
      createBaseParams({
        artifactRefs: [
          { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-7/normal' },
          { kind: 'dom_markdown', ref: 'artifact://read_page/tab-7/markdown' },
        ],
        // markdownArtifactRef intentionally omitted
      }),
    );

    expect(protocol.L2.markdownRef).toBeNull();
    expect(protocol.L2.expansions).not.toContain('readable_markdown');
  });

  it('inline_full_snapshot defaultAccess only kicks in for mode="full"', () => {
    const compact = buildTaskProtocol(createBaseParams({ mode: 'compact' as const }));
    const full = buildTaskProtocol(createBaseParams({ mode: 'full' as const }));

    expect(compact.L2.defaultAccess).toBe('artifact_ref');
    expect(full.L2.defaultAccess).toBe('inline_full_snapshot');
  });
});
