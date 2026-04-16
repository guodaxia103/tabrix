import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { bridgeRuntimeState } from './bridge-state';

describe('bridge recovery routes', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  afterEach(() => {
    bridgeRuntimeState.reset();
    jest.restoreAllMocks();
  });

  test('POST /bridge/recovery/start 与 /bridge/recovery/finish 应更新恢复状态', async () => {
    jest.spyOn(bridgeRuntimeState, 'syncBrowserProcessNow').mockImplementation(() => {
      bridgeRuntimeState.setBrowserProcessRunning(true);
      return true;
    });
    bridgeRuntimeState.setBrowserProcessRunning(true);
    bridgeRuntimeState.setNativeHostAttached(true);
    bridgeRuntimeState.setNativeHostAttached(false);

    const started = await supertest(Server.getInstance().server)
      .post('/bridge/recovery/start')
      .send({ action: 'ui_connect' })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(started.body).toMatchObject({
      status: 'ok',
      data: {
        action: 'ui_connect',
        bridgeState: 'BRIDGE_CONNECTING',
      },
    });

    const duringRecovery = await supertest(Server.getInstance().server).get('/status').expect(200);
    expect(duringRecovery.body.data.bridge).toMatchObject({
      bridgeState: 'BRIDGE_CONNECTING',
      recoveryInFlight: true,
      recoveryAttempts: 1,
      lastRecoveryAction: 'ui_connect',
    });

    const finished = await supertest(Server.getInstance().server)
      .post('/bridge/recovery/finish')
      .send({
        success: false,
        errorCode: 'TABRIX_NATIVE_CONNECT_FAILED',
        errorMessage: 'connect failed',
      })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(finished.body).toMatchObject({
      status: 'ok',
      data: {
        success: false,
        bridgeState: 'BRIDGE_BROKEN',
      },
    });

    const afterRecovery = await supertest(Server.getInstance().server).get('/status').expect(200);
    expect(afterRecovery.body.data.bridge).toMatchObject({
      bridgeState: 'BRIDGE_BROKEN',
      recoveryInFlight: false,
      recoveryAttempts: 1,
      lastRecoveryAction: 'ui_connect',
      lastBridgeErrorCode: 'TABRIX_NATIVE_CONNECT_FAILED',
      lastBridgeErrorMessage: 'connect failed',
    });
  });
});
