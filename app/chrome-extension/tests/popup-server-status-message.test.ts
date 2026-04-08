import { describe, expect, it } from 'vitest';
import { shouldApplyPopupServerStatusMessage } from '@/common/popup-server-status-message';

describe('popup server status message guard', () => {
  it('accepts broadcasts when the popup is idle', () => {
    expect(
      shouldApplyPopupServerStatusMessage({
        desiredPort: 12307,
        isBusy: false,
        connected: true,
        serverStatus: {
          isRunning: true,
          port: 12306,
          lastUpdated: 1,
        },
      }),
    ).toBe(true);
  });

  it('rejects running broadcasts from a stale port while reconnecting', () => {
    expect(
      shouldApplyPopupServerStatusMessage({
        desiredPort: 12307,
        isBusy: true,
        connected: true,
        serverStatus: {
          isRunning: true,
          port: 12306,
          lastUpdated: 1,
        },
      }),
    ).toBe(false);
  });

  it('keeps disconnected broadcasts even while the popup is busy', () => {
    expect(
      shouldApplyPopupServerStatusMessage({
        desiredPort: 12307,
        isBusy: true,
        connected: false,
        serverStatus: {
          isRunning: false,
          port: 12306,
          lastUpdated: 1,
        },
      }),
    ).toBe(true);
  });
});
