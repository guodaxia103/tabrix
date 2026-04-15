import { NativeMessageType } from '@tabrix/shared';

const root = document.querySelector<HTMLDivElement>('#app');
const callbackUrl = new URLSearchParams(window.location.search).get('callback');
const action = new URLSearchParams(window.location.search).get('action');

function buildCallbackNavigationUrl(payload: Record<string, unknown>): string | null {
  if (!callbackUrl) return null;
  try {
    const url = new URL(callbackUrl);
    url.searchParams.set('payload', JSON.stringify(payload));
    url.searchParams.set('ts', String(Date.now()));
    return url.toString();
  } catch {
    return null;
  }
}

function reportResultViaImage(payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    const navigationUrl = buildCallbackNavigationUrl(payload);
    if (!navigationUrl) {
      resolve();
      return;
    }

    const image = new Image();
    const finish = () => {
      image.onload = null;
      image.onerror = null;
      resolve();
    };

    image.onload = finish;
    image.onerror = finish;
    image.src = navigationUrl;
    window.setTimeout(finish, 500);
  });
}

async function reportResult(payload: Record<string, unknown>) {
  if (!callbackUrl) return;
  try {
    await fetch(callbackUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return;
  } catch {
    await reportResultViaImage(payload);
  }
}

function render(status: 'pending' | 'success' | 'error', detail: string) {
  if (!root) return;
  const tone =
    status === 'success' ? '#15803d' : status === 'error' ? '#b91c1c' : 'rgba(15, 23, 42, 0.82)';
  root.innerHTML = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; margin: 0;">
      <div style="width: min(480px, calc(100vw - 32px)); border-radius: 18px; padding: 28px 24px; background: #ffffff; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);">
        <div style="font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Tabrix</div>
        <h1 style="margin: 10px 0 8px; font-size: 24px; line-height: 1.2;">浏览器桥接自连接</h1>
        <p style="margin: 0; font-size: 15px; line-height: 1.65; color: ${tone};">${detail}</p>
      </div>
    </div>
  `;
}

async function connect() {
  if (action === 'reload') {
    render('pending', '正在刷新 Tabrix 扩展，请稍候...');
    await reportResult({ status: 'pending', action: 'reload' });

    try {
      const response = await chrome.runtime.sendMessage({
        type: NativeMessageType.RELOAD_EXTENSION,
      });
      render('success', '刷新请求已发送。扩展将立即重新加载。');
      await reportResult({ status: 'success', action: 'reload', response });
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      render('error', `刷新失败：${reason}`);
      await reportResult({ status: 'error', action: 'reload', reason });
      return;
    }
  }

  render('pending', '正在连接 Native Host，请稍候...');
  await reportResult({ status: 'pending' });

  try {
    const response = await chrome.runtime.sendMessage({
      type: NativeMessageType.CONNECT_NATIVE,
    });

    if (response?.success && response?.connected) {
      render('success', '连接成功。现在可以关闭此页面，继续使用 Tabrix。');
      await reportResult({ status: 'success', response });
      return;
    }

    const reason =
      response?.lastError || response?.error || '连接未建立，请检查扩展和本地服务状态。';
    render('error', `连接失败：${String(reason)}`);
    await reportResult({ status: 'error', reason, response });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    render('error', `连接失败：${reason}`);
    await reportResult({ status: 'error', reason });
  }
}

void connect();
