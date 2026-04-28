import {
  routeDataSource,
  DATA_SOURCE_ROUTER_RULE_IDS,
  type DataSourceRouterRuleId,
  type RouterEndpointEvidence,
} from './data-source-router';
import { assertLayerContract } from './layer-contract';

// ---------------------------------------------------------------
// Helpers — small, brand-neutral fixtures so individual tests stay
// readable. The router never invents endpoint evidence; it only
// reads what V27-06 / V27-07 / V27-08 emitted.
// ---------------------------------------------------------------
function evidence(overrides: Partial<RouterEndpointEvidence> = {}): RouterEndpointEvidence {
  return {
    endpointSource: 'observed',
    seedAdapterRetirementState: 'not_applicable',
    correlationScore: 0.85,
    pageRegion: 'main',
    inferredSemanticType: 'list',
    evidenceKinds: ['path', 'query'],
    sampleCount: 3,
    falseCorrelationGuard: 0.1,
    correlationMode: 'classifier_v2',
    lastFailureReason: null,
    confidence: 0.82,
    usableForTask: true,
    ...overrides,
  };
}

describe('DataSourceRouter (V26-09 legacy back-compat)', () => {
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
    // V27-09 — back-compat caller still gets the new fields populated
    // with safe defaults (rule id, selectedDataSource alias, etc).
    expect(decision.decisionRuleId).toBe('R_KNOWLEDGE_SUPPORTED_LEGACY');
    expect(decision.selectedDataSource).toBe('api_list');
    expect(decision.publicSurfaceDelta).toBe('none');
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
    expect(decision.decisionRuleId).toBe('R_MARKDOWN_READING_SURFACE');
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
    expect(decision.decisionRuleId).toBe('R_DOM_DEFAULT');
    // V27-09 — legacy caller did not request L2 widening; selectedLayer
    // mirrors chosenLayer rather than over-reading.
    expect(decision.selectedLayer).toBe('L0+L1+L2');
    // Layer contract still exposes the dom_json envelope; downstream
    // is the one that decides whether to actually pull L2.
    expect(decision.layerContract.dataSource).toBe('dom_json');
  });

  describe('V26-FIX-06 cross-module layer contract', () => {
    it('search/list api_list does not request L2 and refuses locator/execution use', () => {
      const decision = routeDataSource({
        strategy: 'knowledge_light',
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        layerDispatchReason: 'knowledge_supports_summary',
        apiCandidateAvailable: true,
        dispatcherInputSource: null,
      });

      expect(decision.layerContract.dataSource).toBe('api_rows');
      expect(decision.layerContract.layer).not.toBe('L2');
      expect(decision.layerContract.allowedUses).toEqual(['list_read']);
      expect(decision.layerContract.disallowedUses).toEqual(
        expect.arrayContaining(['execution', 'locator']),
      );
      expect(assertLayerContract(decision.layerContract, 'list_read').ok).toBe(true);
      expect(assertLayerContract(decision.layerContract, 'locator').ok).toBe(false);
      expect(assertLayerContract(decision.layerContract, 'execution').ok).toBe(false);
    });

    it('markdown reading surface does not authorise locator or execution', () => {
      const decision = routeDataSource({
        strategy: 'read_page_markdown',
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1',
        apiCandidateAvailable: false,
        dispatcherInputSource: null,
      });

      expect(decision.layerContract.dataSource).toBe('markdown');
      expect(decision.layerContract.disallowedUses).toEqual(
        expect.arrayContaining(['execution', 'locator']),
      );
      expect(assertLayerContract(decision.layerContract, 'reading_surface').ok).toBe(true);
      expect(assertLayerContract(decision.layerContract, 'locator').ok).toBe(false);
    });

    it('dom_json action route remains the only locator/execution authority', () => {
      const decision = routeDataSource({
        strategy: 'read_page_required',
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1+L2',
        layerDispatchReason: 'user_intent_open_or_select',
        dispatcherInputSource: 'live_snapshot',
      });

      expect(decision.layerContract.dataSource).toBe('dom_json');
      expect(decision.layerContract.allowedUses).toEqual(
        expect.arrayContaining(['execution', 'locator']),
      );
      expect(assertLayerContract(decision.layerContract, 'execution').ok).toBe(true);
      expect(assertLayerContract(decision.layerContract, 'locator').ok).toBe(true);
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
    expect(decision.decisionRuleId).toBe('R_DISPATCHER_FAIL_SAFE_DOM');
  });
});

