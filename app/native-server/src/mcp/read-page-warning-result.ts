import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReadPageRequestedLayer } from '@tabrix/shared';
import type { ShouldAllowReadPageResult } from '../execution/task-session-context';
import type { ReadPageOperationLogHint } from './read-page-dom-region-rows-result';

export function buildReadPageWarningResult(args: {
  decision: ShouldAllowReadPageResult;
  requestedLayer: ReadPageRequestedLayer;
  operationLogHint: ReadPageOperationLogHint | null;
}): {
  result: CallToolResult;
  warning: string;
  operationLog: Record<string, unknown>;
} {
  const warning = args.decision.reason || 'read_budget_exceeded';
  const warningPayload = {
    warning,
    readPageCount: args.decision.readPageCount,
    readBudget: args.decision.readBudget,
    suggestedLayer: args.decision.suggestedLayer,
  };

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(warningPayload) }],
    },
    warning,
    operationLog: {
      ...(args.operationLogHint ?? {}),
      requestedLayer: args.requestedLayer,
      resultKind: 'read_page_warning',
      decisionReason: warning,
    },
  };
}
