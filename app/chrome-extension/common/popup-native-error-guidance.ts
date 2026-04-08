export type PopupNativeErrorCategory = 'forbidden' | 'host-missing' | 'auth' | 'unknown';

export function classifyPopupNativeError(error: string): PopupNativeErrorCategory {
  const normalized = error.trim();
  if (!normalized) return 'unknown';

  const lower = normalized.toLowerCase();

  if (lower.includes('access to the specified native messaging host is forbidden')) {
    return 'forbidden';
  }

  if (
    lower.includes('specified native messaging host not found') ||
    lower.includes('native host has exited') ||
    lower.includes('failed to start native host')
  ) {
    return 'host-missing';
  }

  if (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('invalid token') ||
    lower.includes('token expired') ||
    lower.includes('token mismatch') ||
    lower.includes('missing authorization')
  ) {
    return 'auth';
  }

  return 'unknown';
}

export function getPopupNativeErrorGuidance(error: string): string | null {
  const normalized = error.trim();
  if (!normalized) return null;

  const category = classifyPopupNativeError(normalized);

  if (category === 'forbidden') {
    return [
      `最近一次连接错误: ${normalized}`,
      '诊断结论：当前扩展 ID 不在生效的 Native Messaging manifest.allowed_origins 中，或注册表指向了旧清单。',
      '建议：在终端执行 mcp-chrome-bridge doctor --fix；若仍失败，执行 mcp-chrome-bridge register --force，然后完全重启 Chrome 并在 chrome://extensions/ 重新加载扩展。',
    ].join(' ');
  }

  if (category === 'host-missing') {
    return [
      `最近一次连接错误: ${normalized}`,
      '诊断结论：Native host 未注册、路径失效或宿主启动失败。',
      '建议：执行 mcp-chrome-bridge doctor --fix；必要时 mcp-chrome-bridge register --force。',
    ].join(' ');
  }

  if (category === 'auth') {
    return [
      `最近一次连接错误: ${normalized}`,
      '诊断结论：远程访问 Token 缺失、过期或不匹配。',
      '建议：在扩展 Popup「远程」页刷新/复制 Token，并在客户端配置 Authorization 头。',
    ].join(' ');
  }

  return [
    `最近一次连接错误: ${normalized}`,
    '建议：执行 mcp-chrome-bridge doctor --fix 进行自动修复；仍失败时执行 mcp-chrome-bridge register --force，然后完全重启 Chrome。',
  ].join(' ');
}

export function getPopupRepairCommand(error: string | null): string | null {
  if (!error) return null;
  const category = classifyPopupNativeError(error);
  if (category === 'forbidden' || category === 'host-missing' || category === 'unknown') {
    return 'mcp-chrome-bridge doctor --fix && mcp-chrome-bridge register --force';
  }
  if (category === 'auth') {
    return null;
  }
  return null;
}
