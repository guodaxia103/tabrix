import { Socket } from 'node:net';
import { Duplex, Writable } from 'node:stream';

/**
 * Some Node 22 + @hono/node-server environments do not expose destroySoon().
 * Normalize this in tests to avoid post-suite forceClose crashes.
 */
if (typeof Socket.prototype.destroySoon !== 'function') {
  Socket.prototype.destroySoon = function destroySoonCompat() {
    try {
      this.end();
    } finally {
      this.destroy();
    }
  };
}

const duplexProto = Duplex.prototype as Duplex & { destroySoon?: () => void };
if (typeof duplexProto.destroySoon !== 'function') {
  duplexProto.destroySoon = function () {
    try {
      this.end?.();
    } finally {
      this.destroy?.();
    }
  };
}

const writableProto = Writable.prototype as Writable & { destroySoon?: () => void };
if (typeof writableProto.destroySoon !== 'function') {
  writableProto.destroySoon = function () {
    try {
      this.end?.();
    } finally {
      this.destroy?.();
    }
  };
}

const objectProto = Object.prototype as {
  destroySoon?: () => void;
  destroy?: () => void;
  end?: () => void;
};
if (typeof objectProto.destroySoon !== 'function') {
  Object.defineProperty(Object.prototype, 'destroySoon', {
    configurable: true,
    writable: true,
    enumerable: false,
    value: function destroySoonObjectCompat() {
      try {
        this.end?.();
      } catch {
        // ignore
      }
      try {
        this.destroy?.();
      } catch {
        // ignore
      }
    },
  });
}

const KNOWN_HONO_SOCKET_ERROR = 'socket.destroySoon is not a function';
const PROCESS_PATCH_FLAG = '__TABRIX_NATIVE_TEST_SOCKET_PATCH__';
const processAny = process as NodeJS.Process & { [PROCESS_PATCH_FLAG]?: boolean };
if (!processAny[PROCESS_PATCH_FLAG]) {
  processAny[PROCESS_PATCH_FLAG] = true;
  const originalSetTimeout = global.setTimeout.bind(global);
  global.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    if (typeof handler !== 'function') {
      return originalSetTimeout(handler, timeout, ...args);
    }
    const wrapped: TimerHandler = (...callbackArgs: unknown[]) => {
      try {
        return handler(...callbackArgs);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error ?? '');
        if (msg.includes(KNOWN_HONO_SOCKET_ERROR)) {
          return undefined;
        }
        throw error;
      }
    };
    return originalSetTimeout(wrapped, timeout, ...args);
  }) as typeof global.setTimeout;
  process.on('uncaughtException', (error) => {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    if (msg.includes(KNOWN_HONO_SOCKET_ERROR)) {
      // Ignore known upstream shutdown bug in @hono/node-server under Node 22.
      return;
    }
    throw error;
  });
}
