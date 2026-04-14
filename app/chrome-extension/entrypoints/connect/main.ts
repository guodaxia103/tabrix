import { NativeMessageType } from '@tabrix/shared';

const root = document.querySelector<HTMLDivElement>('#app');

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
  render('pending', '正在连接 Native Host，请稍候...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: NativeMessageType.CONNECT_NATIVE,
    });

    if (response?.success && response?.connected) {
      render('success', '连接成功。现在可以关闭此页面，继续使用 Tabrix。');
      return;
    }

    const reason =
      response?.lastError || response?.error || '连接未建立，请检查扩展和本地服务状态。';
    render('error', `连接失败：${String(reason)}`);
  } catch (error) {
    render('error', `连接失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

void connect();