describe('DataSourceRouter — V27-09 truth table', () => {
  it('experience replay route surfaces the dom_json execution envelope (R_EXPERIENCE_REPLAY)', () => {
    const decision = routeDataSource({
      strategy: 'experience_replay',
      sourceRoute: 'experience_replay_skip_read',
      chosenLayer: 'L0+L1',
      dispatcherInputSource: null,
    });
    expect(decision.decisionRuleId).toBe('R_EXPERIENCE_REPLAY');
    expect(decision.dataSource).toBe('experience_replay');
    expect(decision.layerContract.dataSource).toBe('dom_json');
    expect(decision.layerContract.allowedUses).toEqual(
      expect.arrayContaining(['execution', 'locator']),
    );
  });

  it('click/fill intent forces dom_json even when api candidate is available (R_CLICK_FILL_DOM_AUTHORITY)', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0+L1',
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
      taskIntent: 'click_or_fill',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'transactional',
      contextVersion: 'ctx-1',
      factSnapshotId: 'snap-1',
      endpointEvidence: evidence({ inferredSemanticType: 'list' }),
    });
    expect(decision.decisionRuleId).toBe('R_CLICK_FILL_DOM_AUTHORITY');
    expect(decision.dataSource).toBe('dom_json');
    expect(decision.selectedDataSource).toBe('dom_json');
    expect(decision.layerContract.dataSource).toBe('dom_json');
    expect(assertLayerContract(decision.layerContract, 'execution').ok).toBe(true);
    expect(assertLayerContract(decision.layerContract, 'locator').ok).toBe(true);
    expect(decision.contextVersion).toBe('ctx-1');
    expect(decision.factSnapshotVerdict).toBe('fresh');
  });

  it('search/list intent + fresh facts + observed endpoint wins api_list (R_API_LIST_HIGH_CONFIDENCE)', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'list',
      contextVersion: 'ctx-1',
      factSnapshotId: 'snap-1',
      endpointEvidence: evidence({
        inferredSemanticType: 'search',
        endpointSource: 'observed',
        confidence: 0.9,
      }),
    });
    expect(decision.decisionRuleId).toBe('R_API_LIST_HIGH_CONFIDENCE');
    expect(decision.dataSource).toBe('api_list');
    expect(decision.layerContract.dataSource).toBe('api_rows');
    expect(decision.layerContract.allowedUses).toEqual(['list_read']);
    expect(decision.dispatcherInputSource).toBe('api_knowledge');
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it('detail intent + fresh facts + detail endpoint wins api_detail (R_API_DETAIL_HIGH_CONFIDENCE)', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0+L1+L2',
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
      taskIntent: 'detail',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'detail',
      endpointEvidence: evidence({ inferredSemanticType: 'detail', confidence: 0.9 }),
    });
    expect(decision.decisionRuleId).toBe('R_API_DETAIL_HIGH_CONFIDENCE');
    expect(decision.dataSource).toBe('api_detail');
    expect(decision.layerContract.dataSource).toBe('api_detail');
    // taskRequiresDetail propagated into the contract.
    expect(decision.layerContract.layer).toBe('L0+L1+L2');
  });

  it('document intent + complexity=document selects markdown reading surface (R_MARKDOWN_READING_SURFACE)', () => {
    const decision = routeDataSource({
      sourceRoute: 'read_page_required',
      chosenLayer: 'L0+L1',
      taskIntent: 'document',
      complexityClass: 'document',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      dispatcherInputSource: 'live_snapshot',
    });
    expect(decision.decisionRuleId).toBe('R_MARKDOWN_READING_SURFACE');
    expect(decision.dataSource).toBe('markdown');
    expect(decision.layerContract.dataSource).toBe('markdown');
    expect(assertLayerContract(decision.layerContract, 'locator').ok).toBe(false);
  });

  it('deprecated_seed endpoint never wins API path even with fresh facts (R_DEPRECATED_SEED_DEMOTE_DOM)', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'list',
      endpointEvidence: evidence({
        endpointSource: 'deprecated_seed',
        seedAdapterRetirementState: 'deprecated',
        inferredSemanticType: 'search',
        confidence: 0.9,
        usableForTask: true,
      }),
    });
    expect(decision.decisionRuleId).toBe('R_DEPRECATED_SEED_DEMOTE_DOM');
    expect(decision.dataSource).toBe('dom_json');
    expect(decision.decisionReason).toBe('deprecated_seed_demoted_no_api_authority');
    expect(decision.layerContract.dataSource).toBe('dom_json');
  });

  it.each<['stale' | 'missing' | 'unknown', string]>([
    ['stale', 'stale fact snapshot demotes to compact DOM'],
    ['missing', 'missing fact snapshot demotes to compact DOM'],
    ['unknown', 'unknown fact snapshot demotes to compact DOM'],
  ])(
    'fact snapshot verdict=%s + V27-09 caller demotes to dom_json (R_FACTS_STALE_DEMOTE_DOM): %s',
    (verdict) => {
      const decision = routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        apiCandidateAvailable: true,
        dispatcherInputSource: null,
        taskIntent: 'search_list',
        factSnapshotVerdict: verdict,
        readinessVerdict: 'ready',
        complexityClass: 'list',
        endpointEvidence: evidence({ inferredSemanticType: 'search', confidence: 0.9 }),
      });
      expect(decision.decisionRuleId).toBe('R_FACTS_STALE_DEMOTE_DOM');
      expect(decision.dataSource).toBe('dom_json');
      expect(decision.decisionReason).toBe('facts_stale_or_missing_demote_to_dom');
      expect(decision.confidence).toBeLessThan(0.6);
    },
  );

  it('readiness=empty + sufficient endpoint lineage marks empty-as-success api_list (R_EMPTY_RESULT_API_CONFIRMED)', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      apiCandidateAvailable: true,
      dispatcherInputSource: null,
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'empty',
      complexityClass: 'list',
      endpointEvidence: evidence({
        inferredSemanticType: 'empty',
        endpointSource: 'observed',
        confidence: 0.85,
      }),
    });
    expect(decision.decisionRuleId).toBe('R_EMPTY_RESULT_API_CONFIRMED');
    expect(decision.dataSource).toBe('api_list');
    expect(decision.decisionReason).toBe('empty_result_endpoint_lineage_sufficient');
    expect(decision.layerContract.dataSource).toBe('api_rows');
  });

  it('readiness=empty without endpoint backing falls back to DOM L0+L1 (R_EMPTY_RESULT_DOM_CONFIRM)', () => {
    const decision = routeDataSource({
      sourceRoute: 'read_page_required',
      chosenLayer: 'L0+L1',
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'empty',
      complexityClass: 'list',
      // No endpoint evidence at all → cannot trust empty as success.
    });
    expect(decision.decisionRuleId).toBe('R_EMPTY_RESULT_DOM_CONFIRM');
    expect(decision.dataSource).toBe('dom_json');
    expect(decision.decisionReason).toBe('empty_result_requires_dom_l0_l1_confirm');
    expect(decision.layerContract.dataSource).toBe('dom_json');
  });

  it('readiness=empty + low-confidence endpoint also falls back to DOM L0+L1 (R_EMPTY_RESULT_DOM_CONFIRM)', () => {
    const decision = routeDataSource({
      sourceRoute: 'read_page_required',
      chosenLayer: 'L0+L1',
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'empty',
      complexityClass: 'list',
      endpointEvidence: evidence({
        inferredSemanticType: 'empty',
        confidence: 0.4,
        usableForTask: false,
      }),
    });
    expect(decision.decisionRuleId).toBe('R_EMPTY_RESULT_DOM_CONFIRM');
    expect(decision.dataSource).toBe('dom_json');
  });

  it('endpoint with high false-correlation guard does not pass the API gate', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'list',
      endpointEvidence: evidence({
        inferredSemanticType: 'search',
        falseCorrelationGuard: 0.9,
      }),
    });
    // Gate fails → no API rule fires; falls through to default DOM.
    expect(decision.dataSource).toBe('dom_json');
    expect(decision.decisionRuleId).not.toBe('R_API_LIST_HIGH_CONFIDENCE');
    expect(decision.decisionRuleId).toBe('R_DOM_DEFAULT');
  });

  it('exposes the full V27-09 evidence-contract field set on every decision', () => {
    const decision = routeDataSource({
      sourceRoute: 'knowledge_supported_read',
      chosenLayer: 'L0',
      apiCandidateAvailable: true,
      taskIntent: 'search_list',
      factSnapshotVerdict: 'fresh',
      readinessVerdict: 'ready',
      complexityClass: 'list',
      contextVersion: 'ctx-42',
      factSnapshotId: 'snap-42',
      endpointEvidence: evidence({ inferredSemanticType: 'search', confidence: 0.9 }),
    });
    // SoT V3 §V27-09 evidence contract fields — every one populated.
    expect(decision.selectedDataSource).toBe(decision.dataSource);
    expect(decision.selectedLayer).toBe('L0');
    expect(decision.contextVersion).toBe('ctx-42');
    expect(decision.factSnapshotVerdict).toBe('fresh');
    expect(typeof decision.confidence).toBe('number');
    expect(decision.costEstimate).toBeDefined();
    expect(decision.riskTier).toBeDefined();
    expect(decision.fallbackPlan).toBeDefined();
    expect(typeof decision.decisionReason).toBe('string');
    expect(decision.decisionRuleId.length).toBeGreaterThan(0);
    expect(decision.publicSurfaceDelta).toBe('none');
  });

  it('publicSurfaceDelta defaults to "none" across every rule (no public MCP shape change)', () => {
    const cases: Array<{ ruleId: DataSourceRouterRuleId; build: () => unknown }> = [
      {
        ruleId: 'R_EXPERIENCE_REPLAY',
        build: () =>
          routeDataSource({
            sourceRoute: 'experience_replay_skip_read',
            chosenLayer: 'L0',
            dispatcherInputSource: null,
          }),
      },
      {
        ruleId: 'R_CLICK_FILL_DOM_AUTHORITY',
        build: () =>
          routeDataSource({
            sourceRoute: 'read_page_required',
            chosenLayer: 'L0+L1',
            taskIntent: 'click_or_fill',
          }),
      },
      {
        ruleId: 'R_DISPATCHER_FAIL_SAFE_DOM',
        build: () =>
          routeDataSource({
            sourceRoute: 'dispatcher_fallback_safe',
            chosenLayer: 'L0+L1+L2',
          }),
      },
      {
        ruleId: 'R_KNOWLEDGE_SUPPORTED_LEGACY',
        build: () =>
          routeDataSource({
            sourceRoute: 'knowledge_supported_read',
            chosenLayer: 'L0',
            apiCandidateAvailable: true,
          }),
      },
    ];
    for (const { build } of cases) {
      const d = build() as { publicSurfaceDelta: string };
      expect(d.publicSurfaceDelta).toBe('none');
    }
  });
});

