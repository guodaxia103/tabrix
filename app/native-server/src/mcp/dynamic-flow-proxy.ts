import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { sessionManager } from '../execution/session-manager';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { runPostProcessor } from './tool-post-processors';
import { callWithBridgeRecovery } from './bridge-recovery';
import { createErrorResult } from './tool-call-results';

type InvokeExtensionCommand = (
  action: 'call_tool' | 'list_published_flows',
  payload: any,
  timeoutMs: number,
) => Promise<any>;

export async function proxyDynamicFlowTool(input: {
  name: string;
  args: any;
  sessionId: string;
  stepId: string;
  invokeExtensionCommand: InvokeExtensionCommand;
}): Promise<CallToolResult> {
  const { name, args, sessionId, stepId, invokeExtensionCommand } = input;
  // We need to resolve flow by slug to ID
  try {
    const resp = await invokeExtensionCommand('list_published_flows', {}, 20000);
    const items = (resp && resp.items) || [];
    const slug = name.slice('flow.'.length);
    const match = items.find((it: any) => it.slug === slug);
    if (!match) throw new Error(`Flow not found for tool ${name}`);
    const flowArgs = { flowId: match.id, args };
    const { response: proxyRes, bridgeFailure } = await callWithBridgeRecovery(
      () =>
        invokeExtensionCommand(
          'call_tool',
          { name: 'record_replay_flow_run', args: flowArgs },
          120000,
        ),
      `flow:${name}`,
    );
    if (proxyRes.status === 'success') {
      const postResult = runPostProcessor({
        toolName: name,
        rawResult: proxyRes.data,
        stepId,
        sessionId,
        sessionManager,
        args,
      });
      const normalized = normalizeToolCallResult(name, postResult.rawResult);
      sessionManager.completeStep(sessionId, stepId, {
        status: 'completed',
        resultSummary: normalized.stepSummary,
        artifactRefs:
          postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
      });
      sessionManager.finishSession(sessionId, {
        status: 'completed',
        summary: normalized.executionResult.summary,
      });
      return postResult.rawResult;
    }
    const result = createErrorResult(
      bridgeFailure
        ? JSON.stringify(bridgeFailure)
        : `Error calling dynamic flow tool: ${proxyRes.error}`,
    );
    sessionManager.completeStep(sessionId, stepId, {
      status: 'failed',
      errorCode: bridgeFailure ? bridgeFailure.code.toLowerCase() : 'dynamic_flow_error',
      errorSummary: bridgeFailure
        ? bridgeFailure.message
        : String(proxyRes.error || 'Unknown dynamic flow error'),
      resultSummary: `Dynamic flow ${name} failed`,
    });
    sessionManager.finishSession(sessionId, {
      status: 'failed',
      summary: `Dynamic flow ${name} failed`,
    });
    return result;
  } catch (err: any) {
    const result = createErrorResult(
      `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
    );
    sessionManager.completeStep(sessionId, stepId, {
      status: 'failed',
      errorCode: 'dynamic_flow_resolution_error',
      errorSummary: err?.message || String(err),
      resultSummary: `Dynamic flow ${name} could not be resolved`,
    });
    sessionManager.finishSession(sessionId, {
      status: 'failed',
      summary: `Dynamic flow ${name} resolution failed`,
    });
    return result;
  }
}
