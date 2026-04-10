import { getMessage } from '@/utils/i18n';

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
      getMessage('popupNativeGuidanceLastErrorPrefix', [normalized]),
      getMessage('popupNativeGuidanceForbiddenDiagnosis'),
      getMessage('popupNativeGuidanceForbiddenSuggestion'),
    ].join(' ');
  }

  if (category === 'host-missing') {
    return [
      getMessage('popupNativeGuidanceLastErrorPrefix', [normalized]),
      getMessage('popupNativeGuidanceHostMissingDiagnosis'),
      getMessage('popupNativeGuidanceHostMissingSuggestion'),
    ].join(' ');
  }

  if (category === 'auth') {
    return [
      getMessage('popupNativeGuidanceLastErrorPrefix', [normalized]),
      getMessage('popupNativeGuidanceAuthDiagnosis'),
      getMessage('popupNativeGuidanceAuthSuggestion'),
    ].join(' ');
  }

  return [
    getMessage('popupNativeGuidanceLastErrorPrefix', [normalized]),
    getMessage('popupNativeGuidanceUnknownSuggestion'),
  ].join(' ');
}

export function getPopupRepairCommand(error: string | null): string | null {
  if (!error) return null;
  const category = classifyPopupNativeError(error);
  if (category === 'forbidden' || category === 'host-missing' || category === 'unknown') {
    return 'tabrix doctor --fix && tabrix register --force';
  }
  if (category === 'auth') {
    return null;
  }
  return null;
}
