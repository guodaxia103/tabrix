import { describe, expect, it } from 'vitest';
import { buildTaskProtocol } from '@/entrypoints/background/tools/browser/read-page-task-protocol';

describe('read_page task protocol', () => {
  it('prioritizes repo navigation over commit headlines on repo_home', () => {
    const protocol = buildTaskProtocol({
      mode: 'compact',
      currentUrl: 'https://github.com/example/project',
      currentTitle: 'example/project',
      pageType: 'web_page',
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      interactiveElements: [
        {
          ref: 'ref_commit',
          role: 'link',
          name: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
        },
        { ref: 'ref_issues', role: 'link', name: 'Issues' },
        { ref: 'ref_pulls', role: 'link', name: 'Pull requests' },
        { ref: 'ref_actions', role: 'link', name: 'Actions' },
      ],
      candidateActions: [
        {
          id: 'ca_click_ref_commit',
          actionType: 'click',
          targetRef: 'ref_commit',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [
            {
              type: 'aria',
              value: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
            },
          ],
        },
        {
          id: 'ca_click_ref_issues',
          actionType: 'click',
          targetRef: 'ref_issues',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Issues' }],
        },
        {
          id: 'ca_click_ref_actions',
          actionType: 'click',
          targetRef: 'ref_actions',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Actions' }],
        },
      ],
      artifactRefs: [
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
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
        refMapCount: 4,
        markedElementsCount: 0,
      },
      contentSummary: {
        charCount: 1000,
        normalizedLength: 900,
        lineCount: 24,
        quality: 'usable',
      },
    });

    expect(protocol.highValueObjects[0]?.label).toBe('Issues');
    expect(protocol.highValueObjects.slice(0, 3).map((item) => item.label)).toEqual([
      'Issues',
      'Pull requests',
      'Actions',
    ]);
    expect(protocol.L0.summary).toContain(
      'Primary repo entry points are Issues, Pull requests, Actions.',
    );
    expect(protocol.L0.summary).not.toContain('fix(t4): stabilize workflow run detail baseline');
  });

  it('injects repo task seeds when compact snapshot misses named repo tabs', () => {
    const protocol = buildTaskProtocol({
      mode: 'compact',
      currentUrl: 'https://github.com/example/project',
      currentTitle: 'example/project',
      pageType: 'web_page',
      pageRole: 'repo_home',
      primaryRegion: 'repo_primary_nav',
      interactiveElements: [
        { ref: 'ref_go_to_file', role: 'combobox', name: 'Go to file' },
        { ref: 'ref_watch', role: 'button', name: 'Watching a repository' },
        { ref: 'ref_branch', role: 'button', name: 'main branch' },
      ],
      candidateActions: [
        {
          id: 'ca_fill_ref_go_to_file',
          actionType: 'fill',
          targetRef: 'ref_go_to_file',
          confidence: 0.68,
          matchReason: 'form input candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Go to file' }],
        },
        {
          id: 'ca_click_ref_watch',
          actionType: 'click',
          targetRef: 'ref_watch',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Watching a repository' }],
        },
      ],
      artifactRefs: [
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
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
        refMapCount: 8,
        markedElementsCount: 0,
      },
      contentSummary: {
        charCount: 1000,
        normalizedLength: 900,
        lineCount: 24,
        quality: 'usable',
      },
    });

    expect(protocol.highValueObjects.slice(0, 3).map((item) => item.label)).toEqual([
      'Issues',
      'Pull requests',
      'Actions',
    ]);
    expect(protocol.L0.summary).toContain(
      'Primary repo entry points are Issues, Pull requests, Actions.',
    );
    expect(protocol.highValueObjects[3]?.label).toBe('Go to file');
  });
});
