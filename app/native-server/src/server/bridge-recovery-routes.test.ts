import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { bridgeRuntimeState } from './bridge-state';
import { __bridgeLaunchInternals } from '../mcp/bridge-recovery';
import { __bridgeCommandChannelInternals } from './bridge-command-channel';

describe('bridge recovery routes', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  afterEach(() => {
    bridgeRuntimeState.reset();
    __bridgeLaunchInternals.setBrowserLaunchTestOverride(null);
    __bridgeCommandChannelInternals.setTestMode('normal');
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
      guidance: {
        summary: '桥接恢复中',
      },
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
      guidance: {
        nextAction: '无法自动恢复该链路，请先运行 tabrix doctor --fix 后重试',
      },
    });
  });

  test('POST /bridge/testing/browser-launch-override 应设置并清理浏览器拉起测试注入', async () => {
    const setResponse = await supertest(Server.getInstance().server)
      .post('/bridge/testing/browser-launch-override')
      .send({ commands: ['C:\\__tabrix_missing_browser__\\chrome.exe'] })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(setResponse.body).toMatchObject({
      status: 'ok',
      data: {
        commands: ['C:\\__tabrix_missing_browser__\\chrome.exe'],
      },
    });
    expect(__bridgeLaunchInternals.getBrowserLaunchTestOverride()).toEqual([
      'C:\\__tabrix_missing_browser__\\chrome.exe',
    ]);

    const clearResponse = await supertest(Server.getInstance().server)
      .post('/bridge/testing/browser-launch-override')
      .send({ commands: null })
      .expect(200)
      .expect('Content-Type', /json/);

    expect(clearResponse.body).toMatchObject({
      status: 'ok',
      data: {
        commands: null,
      },
    });
    expect(__bridgeLaunchInternals.getBrowserLaunchTestOverride()).toBeNull();
  });

  test('POST /bridge/testing/command-channel 应设置并恢复命令通道测试模式', async () => {
    const setResponse = await supertest(Server.getInstance().server)
      .post('/bridge/testing/command-channel')
      .send({ mode: 'fail-next-send' })
      .expect(200)
      .expect('Content-Type', /json/)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          data: {
            mode: 'fail-next-send',
          },
        });
      });

    expect(setResponse.body.data.mode).toBe('fail-next-send');
    expect(__bridgeCommandChannelInternals.getTestMode()).toBe('fail-next-send');

    const clearResponse = await supertest(Server.getInstance().server)
      .post('/bridge/testing/command-channel')
      .send({ mode: 'normal' })
      .expect(200)
      .expect('Content-Type', /json/)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ok',
          data: {
            mode: 'normal',
          },
        });
      });

    expect(clearResponse.body.data.mode).toBe('normal');
    expect(__bridgeCommandChannelInternals.getTestMode()).toBe('normal');

    const invalidResponse = await supertest(Server.getInstance().server)
      .post('/bridge/testing/command-channel')
      .send({ mode: 'invalid-mode' })
      .expect(400)
      .expect('Content-Type', /json/);

    expect(invalidResponse.body).toMatchObject({
      status: 'error',
      message: 'Invalid mode for command channel testing',
    });
  });
});
