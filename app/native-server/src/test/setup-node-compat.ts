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

const KNOWN_HONO_SOCKET_ERROR = 'socket.destroySoon is not a function';
const PROCESS_PATCH_FLAG = '__TABRIX_NATIVE_TEST_SOCKET_PATCH__';
const processAny = process as NodeJS.Process & { [PROCESS_PATCH_FLAG]?: boolean };
if (!processAny[PROCESS_PATCH_FLAG]) {
  processAny[PROCESS_PATCH_FLAG] = true;
  process.on('uncaughtException', (error) => {
    const msg = error instanceof Error ? error.message : String(error ?? '');
    if (msg.includes(KNOWN_HONO_SOCKET_ERROR)) {
      // Ignore known upstream shutdown bug in @hono/node-server under Node 22.
      return;
    }
    throw error;
  });
}
