import { normalizeNativeLastError } from '@/common/normalize-native-last-error';

export function isNoServiceWorkerError(error: unknown): boolean {
  const message = normalizeNativeLastError(error) ?? String(error ?? '');
  return /\bno sw\b/i.test(message) || /service worker/i.test(message);
}
