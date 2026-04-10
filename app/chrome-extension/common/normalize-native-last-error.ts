/**
 * Turn unknown / legacy-shaped native errors into a single-line UI string.
 * Prevents "[object Object]" when Chrome messaging or old storage returns an object.
 */
export function normalizeNativeLastError(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (raw instanceof Error) {
    const m = raw.message?.trim();
    return m && m.length > 0 ? m : null;
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) {
      return o.message.trim();
    }
    if (typeof o.error === 'string' && o.error.trim()) {
      return o.error.trim();
    }
    try {
      return JSON.stringify(raw);
    } catch {
      return 'Unknown error (unserializable object)';
    }
  }
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}
