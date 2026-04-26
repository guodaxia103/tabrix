import { routeDataSource } from './data-source-router';

describe('DataSourceRouter (V26-09)', () => {
  it('routes search/list API knowledge to api_list with api dispatcher evidence', () => {
    const decision = routeDataSource({
      strategy: 'knowledge_light',
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      layerDispatchReason: 'knowledge_supports_summary',
      tokenEstimateChosen: 64,
      tokenEstimateFullRead: 4096,
      tokensSavedEstimate: 4032,
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
    });

    expect(decision).toMatchObject({
      sourceRoute: 'knowledge_supported_read',
      dataSource: 'api_list',
      chosenSource: 'api_list',
      riskTier: 'low',
      decisionReason: 'api_knowledge_candidate_available',
      dispatcherInputSource: 'api_knowledge',
      fallbackPlan: {
        dataSource: 'dom_json',
        entryLayer: 'L0',
        reason: 'fallback_to_compact_dom',
      },
      costEstimate: {
        chosenTokens: 64,
        fullReadTokens: 4096,
        savedTokensEstimate: 4032,
      },
    });
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it('keeps markdown as a reading surface with compact DOM fallback', () => {
    const decision = routeDataSource({
      strategy: 'read_page_markdown',
      sourceRoute: 'read_page_required',
      chosenLayer: 'L0+L1',
      apiCandidateAvailable: false,
      dispatcherInputSource: null,
    });

    expect(decision).toMatchObject({
      dataSource: 'markdown',
      chosenSource: 'markdown',
      dispatcherInputSource: 'markdown_surface',
      fallbackPlan: { dataSource: 'dom_json', entryLayer: 'L0+L1' },
      decisionReason: 'markdown_reading_surface_preferred',
    });
  });

  it('routes action/read_page paths to DOM JSON without widening fallback to L2', () => {
    const decision = routeDataSource({
      strategy: 'read_page_required',
      sourceRoute: 'read_page_required',
      chosenLayer: 'L0+L1+L2',
      layerDispatchReason: 'user_intent_open_or_select',
      dispatcherInputSource: 'live_snapshot',
    });

    expect(decision).toMatchObject({
      dataSource: 'dom_json',
      chosenSource: 'dom_json',
      dispatcherInputSource: 'live_snapshot',
      fallbackPlan: { dataSource: 'dom_json', entryLayer: 'L0+L1' },
      decisionReason: 'dom_compact_required',
    });
  });

  it('clamps dispatcher fail-safe fallback to compact DOM with explicit reason', () => {
    const decision = routeDataSource({
      strategy: 'read_page_required',
      sourceRoute: 'dispatcher_fallback_safe',
      chosenLayer: 'L0+L1+L2',
      dispatcherInputSource: null,
    });

    expect(decision).toMatchObject({
      dataSource: 'dom_json',
      chosenSource: 'dom_json',
      confidence: 0.25,
      dispatcherInputSource: 'fallback_zero',
      fallbackPlan: {
        dataSource: 'dom_json',
        entryLayer: 'L0+L1',
        reason: 'dispatcher_fallback_clamped_to_compact_dom',
      },
      decisionReason: 'router_fail_safe_dom_compact',
    });
  });
});
