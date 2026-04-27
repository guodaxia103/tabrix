import { describe, expect, it } from 'vitest';
import {
  classifyNetworkCaptureEndpoint,
  evaluateNetworkCaptureObserveModeGate,
  isNetworkCaptureObserveMode,
  redactNetworkCaptureUrlForMetadata,
  sanitizeNetworkCaptureHeaders,
} from '@/entrypoints/background/tools/browser/network-capture-web-request';

describe('network capture webRequest metadata helpers', () => {
  it('redacts raw query values while preserving query keys', () => {
    const redacted = redactNetworkCaptureUrlForMetadata(
      'https://api.github.com/search/repositories?q=AI助手&sort=stars&order=desc',
    );

    expect(redacted).toBe('https://api.github.com/search/repositories?order=&q=&sort=');
    expect(redacted).not.toContain('AI助手');
    expect(redacted).not.toContain('stars');
    expect(redacted).not.toContain('desc');
  });

  it('keeps only safe header names and strips all header values', () => {
    const headers = sanitizeNetworkCaptureHeaders({
      Authorization: 'Bearer ghp_SECRET',
      Cookie: 'session=secret',
      Accept: 'application/json',
      'User-Agent': 'Tabrix',
      'X-Api-Key': 'sk-secret',
    });

    expect(headers).toEqual({
      accept: '',
      'user-agent': '',
    });
    expect(JSON.stringify(headers)).not.toMatch(/SECRET|session=|Tabrix|sk-secret/);
  });

  it('classifies usable API candidates and noisy private telemetry separately', () => {
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://api.github.com/search/repositories?q=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('usable');
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://api.github.com/_private/browser/stats?token=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('private');
    expect(
      classifyNetworkCaptureEndpoint({
        url: 'https://assets.example.test/app.css',
        method: 'GET',
        type: 'stylesheet',
        mimeType: 'text/css',
      }),
    ).toBe('asset');
  });
});

describe('V26-FIX-02 — network capture observe-mode gate', () => {
  it('null override → proceed (legacy v2.5 behaviour)', () => {
    expect(evaluateNetworkCaptureObserveModeGate(null)).toEqual({
      action: 'proceed',
      reason: 'no_override',
    });
  });

  it('foreground override → proceed', () => {
    expect(evaluateNetworkCaptureObserveModeGate('foreground')).toEqual({
      action: 'proceed',
      reason: 'foreground_requested',
    });
  });

  it('background override → skip (passive listeners only)', () => {
    expect(evaluateNetworkCaptureObserveModeGate('background')).toEqual({
      action: 'skip',
      reason: 'background_passive',
    });
  });

  it('disabled override → skip (chooser advisory)', () => {
    expect(evaluateNetworkCaptureObserveModeGate('disabled')).toEqual({
      action: 'skip',
      reason: 'disabled_advisory',
    });
  });

  it('isNetworkCaptureObserveMode is closed-enum', () => {
    expect(isNetworkCaptureObserveMode('foreground')).toBe(true);
    expect(isNetworkCaptureObserveMode('background')).toBe(true);
    expect(isNetworkCaptureObserveMode('disabled')).toBe(true);
    expect(isNetworkCaptureObserveMode('')).toBe(false);
    expect(isNetworkCaptureObserveMode('FOREGROUND')).toBe(false);
    expect(isNetworkCaptureObserveMode(null)).toBe(false);
    expect(isNetworkCaptureObserveMode(undefined)).toBe(false);
    expect(isNetworkCaptureObserveMode(42)).toBe(false);
  });
});
