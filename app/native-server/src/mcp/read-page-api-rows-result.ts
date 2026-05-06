import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ChooseContextDecisionSnapshot,
  SkipReadPlan,
} from '../execution/skip-read-orchestrator';
import type { ApiKnowledgeReadOk } from '../api/api-knowledge';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';

interface ApiRowsTokenSavings {
  tokenEstimateChosen: number;
  tokenEstimateFullRead: number;
  tokensSavedEstimate: number;
  tokensSavedEstimateSource:
    | 'full_read_estimate_minus_api_rows'
    | 'api_rows_payload_floor'
    | 'unavailable_empty_api_rows';
}

export function buildKnowledgeApiRowsSuccessResult(args: {
  recordedDecision: ChooseContextDecisionSnapshot;
  skipPlan: SkipReadPlan;
  apiResult: ApiKnowledgeReadOk;
  tokenSavings: ApiRowsTokenSavings;
  endpointSource: string;
  taskTotals: unknown;
}): { result: CallToolResult; operationLog: Record<string, unknown> } {
  const apiPayload = {
    kind: 'api_rows',
    readPageAvoided: true,
    sourceKind: args.skipPlan.sourceKind,
    sourceRoute: args.skipPlan.sourceRoute,
    chosenSource: args.recordedDecision.chosenSource ?? args.skipPlan.sourceKind,
    dataSource: args.recordedDecision.dataSource ?? args.skipPlan.sourceKind,
    decisionReason: args.recordedDecision.decisionReason ?? args.skipPlan.diagnostic,
    dispatcherInputSource: args.recordedDecision.dispatcherInputSource ?? null,
    fallbackPlan:
      args.recordedDecision.fallbackPlan ??
      ({
        dataSource: 'dom_json',
        entryLayer: args.skipPlan.fallbackEntryLayer,
        reason: args.skipPlan.diagnostic,
      } as const),
    layerContract: mapDataSourceToLayerContract({
      dataSource: 'api_rows',
      requestedLayer: args.recordedDecision.chosenLayer,
      fallbackEntryLayer: args.skipPlan.fallbackEntryLayer,
    }),
    chosenLayer: args.recordedDecision.chosenLayer,
    tokenEstimateChosen: args.tokenSavings.tokenEstimateChosen,
    tokenEstimateFullRead: args.tokenSavings.tokenEstimateFullRead,
    tokensSavedEstimate: args.tokenSavings.tokensSavedEstimate,
    tokensSavedEstimateSource: args.tokenSavings.tokensSavedEstimateSource,
    fallbackUsed: 'none',
    fallbackEntryLayer: args.skipPlan.fallbackEntryLayer,
    requiresApiCall: true,
    requiresExperienceReplay: false,
    apiFamily: args.apiResult.endpointFamily,
    dataPurpose: args.apiResult.dataPurpose,
    rows: args.apiResult.rows,
    rowCount: args.apiResult.rowCount,
    compact: args.apiResult.compact,
    rawBodyStored: args.apiResult.rawBodyStored,
    // Explicit "verified empty" envelope.
    // `emptyResult:true` MUST NOT trigger DOM fallback;
    // it is a successful API outcome with zero rows.
    // Defaults preserve the legacy wire shape for callers
    // that have not threaded the closed-enum yet.
    emptyResult: args.apiResult.emptyResult ?? false,
    emptyReason: args.apiResult.emptyReason ?? null,
    emptyMessage: args.apiResult.emptyMessage ?? null,
    // Closed-enum endpoint-source lineage on every
    // `chrome_read_page` `kind:'api_rows'` envelope.
    // The cached path inherits the chooser's
    // `direct-api-executor` value verbatim; the live
    // `readApiKnowledgeEndpointPlan` branch always uses
    // the built-in GitHub/npmjs adapter, so its
    // lineage is `seed_adapter` by construction. Surfacing
    // this on the public envelope lets the Gate B
    // benchmark transformer aggregate
    // `endpointSourceDistribution` without re-deriving
    // the bucket from the family string.
    endpointSource: args.endpointSource,
    liveObservedDataUsed: false,
    apiTelemetry: args.apiResult.telemetry,
    diagnostic: args.skipPlan.diagnostic,
    taskTotals: args.taskTotals,
  };

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(apiPayload) }],
    },
    operationLog: {
      requestedLayer: args.recordedDecision.chosenLayer,
      selectedDataSource: 'api_rows',
      sourceRoute: args.skipPlan.sourceRoute,
      decisionReason: args.recordedDecision.decisionReason ?? args.skipPlan.diagnostic,
      resultKind: 'api_rows',
      fallbackUsed: 'none',
      readCount: (args.taskTotals as { readPageAvoidedCount?: unknown }).readPageAvoidedCount,
      tokensSaved: args.tokenSavings.tokensSavedEstimate,
      // Record verified-empty evidence on the operation
      // log so a post-mortem can answer "did the API
      // really come back empty here?" without grepping the
      // raw envelope. `success` stays `true` (the API call
      // succeeded); only the `emptyResult` evidence flips.
      metadata: {
        emptyResult: args.apiResult.emptyResult ? 'true' : 'false',
      },
    },
  };
}
