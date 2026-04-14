import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_SCHEMAS } from '@tabrix/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { sessionManager } from '../execution/session-manager';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { spawn, spawnSync } from 'node:child_process';

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

interface BridgeRecoveryResult {
  attempted: boolean;
  launched: boolean;
  command?: string;
  waitMs: number;
}

const BRIDGE_RECOVERY_WAIT_MS = 2500;

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRecoverableBridgeIssue(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  return (
    message.includes('bridge is unavailable') ||
    message.includes('native host connection not established') ||
    message.includes('native host is shutting down') ||
    message.includes('chrome disconnected') ||
    message.includes('request timed out') ||
    message.includes('not connected')
  );
}

function responseNeedsBridgeRecovery(response: any): boolean {
  if (!response || response.status === 'success') return false;
  return isRecoverableBridgeIssue(response.error || response.message || '');
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryLaunchCommand(command: string, args: string[]): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.once('error', () => done(false));
      setTimeout(() => {
        try {
          child.unref();
        } catch {
          // Ignore unref errors.
        }
        done(true);
      }, 200);
    } catch {
      done(false);
    }
  });
}

async function launchBrowserBestEffort(): Promise<{ launched: boolean; command?: string }> {
  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'cmd', args: ['/c', 'start', '', 'chrome', '--new-window', 'about:blank'] },
          { command: 'cmd', args: ['/c', 'start', '', 'chromium', '--new-window', 'about:blank'] },
        ]
      : process.platform === 'darwin'
        ? [
            { command: 'open', args: ['-a', 'Google Chrome', 'about:blank'] },
            { command: 'open', args: ['-a', 'Chromium', 'about:blank'] },
          ]
        : [
            { command: 'google-chrome', args: ['about:blank'] },
            { command: 'google-chrome-stable', args: ['about:blank'] },
            { command: 'chromium', args: ['about:blank'] },
            { command: 'chromium-browser', args: ['about:blank'] },
          ];

  for (const candidate of candidates) {
    const launched = await tryLaunchCommand(candidate.command, candidate.args);
    if (launched) {
      return {
        launched: true,
        command: `${candidate.command} ${candidate.args.join(' ')}`.trim(),
      };
    }
  }
  return { launched: false };
}

function hasBrowserProcessRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const chrome = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const chromium = spawnSync('tasklist', ['/FI', 'IMAGENAME eq chromium.exe'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const output = `${chrome.stdout || ''}\n${chromium.stdout || ''}`.toLowerCase();
      return output.includes('chrome.exe') || output.includes('chromium.exe');
    }
    if (process.platform === 'darwin') {
      const chrome = spawnSync('pgrep', ['-x', 'Google Chrome'], { encoding: 'utf8' });
      const chromium = spawnSync('pgrep', ['-x', 'Chromium'], { encoding: 'utf8' });
      return Boolean((chrome.stdout || '').trim() || (chromium.stdout || '').trim());
    }
    const chrome = spawnSync('pgrep', ['-x', 'google-chrome'], { encoding: 'utf8' });
    const chromeStable = spawnSync('pgrep', ['-x', 'google-chrome-stable'], { encoding: 'utf8' });
    const chromium = spawnSync('pgrep', ['-x', 'chromium'], { encoding: 'utf8' });
    const chromiumBrowser = spawnSync('pgrep', ['-x', 'chromium-browser'], { encoding: 'utf8' });
    return Boolean(
      (chrome.stdout || '').trim() ||
      (chromeStable.stdout || '').trim() ||
      (chromium.stdout || '').trim() ||
      (chromiumBrowser.stdout || '').trim(),
    );
  } catch {
    return false;
  }
}

function shouldSkipBrowserLaunchForError(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  // Native bridge / extension detach usually cannot be fixed by launching a new browser window.
  return message.includes('forward_to_native rejected');
}

async function attemptBridgeRecovery(
  _context: string,
  firstError: unknown,
): Promise<BridgeRecoveryResult> {
  if (!isRecoverableBridgeIssue(firstError)) {
    return { attempted: false, launched: false, waitMs: 0 };
  }
  const browserAlreadyRunning = hasBrowserProcessRunning();
  const skipLaunch = browserAlreadyRunning || shouldSkipBrowserLaunchForError(firstError);
  const launch = skipLaunch
    ? {
        launched: false,
        command: browserAlreadyRunning
          ? 'skip:browser-already-running'
          : 'skip:forward_to_native_rejected',
      }
    : await launchBrowserBestEffort();
  await wait(BRIDGE_RECOVERY_WAIT_MS);
  return {
    attempted: true,
    launched: launch.launched,
    command: launch.command,
    waitMs: BRIDGE_RECOVERY_WAIT_MS,
  };
}

function formatRecoveryError(error: unknown, recovery: BridgeRecoveryResult): string {
  const base = stringifyUnknownError(error);
  const code = recovery.attempted ? 'TABRIX_BRIDGE_RECOVERY_FAILED' : 'TABRIX_BRIDGE_NOT_READY';
  const launchPart = recovery.attempted
    ? ` launch=${recovery.launched ? 'ok' : 'failed'}`
    : ' launch=skipped';
  const commandPart = recovery.command ? ` command="${recovery.command}"` : '';
  return `[${code}] ${base}; recoveryAttempted=${recovery.attempted}; waitMs=${recovery.waitMs};${launchPart}${commandPart}. Open Chrome and ensure Tabrix extension remains connected.`;
}

async function callWithBridgeRecovery(
  invoker: () => Promise<any>,
  context: string,
): Promise<{ response: any; recovery?: BridgeRecoveryResult }> {
  try {
    const response = await invoker();
    if (!responseNeedsBridgeRecovery(response)) {
      return { response };
    }
    const recovery = await attemptBridgeRecovery(context, response.error || response.message);
    const retry = await invoker();
    if (responseNeedsBridgeRecovery(retry)) {
      return {
        response: {
          ...retry,
          error: formatRecoveryError(retry.error || retry.message, recovery),
        },
        recovery,
      };
    }
    return { response: retry, recovery };
  } catch (error) {
    if (!isRecoverableBridgeIssue(error)) {
      throw error;
    }
    const recovery = await attemptBridgeRecovery(context, error);
    try {
      const retry = await invoker();
      if (responseNeedsBridgeRecovery(retry)) {
        return {
          response: {
            ...retry,
            error: formatRecoveryError(retry.error || retry.message, recovery),
          },
          recovery,
        };
      }
      return { response: retry, recovery };
    } catch (retryError) {
      throw new Error(formatRecoveryError(retryError, recovery));
    }
  }
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
        const { response: proxyRes } = await callWithBridgeRecovery(
          () =>
            nativeMessagingHostInstance.sendRequestToExtensionAndWait(
              { name: 'record_replay_flow_run', args: flowArgs },
              NativeMessageType.CALL_TOOL,
              120000,
            ),
          `flow:${name}`,
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
    const { response } = await callWithBridgeRecovery(
      () =>
        nativeMessagingHostInstance.sendRequestToExtensionAndWait(
          {
            name,
            args,
          },
          NativeMessageType.CALL_TOOL,
          120000, // 延长到 120 秒，避免性能分析等长任务超时
        ),
      `tool:${name}`,
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
      const responseError = String(response.error || 'Unknown tool error');
      const isBridgeError =
        responseError.includes('TABRIX_BRIDGE_') || isRecoverableBridgeIssue(responseError);
      const result = createErrorResult(`Error calling tool: ${responseError}`);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: isBridgeError ? 'browser_bridge_not_ready' : 'tool_call_error',
        errorSummary: responseError,
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
