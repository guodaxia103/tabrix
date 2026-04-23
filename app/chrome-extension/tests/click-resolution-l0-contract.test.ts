/**
 * V25-04 — read_page(L0) → chrome_click_element same-targetRef contract.
 *
 * The click verifier (see `click-verifier.ts::evaluateClickVerifier`)
 * does NOT consume `read_page`'s L0/L1/L2 payload, nor does it consume
 * `targetRef`. Per the V25-04 kickoff binding rule 2, the secondary
 * assertion path is therefore: prove that a `chrome_read_page` call
 * scoped to `requestedLayer: 'L0'` still seeds the per-tab stable
 * target-ref registry such that `chrome_click_element` can resolve a
 * `tgt_*` token to a non-unresolved `ResolvedCandidateActionTarget`.
 *
 * This test deliberately stops at *resolution attempt validity* — it
 * does NOT try to dispatch the click, and it does NOT assert the click
 * succeeds. Click success/failure has its own coverage in
 * `click-contract.test.ts` and `click-verifier.test.ts`. The point here
 * is that V25-02's L0 envelope reduction did not break the click
 * bridge's resolution input contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import {
  __resetStableTargetRefRegistryForTests,
  getStableTargetRefRegistrySnapshot,
  lookupStableTargetRef,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';
import { resolveCandidateActionTarget } from '@/entrypoints/background/tools/browser/candidate-action';

const FIXTURE_TAB = {
  id: 9101,
  windowId: 1,
  active: true,
  status: 'complete',
  url: 'https://github.com/octocat/hello/pull/42',
  title: 'PR #42 — octocat/hello',
};

// Page rich enough to produce HVOs with stable `targetRef` tokens.
const FIXTURE_PAGE_CONTENT = [
  '- heading "Pull request: Update build matrix" [ref=ref_0] (x=320,y=80)',
  '- link "Conversation" [ref=ref_1] (x=320,y=120)',
  '- link "Files changed" [ref=ref_2] (x=420,y=120)',
  '- link "Commits" [ref=ref_3] (x=520,y=120)',
  '- link "Checks" [ref=ref_4] (x=620,y=120)',
  '- button "Merge pull request" [ref=ref_5] (x=900,y=200)',
  '- button "Close pull request" [ref=ref_6] (x=900,y=240)',
  '- textbox "Add a comment" [ref=ref_7] (x=320,y=400)',
  '- button "Comment" [ref=ref_8] (x=900,y=440)',
  '- link "octocat" [ref=ref_9] (x=320,y=200)',
  '- link "hello" [ref=ref_10] (x=380,y=200)',
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

async function runReadPage(layer: 'L0' | 'L0+L1+L2') {
  const result = await readPageTool.execute({ requestedLayer: layer } as any);
  expect(result.isError).toBe(false);
  return JSON.parse((result.content[0] as { text: string }).text) as {
    L0?: unknown;
    L1?: unknown;
    L2?: unknown;
    highValueObjects?: Array<{ id: string; targetRef?: string; ref?: string }>;
    candidateActions?: Array<{ targetRef?: string }>;
  };
}

describe('V25-04 click-resolution L0 contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStableTargetRefRegistryForTests();
  });

  it('read_page(L0) registers the stable targetRef registry for the tab', async () => {
    setupExecutorMocks();
    const payload = await runReadPage('L0');

    // L0 envelope must NOT carry L1/L2 detail layers (V25-02 contract).
    expect(payload.L1 ?? null).toBeNull();
    expect(payload.L2 ?? null).toBeNull();
    // candidateActions are an L1-grade surface; suppressed at L0 (V25-02).
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(payload.candidateActions?.length).toBe(0);

    // HVO array MUST survive at L0 — that is the V25-04 contract.
    expect(Array.isArray(payload.highValueObjects)).toBe(true);
    expect(payload.highValueObjects?.length ?? 0).toBeGreaterThan(0);

    // Registry must have an entry for FIXTURE_TAB.id.
    const snap = getStableTargetRefRegistrySnapshot();
    expect(snap.tabIds).toContain(FIXTURE_TAB.id);
    expect(snap.entryCounts[FIXTURE_TAB.id]).toBeGreaterThan(0);
  });

  it('chrome_click_element resolves the same tgt_* (L0 read) to a live ref', async () => {
    setupExecutorMocks();
    const payload = await runReadPage('L0');

    const hvoWithTgt = (payload.highValueObjects ?? []).find(
      (h) => typeof h.targetRef === 'string' && h.targetRef.startsWith('tgt_'),
    );
    expect(hvoWithTgt).toBeDefined();
    const stableTargetRef = hvoWithTgt!.targetRef as string;

    // Click bridge resolution path — no IO, no dispatch.
    const resolved = resolveCandidateActionTarget({
      candidateAction: { targetRef: stableTargetRef },
      tabId: FIXTURE_TAB.id,
      lookupStableTargetRef,
    });

    expect(resolved.source).toBe('candidate_stable_target_ref');
    expect(resolved.source).not.toBe('unresolved_stable_target_ref');
    expect(typeof resolved.ref).toBe('string');
    expect(resolved.ref?.startsWith('ref_')).toBe(true);
  });

  it('same tgt_* resolves identically whether the seeding read was L0 or L0+L1+L2', async () => {
    setupExecutorMocks();
    const fullPayload = await runReadPage('L0+L1+L2');
    const fullHvo = (fullPayload.highValueObjects ?? []).find(
      (h) => typeof h.targetRef === 'string' && h.targetRef.startsWith('tgt_'),
    );
    expect(fullHvo).toBeDefined();
    const fullResolution = resolveCandidateActionTarget({
      candidateAction: { targetRef: fullHvo!.targetRef as string },
      tabId: FIXTURE_TAB.id,
      lookupStableTargetRef,
    });

    setupExecutorMocks();
    const minimalPayload = await runReadPage('L0');
    const minimalHvo = (minimalPayload.highValueObjects ?? []).find(
      (h) => h.targetRef === fullHvo!.targetRef,
    );
    expect(minimalHvo).toBeDefined();
    const minimalResolution = resolveCandidateActionTarget({
      candidateAction: { targetRef: minimalHvo!.targetRef as string },
      tabId: FIXTURE_TAB.id,
      lookupStableTargetRef,
    });

    // Same source, same live ref — proving L0 reduction did not lose
    // the click bridge's targeting handle.
    expect(minimalResolution.source).toBe(fullResolution.source);
    expect(minimalResolution.ref).toBe(fullResolution.ref);
  });

  it('layer dispatcher does NOT fold any tgt_* / ref_* into the L0 markdown surface', async () => {
    setupExecutorMocks();
    const result = await readPageTool.execute({
      requestedLayer: 'L0',
      render: 'markdown',
    } as any);
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text) as {
      markdown?: string;
    };

    // Markdown projection (B-015) must remain ref-free even when the
    // upstream caller asked for the smallest possible envelope.
    const md = payload.markdown ?? '';
    expect(md.length).toBeGreaterThan(0);
    expect(md).not.toMatch(/\bref_\d+/);
    expect(md).not.toMatch(/\btgt_[0-9a-f]{10}/);
  });

  it('unresolved tgt_* still fails closed when the registry has no entry for that tab', async () => {
    // Deliberately do NOT seed the registry — no read_page in this
    // test. The bridge must surface an `unresolved_stable_target_ref`
    // so callers get a "re-read the page" error rather than aiming
    // at the wrong element by accident.
    const resolved = resolveCandidateActionTarget({
      candidateAction: { targetRef: 'tgt_abcdef0123' },
      tabId: 4242,
      lookupStableTargetRef,
    });
    expect(resolved.source).toBe('unresolved_stable_target_ref');
    expect(resolved.unresolvedStableTargetRef).toBe('tgt_abcdef0123');
    expect(resolved.ref).toBeUndefined();
  });
});
