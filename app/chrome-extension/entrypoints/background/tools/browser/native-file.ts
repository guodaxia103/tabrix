import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import {
  tryForwardToNativeBridge,
  tryRequestNativeBridge,
} from '@/entrypoints/background/native-bridge';

interface NativeFilePayload {
  success?: boolean;
  filePath?: string;
  fileName?: string;
  size?: number;
  error?: string;
}

interface NativeFileOperationOptions {
  payload: Record<string, unknown>;
  timeoutMs?: number;
  requestPrefix?: string;
  unavailableMessage?: string;
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

export async function requestNativeFileOperation(
  options: NativeFileOperationOptions,
): Promise<any> {
  const {
    payload,
    timeoutMs = 30000,
    requestPrefix = 'native-file',
    unavailableMessage = 'Native host unavailable',
  } = options;

  if (!hasNativeFileBridge()) {
    throw new Error('Native file bridge is unavailable');
  }

  const requestId = buildRequestId(requestPrefix);
  const bridgeResponse = await tryRequestNativeBridge({
    requestId,
    payload,
    timeoutMs,
  });
  if (bridgeResponse !== null) {
    return bridgeResponse;
  }

  return await new Promise<any>((resolve, reject) => {
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

    const envelope = {
      type: 'file_operation',
      requestId,
      payload,
    };

    const sendViaRuntime = () =>
      chrome.runtime.sendMessage({
        type: 'forward_to_native',
        message: envelope,
      });

    chrome.runtime.onMessage.addListener(listener);

    tryForwardToNativeBridge(envelope)
      .then(async (handledByBridge) => {
        if (handledByBridge) {
          return { success: true };
        }
        return await sendViaRuntime();
      })
      .then((response: any) => {
        if (response?.success !== true) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          reject(
            new Error(`${unavailableMessage}: ${response?.error || 'forward_to_native rejected'}`),
          );
        }
      })
      .catch((error) => {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
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

  const payload = await requestNativeFileOperation({
    timeoutMs,
    requestPrefix,
    unavailableMessage: 'Native host unavailable',
    payload: {
      action: 'prepareFile',
      ...(fileUrl ? { fileUrl } : {}),
      ...(base64Data ? { base64Data } : {}),
      fileName,
    },
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
