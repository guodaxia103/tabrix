/**
 * V27-07 — DOM-Endpoint Correlator tests.
 *
 * The brief enumerates six required scenarios (see V27-07 §"测试要求").
 * Each maps to one of the assertions below. Beyond those, we also pin
 * the single-session confidence ceiling explicitly: every test inspects
 * `correlationConfidence` and refuses anything that climbs past
 * `'low_confidence'` — V27-08 owns multi-session escalation.
 */

import {
  correlateDomEndpoints,
  type ActionTimingDescriptor,
  type DomChangeSummary,
  type EndpointObservation,
} from './dom-endpoint-correlator';
import { classifyEndpointCandidate } from './network-observe-classifier';

function obs(
  partial: Partial<EndpointObservation> & { endpointPattern?: string },
): EndpointObservation {
  const candidate = classifyEndpointCandidate({
    url: `https://${partial.endpointPattern ?? 'api.example.test/v1/items'}?q=tabrix`,
    method: 'GET',
    mimeType: 'application/json',
    status: partial.status ?? 200,
  });
  return {
    endpointId: partial.endpointId ?? 'GET api.example.test/v1/items',
    endpointPattern: partial.endpointPattern ?? 'api.example.test/v1/items',
    semanticType: partial.semanticType ?? candidate.semanticType,
    observedAtMs: partial.observedAtMs ?? 1000,
    status: partial.status ?? 200,
    candidate,
  };
}

const ACTION: ActionTimingDescriptor = {
  actionId: 'act-1',
  actionKind: 'click',
  observedAtMs: 950,
  settleWindowMs: 500,
};

describe('correlateDomEndpoints — V27-07', () => {
  it('click + 1 endpoint + 1 region change → list/search low_confidence candidate', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ semanticType: 'list', observedAtMs: 1000 })],
      action: ACTION,
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].correlationConfidence).toBe('low_confidence');
    expect(out[0].correlationSource).toBe('click_partial_update');
    expect(out[0].correlatedRegionId).toBe('main_list');
    expect(out[0].correlationSignals).toContain('single_region_changed');
  });

  it('endpoint completed but no DOM change → metadata_only candidate', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ observedAtMs: 1000 })],
      action: ACTION,
      domChange: { changedRegionTags: [], totalRegionsObserved: 5 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].correlationSource).toBe('metadata_only');
    expect(out[0].correlatedRegionId).toBeNull();
    expect(out[0].correlationConfidence).toBe('unknown_candidate');
    expect(out[0].correlationSignals).toContain('no_region_change');
  });

  it('DOM changed but no related endpoint in window → no candidate fabricated', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ observedAtMs: 5000 })], // outside settle window
      action: ACTION,
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toEqual([]);
  });

  it('multi-endpoint in window → all become unknown_candidate (no high confidence)', () => {
    const out = correlateDomEndpoints({
      observations: [
        obs({ endpointId: 'e1', endpointPattern: 'a/x', observedAtMs: 1000 }),
        obs({ endpointId: 'e2', endpointPattern: 'a/y', observedAtMs: 1100 }),
      ],
      action: ACTION,
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toHaveLength(2);
    for (const c of out) {
      expect(c.correlationConfidence).toBe('unknown_candidate');
      expect(c.correlationSignals).toContain('multi_endpoint_in_window');
    }
  });

  it('single-session correlation never returns high confidence', () => {
    const fixtures: Array<{
      observations: EndpointObservation[];
      domChange: DomChangeSummary;
    }> = [
      { observations: [obs({})], domChange: { changedRegionTags: ['x'], totalRegionsObserved: 4 } },
      {
        observations: [obs({}), obs({ endpointId: 'e2', endpointPattern: 'a/y' })],
        domChange: { changedRegionTags: ['x', 'y'], totalRegionsObserved: 5 },
      },
      { observations: [obs({})], domChange: { changedRegionTags: [], totalRegionsObserved: 3 } },
      {
        observations: [obs({})],
        domChange: { changedRegionTags: ['a', 'b', 'c'], totalRegionsObserved: 3 },
      }, // full re-render
    ];
    for (const f of fixtures) {
      const out = correlateDomEndpoints({
        observations: f.observations,
        action: ACTION,
        domChange: f.domChange,
      });
      for (const c of out) {
        expect(['unknown_candidate', 'low_confidence']).toContain(c.correlationConfidence);
      }
    }
  });

  it('false-positive fixture (full re-render) → metadata_only / unknown_candidate', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ observedAtMs: 1000 })],
      action: ACTION,
      domChange: { changedRegionTags: ['header', 'main', 'footer'], totalRegionsObserved: 3 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].correlationConfidence).toBe('unknown_candidate');
    expect(out[0].correlationSource).toBe('metadata_only');
    expect(out[0].correlatedRegionId).toBeNull();
    expect(out[0].correlationSignals).toContain('full_rerender');
  });

  it('action region tag match → boosts the candidate but stays low_confidence', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ semanticType: 'search', observedAtMs: 1000 })],
      action: { ...ACTION, actionRegionTag: 'main_list' },
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].correlationConfidence).toBe('low_confidence');
    expect(out[0].correlationSignals).toContain('action_region_tag_match');
    expect(out[0].falsePositiveRisk).toBeLessThan(0.3);
  });

  it('non-click action kinds get unknown_candidate / unknown source', () => {
    for (const kind of ['fill', 'navigate', 'keyboard'] as const) {
      const out = correlateDomEndpoints({
        observations: [obs({ observedAtMs: 1000 })],
        action: { ...ACTION, actionKind: kind },
        domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
      });
      expect(out).toHaveLength(1);
      expect(out[0].correlationConfidence).toBe('unknown_candidate');
      expect(out[0].correlationSource).toBe('unknown');
      expect(out[0].correlationSignals).toContain('action_kind_unsupported');
    }
  });

  it('noise / error / unknown_candidate semantic types are excluded', () => {
    const out = correlateDomEndpoints({
      observations: [
        obs({
          endpointId: 'e1',
          endpointPattern: 'cdn/a.css',
          semanticType: 'noise',
          observedAtMs: 1000,
        }),
        obs({
          endpointId: 'e2',
          endpointPattern: 'api/x',
          semanticType: 'error',
          status: 500,
          observedAtMs: 1010,
        }),
        obs({
          endpointId: 'e3',
          endpointPattern: 'api/y',
          semanticType: 'unknown_candidate',
          observedAtMs: 1020,
        }),
      ],
      action: ACTION,
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toEqual([]);
  });

  it('multi-region change with single endpoint and matching action tag → low_confidence with attribution', () => {
    const out = correlateDomEndpoints({
      observations: [obs({ observedAtMs: 1000 })],
      action: { ...ACTION, actionRegionTag: 'sidebar' },
      domChange: { changedRegionTags: ['sidebar', 'main_list'], totalRegionsObserved: 5 },
    });
    expect(out).toHaveLength(1);
    expect(out[0].correlationConfidence).toBe('low_confidence');
    expect(out[0].correlatedRegionId).toBe('sidebar');
    expect(out[0].correlationSignals).toContain('multi_region_changed');
    expect(out[0].correlationSignals).toContain('action_region_tag_match');
  });

  it('falsePositiveRisk is clamped to [0,1]', () => {
    const out = correlateDomEndpoints({
      observations: [obs({})],
      action: ACTION,
      domChange: { changedRegionTags: ['main_list'], totalRegionsObserved: 5 },
    });
    for (const c of out) {
      expect(c.falsePositiveRisk).toBeGreaterThanOrEqual(0);
      expect(c.falsePositiveRisk).toBeLessThanOrEqual(1);
    }
  });
});
