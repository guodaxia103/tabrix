/**
 * V23-03 / B-015 — render='markdown' projection contract tests.
 *
 * Why these tests exist:
 *
 *   The Markdown projection is a *reading* surface (per
 *   `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §4.3). It must:
 *
 *     1. Render top objects + interactive labels in human-readable form.
 *     2. Preserve title / URL / page-role context so an LLM reading
 *        only the markdown still knows where it is.
 *     3. NEVER embed `ref` / stable `targetRef` values, so downstream
 *        callers cannot accidentally route clicks through the markdown.
 *        The JSON HVOs / candidateActions / targetRef remain the
 *        execution truth (§4.1) and are unchanged by render mode.
 *     4. Stay bounded — a long page must not blow markdown back up to
 *        JSON-sized cost, otherwise the whole "low-token reading
 *        surface" rationale is gone.
 *
 *   Without these tests it is easy for a well-meaning future change to
 *   "enrich" the markdown with refs (breaking §4.3) or to drop the
 *   header context (regressing the reading-surface use case).
 */

import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_ARTIFACT_KIND,
  buildMarkdownArtifactRef,
  buildMarkdownProjection,
} from '@/entrypoints/background/tools/browser/read-page-markdown';

describe('read_page render=markdown projection', () => {
  it('renders title, URL, page role, top objects and interactive elements', () => {
    const md = buildMarkdownProjection({
      url: 'https://github.com/example/project',
      title: 'example/project: A demo repo',
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      highValueObjects: [
        {
          id: 'hvo_1',
          kind: 'page_role_seed',
          label: 'Issues',
          role: 'link',
          reason: 'top nav tab',
          href: 'https://github.com/example/project/issues',
          targetRef: 'tgt_abcdef0123',
        },
        {
          id: 'hvo_2',
          kind: 'interactive_element',
          label: 'Pull requests',
          role: 'link',
          reason: 'top nav tab',
          href: 'https://github.com/example/project/pulls',
          targetRef: 'tgt_1234567890',
        },
      ],
      interactiveElements: [
        { ref: 'ref_a', role: 'link', name: 'Code' },
        { ref: 'ref_b', role: 'button', name: 'Watch' },
      ],
    });

    expect(md).toContain('# example/project: A demo repo');
    expect(md).toContain('URL: https://github.com/example/project');
    expect(md).toContain('Page role: repo_home');
    expect(md).toContain('Primary region: repo_primary_nav');
    expect(md).toContain('## Top objects');
    expect(md).toContain('"Issues"');
    expect(md).toContain('"Pull requests"');
    expect(md).toContain('## Interactive elements');
    expect(md).toMatch(/"Code"/);
    expect(md).toMatch(/"Watch"/);
  });

  it('never embeds DOM ref or stable targetRef in the markdown body', () => {
    const md = buildMarkdownProjection({
      url: 'https://github.com/example/project',
      title: 'example/project',
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      highValueObjects: [
        {
          id: 'hvo_1',
          kind: 'page_role_seed',
          label: 'Issues',
          role: 'link',
          reason: 'top nav tab',
          ref: 'ref_must_not_leak',
          href: 'https://github.com/example/project/issues',
          targetRef: 'tgt_must_not_leak',
        },
      ],
      interactiveElements: [{ ref: 'ref_b_must_not_leak', role: 'button', name: 'Watch' }],
    });

    // §4.3 invariant: markdown is a reading surface, NOT an execution
    // surface. If any of these substrings show up, an upstream LLM
    // could reconstruct a click locator from markdown alone, which is
    // exactly what V23-03 is designed to prevent.
    expect(md).not.toContain('tgt_must_not_leak');
    expect(md).not.toContain('ref_must_not_leak');
    expect(md).not.toContain('ref_b_must_not_leak');
  });

  it('strips locator-like labels so execution refs cannot leak through display text', () => {
    const md = buildMarkdownProjection({
      url: 'https://github.com/example/project',
      title: 'example/project',
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      highValueObjects: [
        {
          id: 'hvo_1',
          kind: 'candidate_action',
          label: 'ref_5',
          role: 'link',
          reason: 'candidate action fallback',
          href: '/example/project',
        },
        {
          id: 'hvo_2',
          kind: 'interactive_element',
          label: 'tgt_38bdacc401',
          role: 'link',
          reason: 'stable target ref accidentally surfaced as label',
          href: '/example/project/issues',
        },
      ],
      interactiveElements: [
        { ref: 'ref_ok', role: 'button', name: 'ref_4' },
        { ref: 'ref_ok_2', role: 'link', name: 'tgt_1234567890', href: '/issues' },
      ],
    });

    expect(md).not.toContain('ref_5');
    expect(md).not.toContain('ref_4');
    expect(md).not.toContain('tgt_38bdacc401');
    expect(md).not.toContain('tgt_1234567890');
    expect(md).toContain('- link → /example/project');
    expect(md).toContain('- link → /issues');
    expect(md).toContain('- button');
  });

  it('returns "" when the snapshot has no projectable signal so callers can detect "markdown unavailable"', () => {
    const md = buildMarkdownProjection({
      url: '',
      title: '',
      pageRole: '',
      primaryRegion: null,
      highValueObjects: [],
      interactiveElements: [],
    });

    expect(md).toBe('');
  });

  it('caps the projected lists so a high-cardinality page does not blow markdown back up to JSON cost', () => {
    const manyHVOs = Array.from({ length: 50 }).map((_, i) => ({
      id: `hvo_${i}`,
      kind: 'interactive_element' as const,
      label: `Object ${i}`,
      role: 'link',
      reason: 'noise',
    }));
    const manyInteractives = Array.from({ length: 80 }).map((_, i) => ({
      ref: `ref_${i}`,
      role: 'link',
      name: `Item ${i}`,
    }));

    const md = buildMarkdownProjection({
      url: 'https://example.com/list',
      title: 'Big List',
      pageRole: 'web_page',
      primaryRegion: null,
      highValueObjects: manyHVOs,
      interactiveElements: manyInteractives,
    });

    // Hard upper bound on bullets to keep markdown a cheap reading
    // surface. Numbers come from MAX_HVO_LINES (8) +
    // MAX_INTERACTIVE_LINES (16) inside read-page-markdown.ts.
    const bulletCount = (md.match(/^- /gm) || []).length;
    expect(bulletCount).toBeLessThanOrEqual(8 + 16);
  });

  it('builds a deterministic markdown artifact ref so the click bridge can distinguish it from DOM snapshots', () => {
    expect(MARKDOWN_ARTIFACT_KIND).toBe('dom_markdown');
    expect(buildMarkdownArtifactRef(7)).toBe('artifact://read_page/tab-7/markdown');
    // Defensive on bad tabId (e.g. NaN / undefined casts) — must still
    // produce a stable, parseable artifact URL rather than something
    // like `artifact://read_page/tab-NaN/markdown` that would silently
    // collide across tabs in the registry.
    expect(buildMarkdownArtifactRef(Number.NaN as unknown as number)).toBe(
      'artifact://read_page/tab-0/markdown',
    );
  });
});
