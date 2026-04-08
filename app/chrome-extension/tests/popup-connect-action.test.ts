import { describe, expect, it } from 'vitest';
import { ConnectionState } from '@/common/connection-state';
import { resolvePopupConnectAction } from '@/common/popup-connect-action';

describe('popup connect action state', () => {
  it('stays busy while the popup is bootstrapping', () => {
    expect(resolvePopupConnectAction(ConnectionState.CONNECTING, false, true)).toEqual({
      action: 'connect',
      busy: true,
    });
  });

  it('shows disconnect once the native host or server is ready', () => {
    expect(resolvePopupConnectAction(ConnectionState.RUNNING, false, false)).toEqual({
      action: 'disconnect',
      busy: false,
    });
  });

  it('returns to connect after failures', () => {
    expect(resolvePopupConnectAction(ConnectionState.ERROR, false, false)).toEqual({
      action: 'connect',
      busy: false,
    });
  });
});
