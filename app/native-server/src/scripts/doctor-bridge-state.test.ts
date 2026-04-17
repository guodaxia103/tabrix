import { describeBridgeStatusForDoctor } from './doctor';

describe('describeBridgeStatusForDoctor', () => {
  it('describes browser-not-running state with non-invasive guidance', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BROWSER_NOT_RUNNING',
      },
    });

    expect(guidance.summary).toBe('浏览器未运行');
    expect(guidance.hint).toContain('普通状态检查中自启动');
    expect(guidance.fix).toContain('等待自动启动完成后重试一次');
  });

  it('describes extension-unavailable state with extension-specific fixes', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BROWSER_RUNNING_EXTENSION_UNAVAILABLE',
        lastBridgeErrorCode: 'TABRIX_EXTENSION_NOT_INSTALLED_OR_DISABLED',
      },
    });

    expect(guidance.summary).toBe('浏览器已运行但扩展不可用');
    expect(guidance.hint).toContain('扩展连接路径');
    expect(guidance.fix).toContain('在 chrome://extensions 中确认 Tabrix 扩展已安装并启用');
  });

  it('describes ready state without extra recovery steps', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'READY',
      },
    });

    expect(guidance.summary).toBe('桥接可用');
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

    expect(guidance.summary).toBe('桥接降级');
    expect(guidance.hint).toContain('桥接仍可恢复');
    expect(guidance.fix).toContain('等待执行通道恢复后重试一次');
  });

  it('describes degraded state as transient when command channel is still connected', () => {
    const guidance = describeBridgeStatusForDoctor({
      bridge: {
        bridgeState: 'BRIDGE_DEGRADED',
        commandChannelConnected: true,
        commandChannelType: 'websocket',
      },
    });

    expect(guidance.summary).toBe('桥接降级');
    expect(guidance.hint).toContain('桥接仍可恢复');
    expect(guidance.nextSteps).toContain('等待桥接稳定后重试一次');
  });
});
