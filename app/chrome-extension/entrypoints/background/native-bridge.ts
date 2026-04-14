type NativeBridgeForwarder = (message: any) => Promise<void>;
type NativeBridgeRequester = (request: {
  requestId: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}) => Promise<any>;

const NATIVE_BRIDGE_STATE_KEY = '__tabrixNativeBridgeState__';

function getNativeBridgeState(): {
  forwarder: NativeBridgeForwarder | null;
  requester: NativeBridgeRequester | null;
} {
  const globalScope = globalThis as typeof globalThis & {
    [NATIVE_BRIDGE_STATE_KEY]?: {
      forwarder: NativeBridgeForwarder | null;
      requester: NativeBridgeRequester | null;
    };
  };

  if (!globalScope[NATIVE_BRIDGE_STATE_KEY]) {
    globalScope[NATIVE_BRIDGE_STATE_KEY] = {
      forwarder: null,
      requester: null,
    };
  }

  return globalScope[NATIVE_BRIDGE_STATE_KEY]!;
}

export function registerNativeBridgeForwarder(forwarder: NativeBridgeForwarder | null): void {
  getNativeBridgeState().forwarder = forwarder;
}

export function registerNativeBridgeRequester(requester: NativeBridgeRequester | null): void {
  getNativeBridgeState().requester = requester;
}

export async function tryForwardToNativeBridge(message: any): Promise<boolean> {
  const nativeBridgeForwarder = getNativeBridgeState().forwarder;
  if (!nativeBridgeForwarder) {
    return false;
  }
  await nativeBridgeForwarder(message);
  return true;
}

export async function tryRequestNativeBridge(request: {
  requestId: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<any | null> {
  const nativeBridgeRequester = getNativeBridgeState().requester;
  if (!nativeBridgeRequester) {
    return null;
  }
  return await nativeBridgeRequester(request);
}
