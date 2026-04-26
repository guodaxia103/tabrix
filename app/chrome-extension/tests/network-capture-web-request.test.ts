import { describe, expect, it } from 'vitest';
import {
  classifyNetworkCaptureEndpoint,
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
