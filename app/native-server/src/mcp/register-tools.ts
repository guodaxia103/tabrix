import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_SCHEMAS } from 'chrome-mcp-shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sessionManager } from '../execution/session-manager';
import { normalizeToolCallResult } from '../execution/result-normalizer';

/**
 * Tools with elevated risk: arbitrary JS execution, data deletion, file system
 * interaction. When MCP_DISABLE_SENSITIVE_TOOLS=true, these are hidden from
 * the tool list unless explicitly allowed via ENABLE_MCP_TOOLS.
 */
export const SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'chrome_javascript',
  'chrome_bookmark_delete',
  'chrome_upload_file',
]);

function parseToolList(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function filterToolsByEnvironment(tools: Tool[]): Tool[] {
  const enabledTools = parseToolList(process.env.ENABLE_MCP_TOOLS);
  const disabledTools = parseToolList(process.env.DISABLE_MCP_TOOLS);

  if (enabledTools.size > 0) {
    return tools.filter((tool) => enabledTools.has(tool.name));
  }

  if (disabledTools.size > 0) {
    return tools.filter((tool) => !disabledTools.has(tool.name));
  }

  if (process.env.MCP_DISABLE_SENSITIVE_TOOLS === 'true') {
    return tools.filter((tool) => !SENSITIVE_TOOL_NAMES.has(tool.name));
  }

  return tools;
}

function isToolAllowed(toolName: string, tools: Tool[]): boolean {
  return tools.some((tool) => tool.name === toolName);
}

function createErrorResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
    isError: true,
  };
}

async function listDynamicFlowTools(): Promise<Tool[]> {
  try {
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {},
      'rr_list_published_flows',
      20000,
    );
    if (response && response.status === 'success' && Array.isArray(response.items)) {
      const tools: Tool[] = [];
      for (const item of response.items) {
        const name = `flow.${item.slug}`;
        const description =
          (item.meta && item.meta.tool && item.meta.tool.description) ||
          item.description ||
          'Recorded flow';
        const properties: Record<string, any> = {};
        const required: string[] = [];
        for (const v of item.variables || []) {
          const desc = v.label || v.key;
          const typ = (v.type || 'string').toLowerCase();
          const prop: any = { description: desc };
          if (typ === 'boolean') prop.type = 'boolean';
          else if (typ === 'number') prop.type = 'number';
          else if (typ === 'enum') {
            prop.type = 'string';
            if (v.rules && Array.isArray(v.rules.enum)) prop.enum = v.rules.enum;
          } else if (typ === 'array') {
            // default array of strings; can extend with itemType later
            prop.type = 'array';
            prop.items = { type: 'string' };
          } else {
            prop.type = 'string';
          }
          if (v.default !== undefined) prop.default = v.default;
          if (v.rules && v.rules.required) required.push(v.key);
          properties[v.key] = prop;
        }
        // Run options
        properties['tabTarget'] = { type: 'string', enum: ['current', 'new'], default: 'current' };
        properties['refresh'] = { type: 'boolean', default: false };
        properties['captureNetwork'] = { type: 'boolean', default: false };
        properties['returnLogs'] = { type: 'boolean', default: false };
        properties['timeoutMs'] = { type: 'number', minimum: 0 };
        const tool: Tool = {
          name,
          description,
          inputSchema: { type: 'object', properties, required },
        };
        tools.push(tool);
      }
      return tools;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export const setupTools = (server: Server) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools();
    return { tools: filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]) };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

export const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  const task = sessionManager.createTask({
    taskType: name.startsWith('flow.') ? 'flow-call' : 'tool-call',
    title: `Execute ${name}`,
    intent: `Run MCP tool ${name}`,
    origin: 'mcp',
    labels: ['mcp', name.startsWith('flow.') ? 'flow' : 'tool'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'mcp',
    clientName: 'mcp-server',
  });
  const step = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: name,
    stepType: name.startsWith('flow.') ? 'flow_call' : 'tool_call',
    inputSummary: JSON.stringify(args ?? {}),
  });

  try {
    const dynamicTools = await listDynamicFlowTools();
    const allowedTools = filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]);

    if (!isToolAllowed(name, allowedTools)) {
      const result = createErrorResult(
        `Tool "${name}" is disabled or not available in the current server configuration.`,
      );
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'tool_not_available',
        errorSummary: `Tool "${name}" is disabled or unavailable`,
        resultSummary: 'Tool rejected by current configuration',
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} rejected by configuration`,
      });
      return result;
    }

    // If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
    if (name && name.startsWith('flow.')) {
      // We need to resolve flow by slug to ID
      try {
        const resp = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          {},
          'rr_list_published_flows',
          20000,
        );
        const items = (resp && resp.items) || [];
        const slug = name.slice('flow.'.length);
        const match = items.find((it: any) => it.slug === slug);
        if (!match) throw new Error(`Flow not found for tool ${name}`);
        const flowArgs = { flowId: match.id, args };
        const proxyRes = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          { name: 'record_replay_flow_run', args: flowArgs },
          NativeMessageType.CALL_TOOL,
          120000,
        );
        if (proxyRes.status === 'success') {
          const normalized = normalizeToolCallResult(name, proxyRes.data);
          sessionManager.completeStep(session.sessionId, step.stepId, {
            status: 'completed',
            resultSummary: normalized.stepSummary,
          });
          sessionManager.finishSession(session.sessionId, {
            status: 'completed',
            summary: normalized.executionResult.summary,
          });
          return proxyRes.data;
        }
        const result = createErrorResult(`Error calling dynamic flow tool: ${proxyRes.error}`);
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: 'dynamic_flow_error',
          errorSummary: String(proxyRes.error || 'Unknown dynamic flow error'),
          resultSummary: `Dynamic flow ${name} failed`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Dynamic flow ${name} failed`,
        });
        return result;
      } catch (err: any) {
        const result = createErrorResult(
          `Error resolving dynamic flow tool: ${err?.message || String(err)}`,
        );
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: 'dynamic_flow_resolution_error',
          errorSummary: err?.message || String(err),
          resultSummary: `Dynamic flow ${name} could not be resolved`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Dynamic flow ${name} resolution failed`,
        });
        return result;
      }
    }
    // 发送请求到Chrome扩展并等待响应
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name,
        args,
      },
      NativeMessageType.CALL_TOOL,
      120000, // 延长到 120 秒，避免性能分析等长任务超时
    );
    if (response.status === 'success') {
      const normalized = normalizeToolCallResult(name, response.data);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: normalized.stepSummary,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'completed',
        summary: normalized.executionResult.summary,
      });
      return response.data;
    } else {
      const result = createErrorResult(`Error calling tool: ${response.error}`);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'tool_call_error',
        errorSummary: String(response.error || 'Unknown tool error'),
        resultSummary: `Tool ${name} failed`,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} failed`,
      });
      return result;
    }
  } catch (error: any) {
    const result = createErrorResult(`Error calling tool: ${error.message}`);
    sessionManager.completeStep(session.sessionId, step.stepId, {
      status: 'failed',
      errorCode: 'tool_call_exception',
      errorSummary: error.message,
      resultSummary: `Tool ${name} threw an exception`,
    });
    sessionManager.finishSession(session.sessionId, {
      status: 'failed',
      summary: `Tool ${name} threw an exception`,
    });
    return result;
  }
};
