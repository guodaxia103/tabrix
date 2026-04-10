import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExecutionResult } from './types';

export interface ToolCallNormalization {
  executionResult: ExecutionResult;
  stepSummary: string;
  errorCode?: string;
  errorSummary?: string;
}

function extractTextContent(result: CallToolResult): string[] {
  return (result.content || [])
    .filter((item): item is Extract<(typeof result.content)[number], { type: 'text' }> => {
      return item.type === 'text' && typeof item.text === 'string';
    })
    .map((item) => item.text.trim())
    .filter(Boolean);
}

export function normalizeToolCallResult(
  toolName: string,
  result: CallToolResult,
): ToolCallNormalization {
  const textParts = extractTextContent(result);
  const summary =
    textParts[0] || (result.isError ? `Tool ${toolName} failed` : `Tool ${toolName} succeeded`);

  if (result.isError) {
    return {
      executionResult: {
        status: 'failure',
        summary,
        warnings: [],
        errors: [
          {
            code: 'tool_call_error',
            summary,
          },
        ],
        artifacts: [],
        nextActions: [],
      },
      stepSummary: summary,
      errorCode: 'tool_call_error',
      errorSummary: summary,
    };
  }

  return {
    executionResult: {
      status: 'success',
      summary,
      data: result,
      warnings: [],
      errors: [],
      artifacts: [],
      nextActions: [],
    },
    stepSummary: summary,
  };
}