describe('DataSourceRouter — truth table coverage', () => {
  // V27-09 — every closed-enum rule id MUST have at least one
  // matching test in this file. The matrix below is the executable
  // index; if you add a new rule id, add a fixture here so the
  // suite refuses to ship a rule with zero coverage.
  const ruleFixtures: Record<DataSourceRouterRuleId, () => DataSourceRouterRuleId> = {
    R_EXPERIENCE_REPLAY: () =>
      routeDataSource({
        sourceRoute: 'experience_replay_skip_read',
        chosenLayer: 'L0',
      }).decisionRuleId,
    R_CLICK_FILL_DOM_AUTHORITY: () =>
      routeDataSource({
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1',
        taskIntent: 'click_or_fill',
      }).decisionRuleId,
    R_DISPATCHER_FAIL_SAFE_DOM: () =>
      routeDataSource({
        sourceRoute: 'dispatcher_fallback_safe',
        chosenLayer: 'L0+L1+L2',
      }).decisionRuleId,
    R_FACTS_STALE_DEMOTE_DOM: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        taskIntent: 'search_list',
        factSnapshotVerdict: 'stale',
        readinessVerdict: 'ready',
        endpointEvidence: evidence(),
      }).decisionRuleId,
    R_DEPRECATED_SEED_DEMOTE_DOM: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        taskIntent: 'search_list',
        factSnapshotVerdict: 'fresh',
        readinessVerdict: 'ready',
        endpointEvidence: evidence({
          endpointSource: 'deprecated_seed',
          seedAdapterRetirementState: 'deprecated',
        }),
      }).decisionRuleId,
    R_API_LIST_HIGH_CONFIDENCE: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        taskIntent: 'search_list',
        factSnapshotVerdict: 'fresh',
        readinessVerdict: 'ready',
        endpointEvidence: evidence({ inferredSemanticType: 'search' }),
      }).decisionRuleId,
    R_API_DETAIL_HIGH_CONFIDENCE: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0+L1+L2',
        taskIntent: 'detail',
        factSnapshotVerdict: 'fresh',
        readinessVerdict: 'ready',
        endpointEvidence: evidence({ inferredSemanticType: 'detail' }),
      }).decisionRuleId,
    R_MARKDOWN_READING_SURFACE: () =>
      routeDataSource({
        strategy: 'read_page_markdown',
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1',
      }).decisionRuleId,
    R_EMPTY_RESULT_API_CONFIRMED: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        taskIntent: 'search_list',
        factSnapshotVerdict: 'fresh',
        readinessVerdict: 'empty',
        endpointEvidence: evidence({ inferredSemanticType: 'empty', confidence: 0.85 }),
      }).decisionRuleId,
    R_EMPTY_RESULT_DOM_CONFIRM: () =>
      routeDataSource({
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1',
        taskIntent: 'search_list',
        factSnapshotVerdict: 'fresh',
        readinessVerdict: 'empty',
      }).decisionRuleId,
    R_KNOWLEDGE_SUPPORTED_LEGACY: () =>
      routeDataSource({
        sourceRoute: 'knowledge_supported_read',
        chosenLayer: 'L0',
        apiCandidateAvailable: true,
      }).decisionRuleId,
    R_DOM_DEFAULT: () =>
      routeDataSource({
        sourceRoute: 'read_page_required',
        chosenLayer: 'L0+L1',
      }).decisionRuleId,
  };

  it.each(DATA_SOURCE_ROUTER_RULE_IDS)('rule %s has at least one matching fixture', (ruleId) => {
    const observed = ruleFixtures[ruleId]();
    expect(observed).toBe(ruleId);
  });
});
