import { createErrorResponse, ToolResult } from '@/common/tool-handler';

interface NativeFilePayload {
  success?: boolean;
  filePath?: string;
  fileName?: string;
  size?: number;
  error?: string;
}

function hasNativeFileBridge(): boolean {
  const runtime = chrome?.runtime as any;
  return Boolean(
    runtime &&
    typeof runtime.sendMessage === 'function' &&
    runtime.onMessage &&
    typeof runtime.onMessage.addListener === 'function' &&
    typeof runtime.onMessage.removeListener === 'function',
  );
}

function buildRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function prepareFileViaNative(opts: {
  fileUrl?: string;
  base64Data?: string;
  fileName: string;
  timeoutMs?: number;
  requestPrefix?: string;
}): Promise<{ filename: string; fullPath?: string; size?: number }> {
  const { fileUrl, base64Data, fileName, timeoutMs = 30000, requestPrefix = 'native-file' } = opts;

  if (!hasNativeFileBridge()) {
    throw new Error('Native file bridge is unavailable');
  }
  if (!fileUrl && !base64Data) {
    throw new Error('Either fileUrl or base64Data must be provided');
  }

  const requestId = buildRequestId(requestPrefix);
  const payload = await new Promise<NativeFilePayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error(`Native file operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const listener = (message: any) => {
      if (
        message &&
        message.type === 'file_operation_response' &&
        message.responseToRequestId === requestId
      ) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        if (message.error) {
          reject(new Error(String(message.error)));
          return;
        }
        resolve((message.payload || {}) as NativeFilePayload);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime
      .sendMessage({
        type: 'forward_to_native',
        message: {
          type: 'file_operation',
          requestId,
          payload: {
            action: 'prepareFile',
            ...(fileUrl ? { fileUrl } : {}),
            ...(base64Data ? { base64Data } : {}),
            fileName,
          },
        },
      })
      .then((response: any) => {
        if (response?.success !== true) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          reject(
            new Error(
              `Native host unavailable: ${response?.error || 'forward_to_native rejected'}`,
            ),
          );
        }
      })
      .catch((error) => {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  if (!payload?.success || !payload.filePath) {
    throw new Error(`Native file operation failed: ${payload?.error || 'missing filePath'}`);
  }

  return {
    filename: payload.fileName || fileName,
    fullPath: payload.filePath,
    size: payload.size,
  };
}

export function createNativeFileErrorResponse(prefix: string, error: unknown): ToolResult {
  return createErrorResponse(
    `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
