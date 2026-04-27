/**
 * V27-04 — Layer Budget composer tests.
 *
 * Asserts the composer mapping rule between (`ReadinessProfile`,
 * `ComplexityProfile`) and (`recommendedLayer`, `reason`, sub-flag
 * booleans). The composer MUST keep the sub-flags consistent with the
 * recommended layer, and confidence MUST be `min(readiness, complexity)`.
 *
 * The composer is the only V27-04 module that is allowed to consume
 * both arms; the orthogonality guards in the per-arm tests
 * (`v27-readiness.test.ts`, `v27-complexity.test.ts`) pin that the arms
 * themselves stay independent.
 */
import type { ComplexityProfile, ReadinessProfile } from '@tabrix/shared';

import { composeLayerBudget } from './v27-layer-budget';

function readiness(overrides: Partial<ReadinessProfile> = {}): ReadinessProfile {
  return {
    state: 'route_stable',
    confidence: 1,
    contributingSignals: ['route_stable'],
    producedAtMs: 1_000,
    ...overrides,
  };
}

function complexity(overrides: Partial<ComplexityProfile> = {}): ComplexityProfile {
  return {
    kind: 'list_or_search',
    confidence: 0.7,
    producedAtMs: 1_000,
    ...overrides,
  };
}

describe('v27-layer-budget — composeLayerBudget', () => {
  it('maps a list/search complexity over a ready page to L1 + needsApi', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'list_or_search' }));
    expect(out.recommendedLayer).toBe('L1');
    expect(out.reason).toBe('list_or_search');
    expect(out.needsApi).toBe(true);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
    expect(out.confidence).toBeCloseTo(0.7);
  });

  it('maps a detail complexity to L1 + needsApi', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'detail' }));
    expect(out.recommendedLayer).toBe('L1');
    expect(out.reason).toBe('detail');
    expect(out.needsApi).toBe(true);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('maps a document complexity to L1 + needsMarkdown', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'document' }));
    expect(out.recommendedLayer).toBe('L1');
    expect(out.reason).toBe('document');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(true);
    expect(out.needsL2).toBe(false);
  });

  it('maps a transactional complexity to L1 + needsApi', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'transactional' }));
    expect(out.recommendedLayer).toBe('L1');
    expect(out.reason).toBe('transactional');
    expect(out.needsApi).toBe(true);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('maps a media complexity to L1 with no needs flags set', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'media' }));
    expect(out.recommendedLayer).toBe('L1');
    expect(out.reason).toBe('media');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('maps a complex_app complexity to L2 + needsL2', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'complex_app' }));
    expect(out.recommendedLayer).toBe('L2');
    expect(out.reason).toBe('complex_app');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(true);
  });

  it('maps a simple complexity to L0 + simple_shell', () => {
    const out = composeLayerBudget(readiness(), complexity({ kind: 'simple' }));
    expect(out.recommendedLayer).toBe('L0');
    expect(out.reason).toBe('simple_shell');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('overrides to L0 + not_ready when readiness is error', () => {
    const out = composeLayerBudget(
      readiness({ state: 'error', confidence: 0.85, contributingSignals: ['error'] }),
      complexity({ kind: 'document' }),
    );
    expect(out.recommendedLayer).toBe('L0');
    expect(out.reason).toBe('not_ready');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('overrides to L0 + not_ready when readiness is empty', () => {
    const out = composeLayerBudget(
      readiness({ state: 'empty', confidence: 0.85, contributingSignals: ['empty'] }),
      complexity({ kind: 'list_or_search' }),
    );
    expect(out.recommendedLayer).toBe('L0');
    expect(out.reason).toBe('not_ready');
  });

  it('overrides to recommendedLayer=unknown when readiness is unknown', () => {
    const out = composeLayerBudget(
      readiness({ state: 'unknown', confidence: 0.2, contributingSignals: [] }),
      complexity({ kind: 'document', confidence: 0.9 }),
    );
    expect(out.recommendedLayer).toBe('unknown');
    expect(out.reason).toBe('unknown');
    expect(out.needsApi).toBe(false);
    expect(out.needsMarkdown).toBe(false);
    expect(out.needsL2).toBe(false);
  });

  it('maps an unknown complexity over a ready page to recommendedLayer=unknown', () => {
    const out = composeLayerBudget(
      readiness({ state: 'route_stable', confidence: 1 }),
      complexity({ kind: 'unknown', confidence: 0.2 }),
    );
    expect(out.recommendedLayer).toBe('unknown');
    expect(out.reason).toBe('unknown');
  });

  it('takes confidence as the minimum of the two arm confidences', () => {
    const out = composeLayerBudget(readiness({ confidence: 0.6 }), complexity({ confidence: 0.9 }));
    expect(out.confidence).toBeCloseTo(0.6);

    const out2 = composeLayerBudget(
      readiness({ confidence: 0.9 }),
      complexity({ confidence: 0.5 }),
    );
    expect(out2.confidence).toBeCloseTo(0.5);
  });

  it('clamps confidence into [0, 1]', () => {
    const out = composeLayerBudget(
      readiness({ confidence: 5 }), // illegal — clamped
      complexity({ confidence: -1 }),
    );
    expect(out.confidence).toBe(0);
  });

  it('is deterministic — same arms twice yield the same recommendation', () => {
    const r = readiness();
    const c = complexity();
    const a = composeLayerBudget(r, c, { now: () => 1234 });
    const b = composeLayerBudget(r, c, { now: () => 1234 });
    expect(a).toEqual(b);
  });

  it('embeds the original arms verbatim', () => {
    const r = readiness();
    const c = complexity();
    const out = composeLayerBudget(r, c);
    expect(out.readiness).toBe(r);
    expect(out.complexity).toBe(c);
  });
});
