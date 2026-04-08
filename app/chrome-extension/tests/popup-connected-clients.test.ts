import { describe, expect, it } from 'vitest';
import { shouldApplyConnectedClientsResponse } from '@/common/popup-connected-clients';

describe('popup connected client response guard', () => {
  it('accepts responses from the current visible MCP server endpoint', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12306',
        showMcpConfig: true,
      }),
    ).toBe(true);
  });

  it('rejects responses after the popup leaves the MCP-ready state', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12306',
        showMcpConfig: false,
      }),
    ).toBe(false);
  });

  it('rejects responses from an outdated server endpoint', () => {
    expect(
      shouldApplyConnectedClientsResponse({
        requestedBaseUrl: 'http://127.0.0.1:12306',
        currentBaseUrl: 'http://127.0.0.1:12307',
        showMcpConfig: true,
      }),
    ).toBe(false);
  });
});
