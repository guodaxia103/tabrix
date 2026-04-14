import { describeBridgeStatusForDoctor } from './doctor';

describe('describeBridgeStatusForDoctor', () => {
  it('describes browser-not-running state with non-invasive guidance', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BROWSER_NOT_RUNNING',
      },
    });

    expect(guidance.summary).toBe('浏览器未运行');
    expect(guidance.hint).toContain('不会在普通状态检查时私自启动浏览器');
    expect(guidance.fix).toContain('手动打开 Chrome 后重试');
  });

  it('describes extension-unavailable state with extension-specific fixes', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE',
        lastBridgeErrorCode: 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED',
      },
    });

    expect(guidance.summary).toBe('浏览器已运行，但扩展不可用');
    expect(guidance.hint).toContain('检查扩展是否安装');
    expect(guidance.fix).toContain('在 chrome://extensions 中刷新 Tabrix 扩展');
  });

  it('describes ready state without extra recovery steps', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'READY',
      },
    });

    expect(guidance.summary).toBe('桥接已就绪');
    expect(guidance.fix).toHaveLength(0);
    expect(guidance.nextSteps).toHaveLength(0);
  });

  it('describes degraded state as command-channel issue when heartbeat exists but channel is missing', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BRIDGE_DEGRADED',
        commandChannelConnected: false,
      },
    });

    expect(guidance.summary).toBe('桥接暂时降级');
    expect(guidance.hint).toContain('执行桥尚未 ready');
    expect(guidance.fix).toContain('在 chrome://extensions 中刷新 Tabrix 扩展');
  });

  it('describes degraded state as transient when command channel is still connected', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BRIDGE_DEGRADED',
        commandChannelConnected: true,
        commandChannelType: 'websocket',
      },
    });

    expect(guidance.summary).toBe('桥接暂时降级');
    expect(guidance.hint).toContain('websocket');
    expect(guidance.nextSteps).toContain('tabrix smoke');
  });
});
