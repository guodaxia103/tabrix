import { describe, expect, it } from 'vitest';
import {
  classifyPopupNativeError,
  getPopupNativeErrorGuidance,
  getPopupRepairCommand,
} from '../common/popup-native-error-guidance';

describe('getPopupNativeErrorGuidance', () => {
  it('returns register guidance for forbidden errors', () => {
    const text = getPopupNativeErrorGuidance(
      'Access to the specified native messaging host is forbidden.',
    );
    expect(text).toContain('manifest.allowed_origins');
    expect(text).toContain('mcp-chrome-bridge register --force');
  });

  it('returns host registration guidance for missing host errors', () => {
    const text = getPopupNativeErrorGuidance('Specified native messaging host not found.');
    expect(text).toContain('Native host 未注册');
    expect(text).toContain('mcp-chrome-bridge doctor --fix');
  });

  it('returns token guidance for unauthorized errors', () => {
    const text = getPopupNativeErrorGuidance('401 Unauthorized');
    expect(text).toContain('Token');
    expect(text).toContain('Authorization');
  });

  it('returns fallback guidance for unknown errors', () => {
    const text = getPopupNativeErrorGuidance('some random network glitch');
    expect(text).toContain('some random network glitch');
    expect(text).toContain('mcp-chrome-bridge doctor --fix');
  });

  it('classifies forbidden errors and returns repair command', () => {
    expect(
      classifyPopupNativeError('Access to the specified native messaging host is forbidden.'),
    ).toBe('forbidden');
    expect(
      getPopupRepairCommand('Access to the specified native messaging host is forbidden.'),
    ).toContain('register --force');
  });

  it('returns null repair command for token errors', () => {
    expect(getPopupRepairCommand('401 Unauthorized')).toBeNull();
  });

  it('does not classify bare "token" as auth (narrowed matching)', () => {
    expect(classifyPopupNativeError('Connection reset by token ring adapter')).toBe('unknown');
  });

  it('classifies precise token errors as auth', () => {
    expect(classifyPopupNativeError('invalid token')).toBe('auth');
    expect(classifyPopupNativeError('token expired')).toBe('auth');
    expect(classifyPopupNativeError('token mismatch')).toBe('auth');
    expect(classifyPopupNativeError('missing authorization header')).toBe('auth');
  });
});
