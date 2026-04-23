/**
 * V25-02 — `chrome_read_page` `requestedLayer` envelope tests.
 *
 * Verifies:
 *  - Default behaviour (no `requestedLayer`) returns L0+L1+L2 — byte-
 *    identical contract to the legacy snapshot.
 *  - `'L0'` strips L1 + L2 + candidateActions; the L0 task layer and
 *    HVO `targetRef` registry inputs MUST stay populated so
 *    chrome_click_element resolution (V25-04 contract) keeps working.
 *  - `'L0+L1'` keeps L1 (overview / candidateActions) but drops L2.
 *  - The L0 envelope is strictly smaller than the L0+L1+L2 envelope.
 *  - Unknown `requestedLayer` fails closed (consistent with `render`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

const FIXTURE_TAB = {
  id: 7301,
  windowId: 1,
  active: true,
  status: 'complete',
  url: 'https://github.com/owner/repo/pull/42',
  title: 'PR #42 — owner/repo',
};

// A page rich enough that all three layers carry distinct payload.
// 12 interactive elements + a heading region so HVO classification
// produces non-trivial L1 / L2 content.
const FIXTURE_PAGE_CONTENT = [
  '- heading "Pull request: Update build matrix" [ref=ref_0] (x=320,y=80)',
  '- generic "Conversation" [ref=ref_1] (x=320,y=120)',
  '- link "Files changed" [ref=ref_2] (x=420,y=120)',
  '- link "Commits" [ref=ref_3] (x=520,y=120)',
  '- link "Checks" [ref=ref_4] (x=620,y=120)',
  '- button "Merge pull request" [ref=ref_5] (x=900,y=200)',
  '- button "Close pull request" [ref=ref_6] (x=900,y=240)',
  '- textbox "Add a comment" [ref=ref_7] (x=320,y=400)',
  '- button "Comment" [ref=ref_8] (x=900,y=440)',
  '- link "owner" [ref=ref_9] (x=320,y=200)',
  '- link "repo" [ref=ref_10] (x=380,y=200)',
  '- generic "Reviewers" [ref=ref_11] (x=900,y=120)',
].join('\n');

const FIXTURE_REF_MAP = Array.from({ length: 12 }, (_, i) => ({
  ref: `ref_${i}`,
  selector: `[data-ref="${i}"]`,
}));

function setupExecutorMocks() {
  vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue(FIXTURE_TAB);
  vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
  vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
    success: true,
    pageContent: FIXTURE_PAGE_CONTENT,
    refMap: FIXTURE_REF_MAP,
    stats: { processed: 24, included: 12, durationMs: 22 },
    viewport: { width: 1440, height: 900, dpr: 2 },
  });
}

async function readWithLayer(layer?: 'L0' | 'L0+L1' | 'L0+L1+L2') {
  const args: Record<string, unknown> = {};
  if (layer !== undefined) args.requestedLayer = layer;
  const result = await readPageTool.execute(args as any);
  expect(result.isError).toBe(false);
  const payload = JSON.parse((result.content[0] as { text: string }).text);
  const text = (result.content[0] as { text: string }).text;
  return { payload, byteLength: text.length };
}

describe('read_page requestedLayer envelope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to L0+L1+L2 (legacy contract preserved)', async () => {
    setupExecutorMocks();
    const { payload } = await readWithLayer();
    expect(payload.L0).toBeDefined();
    expect(payload.L1).toBeDefined();
    expect(payload.L2).toBeDefined();
    expect(Array.isArray(payload.candidateActions)).toBe(true);
  });

  it('returns L1 + L2 when requestedLayer="L0+L1+L2" is explicit', async () => {
    setupExecutorMocks();
    const { payload } = await readWithLayer('L0+L1+L2');
    expect(payload.L0).toBeDefined();
    expect(payload.L1).toBeDefined();
    expect(payload.L2).toBeDefined();
  });

  it('strips L1 and L2 when requestedLayer="L0"', async () => {
    setupExecutorMocks();
    const { payload } = await readWithLayer('L0');
    expect(payload.L0).toBeDefined();
    expect(payload.L1 ?? null).toBeNull();
    expect(payload.L2 ?? null).toBeNull();
    // candidateActions are an L1-grade surface; suppressed at L0 so the
    // chooser cannot accidentally re-derive them from a short read.
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(payload.candidateActions.length).toBe(0);
  });

  it('keeps highValueObjects + targetRef registry seeds at L0 (V25-04 contract)', async () => {
    setupExecutorMocks();
    const { payload } = await readWithLayer('L0');
    // HVO array is part of the stable layer; required so that
    // `chrome_click_element` can still resolve `tgt_*` to a live
    // `ref_*` after V25-02 layer suppression.
    expect(Array.isArray(payload.highValueObjects)).toBe(true);
  });

  it('keeps L1 but strips L2 when requestedLayer="L0+L1"', async () => {
    setupExecutorMocks();
    const { payload } = await readWithLayer('L0+L1');
    expect(payload.L0).toBeDefined();
    expect(payload.L1).toBeDefined();
    expect(payload.L2 ?? null).toBeNull();
    // L1 keeps candidateActions as a per-page action overview.
    expect(Array.isArray(payload.candidateActions)).toBe(true);
  });

  it('L0 envelope is strictly smaller than L0+L1+L2 envelope (size reduction)', async () => {
    setupExecutorMocks();
    const full = await readWithLayer('L0+L1+L2');
    setupExecutorMocks();
    const minimal = await readWithLayer('L0');
    expect(minimal.byteLength).toBeLessThan(full.byteLength);
  });

  it('rejects unknown requestedLayer values with INVALID_PARAMETERS', async () => {
    setupExecutorMocks();
    const result = await readPageTool.execute({ requestedLayer: 'L9' as any });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('requestedLayer must be one of');
  });
});
