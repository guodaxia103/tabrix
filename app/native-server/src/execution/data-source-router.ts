import type { ContextStrategyName, LayerSourceRoute, ReadPageRequestedLayer } from '@tabrix/shared';

export type DataSourceKind =
  | 'experience_replay'
  | 'api_list'
  | 'api_detail'
  | 'markdown'
  | 'dom_json';

export type DataSourceRiskTier = 'low' | 'medium' | 'high';

export interface DataSourceCostEstimate {
  chosenTokens: number;
  fullReadTokens: number;
  savedTokensEstimate: number;
}

export interface DataSourceFallbackPlan {
  dataSource: 'dom_json';
  entryLayer: 'L0' | 'L0+L1';
  reason: string;
}

export interface DataSourceDecisionInput {
  strategy?: ContextStrategyName;
  sourceRoute: LayerSourceRoute;
  chosenLayer: ReadPageRequestedLayer;
  layerDispatchReason?: string;
  tokenEstimateChosen?: number;
  tokenEstimateFullRead?: number;
  tokensSavedEstimate?: number;
  apiCandidateAvailable?: boolean;
  dispatcherInputSource?: string | null;
}

export interface DataSourceDecision {
  sourceRoute: LayerSourceRoute;
  dataSource: DataSourceKind;
  chosenSource: DataSourceKind;
  confidence: number;
  costEstimate: DataSourceCostEstimate;
  riskTier: DataSourceRiskTier;
  fallbackPlan: DataSourceFallbackPlan;
  decisionReason: string;
  dispatcherInputSource: string;
}

export function routeDataSource(input: DataSourceDecisionInput): DataSourceDecision {
  const costEstimate = buildCostEstimate(input);
  const fallbackPlan = buildFallbackPlan(input.chosenLayer, input.sourceRoute);
  const dispatcherInputSource = resolveDispatcherInputSource(input);

  if (input.sourceRoute === 'experience_replay_skip_read') {
    return {
      sourceRoute: input.sourceRoute,
      dataSource: 'experience_replay',
      chosenSource: 'experience_replay',
      confidence: 0.82,
      costEstimate,
      riskTier: 'medium',
      fallbackPlan,
      decisionReason: 'experience_replay_route_selected',
      dispatcherInputSource,
    };
  }

  if (input.sourceRoute === 'knowledge_supported_read' && input.apiCandidateAvailable === true) {
    return {
      sourceRoute: input.sourceRoute,
      dataSource: 'api_list',
      chosenSource: 'api_list',
      confidence: 0.88,
      costEstimate,
      riskTier: 'low',
      fallbackPlan,
      decisionReason: 'api_knowledge_candidate_available',
      dispatcherInputSource: 'api_knowledge',
    };
  }

  if (input.strategy === 'read_page_markdown') {
    return {
      sourceRoute: input.sourceRoute,
      dataSource: 'markdown',
      chosenSource: 'markdown',
      confidence: 0.68,
      costEstimate,
      riskTier: 'low',
      fallbackPlan,
      decisionReason: 'markdown_reading_surface_preferred',
      dispatcherInputSource,
    };
  }

  return {
    sourceRoute: input.sourceRoute,
    dataSource: 'dom_json',
    chosenSource: 'dom_json',
    confidence: input.sourceRoute === 'dispatcher_fallback_safe' ? 0.25 : 0.55,
    costEstimate,
    riskTier: 'low',
    fallbackPlan,
    decisionReason:
      input.sourceRoute === 'dispatcher_fallback_safe'
        ? 'router_fail_safe_dom_compact'
        : 'dom_compact_required',
    dispatcherInputSource,
  };
}

function buildCostEstimate(input: DataSourceDecisionInput): DataSourceCostEstimate {
  const chosenTokens = clampNonNegativeInt(input.tokenEstimateChosen);
  const fullReadTokens = clampNonNegativeInt(input.tokenEstimateFullRead);
  const savedTokensEstimate =
    input.tokensSavedEstimate === undefined
      ? Math.max(0, fullReadTokens - chosenTokens)
      : clampNonNegativeInt(input.tokensSavedEstimate);
  return { chosenTokens, fullReadTokens, savedTokensEstimate };
}

function buildFallbackPlan(
  chosenLayer: ReadPageRequestedLayer,
  sourceRoute: LayerSourceRoute,
): DataSourceFallbackPlan {
  return {
    dataSource: 'dom_json',
    entryLayer: chosenLayer === 'L0' ? 'L0' : 'L0+L1',
    reason:
      sourceRoute === 'dispatcher_fallback_safe'
        ? 'dispatcher_fallback_clamped_to_compact_dom'
        : 'fallback_to_compact_dom',
  };
}

function resolveDispatcherInputSource(input: DataSourceDecisionInput): string {
  if (typeof input.dispatcherInputSource === 'string' && input.dispatcherInputSource.length > 0) {
    return input.dispatcherInputSource;
  }
  if (input.sourceRoute === 'knowledge_supported_read' && input.apiCandidateAvailable === true) {
    return 'api_knowledge';
  }
  if (input.strategy === 'read_page_markdown') {
    return 'markdown_surface';
  }
  return 'fallback_zero';
}

function clampNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
