import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ChooseContextDecisionSnapshot,
  SkipReadPlan,
} from '../execution/skip-read-orchestrator';

export function buildReadPageSkipResult(args: {
  recordedDecision: ChooseContextDecisionSnapshot;
  skipPlan: SkipReadPlan;
  taskTotals: unknown;
}): { result: CallToolResult; operationLog: Record<string, unknown> } {
  const skipPayload = {
    kind: 'read_page_skipped',
    readPageAvoided: args.skipPlan.readPageAvoided,
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
    tokensSavedEstimate: args.skipPlan.tokensSavedEstimate,
    fallbackUsed: args.skipPlan.fallbackUsed,
    fallbackEntryLayer: args.skipPlan.fallbackEntryLayer,
    requiresApiCall: args.skipPlan.requiresApiCall,
    requiresExperienceReplay: args.skipPlan.requiresExperienceReplay,
    actionPathId: args.recordedDecision.replayCandidate?.actionPathId ?? null,
    apiFamily: args.recordedDecision.apiCapability?.family ?? null,
    diagnostic: args.skipPlan.diagnostic,
    taskTotals: args.taskTotals,
  };

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(skipPayload) }],
    },
    operationLog: {
      requestedLayer: args.recordedDecision.chosenLayer,
      selectedDataSource: args.skipPlan.sourceKind,
      sourceRoute: args.skipPlan.sourceRoute,
      decisionReason: args.recordedDecision.decisionReason ?? args.skipPlan.diagnostic,
      resultKind: 'read_page_skipped',
      fallbackUsed: args.skipPlan.fallbackUsed,
      readCount: (args.taskTotals as { readPageAvoidedCount?: unknown }).readPageAvoidedCount,
      tokensSaved: args.skipPlan.tokensSavedEstimate,
    },
  };
}
