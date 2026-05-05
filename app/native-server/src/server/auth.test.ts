import { afterEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type * as AuthModule from './auth';

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;
const ORIGINAL_MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  process.env.USERPROFILE = ORIGINAL_USERPROFILE;
  process.env.MCP_AUTH_TOKEN = ORIGINAL_MCP_AUTH_TOKEN;
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('TokenManager', () => {
  test('persists generated auth token with owner-only file mode', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-auth-'));
    delete process.env.MCP_AUTH_TOKEN;
    jest.resetModules();

    jest.spyOn(os, 'homedir').mockReturnValue(tempHome);
    const chmodSpy = jest.spyOn(fs, 'chmodSync');
    jest.isolateModules(() => {
      const { tokenManager } = require('./auth') as typeof AuthModule;
      chmodSpy.mockClear();
      tokenManager.refresh(7);
    });

    expect(chmodSpy).toHaveBeenCalledWith(path.join(tempHome, '.tabrix', 'auth-token.json'), 0o600);
  });
});
