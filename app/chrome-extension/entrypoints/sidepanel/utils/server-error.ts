const DB_BINDING_ERROR_PATTERNS = [
  'TABRIX_DB_BINDING_MISSING',
  'better-sqlite3',
  'better_sqlite3.node',
  'Could not locate the bindings file',
  'NODE_MODULE_VERSION',
];

function isDbBindingError(message: string): boolean {
  return DB_BINDING_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase()),
  );
}

function compactMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

export function normalizeAgentServerError(rawMessage: string, status?: number): string {
  const compact = compactMessage(rawMessage);
  if (isDbBindingError(compact)) {
    return '智能助手数据库组件未就绪（better-sqlite3）。请执行 `tabrix doctor --fix` 或重新用 npm 全局安装后重启 Chrome。';
  }
  if (!compact) {
    return status ? `HTTP ${status}` : '请求失败';
  }
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}

export function parseAgentServerErrorText(rawText: string, status?: number): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return normalizeAgentServerError('', status);
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return normalizeAgentServerError(parsed.error, status);
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return normalizeAgentServerError(parsed.message, status);
    }
  } catch {
    // ignore non-json response
  }

  return normalizeAgentServerError(trimmed, status);
}
