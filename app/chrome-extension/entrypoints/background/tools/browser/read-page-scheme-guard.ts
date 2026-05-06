import type { ReadPagePageType } from '@tabrix/shared';

export interface SchemeGuardSummary {
  scheme: string;
  pageType: ReadPagePageType;
  supportedForContentScript: boolean;
  unsupportedPageType: string | null;
  recommendedAction: string | null;
}

export function inferSchemeGuard(url: string): SchemeGuardSummary {
  const raw = String(url || '');
  const lower = raw.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return {
      scheme: lower.startsWith('https://') ? 'https' : 'http',
      pageType: 'web_page',
      supportedForContentScript: true,
      unsupportedPageType: null,
      recommendedAction: null,
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      scheme: 'chrome-extension',
      pageType: 'extension_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome://') || lower.startsWith('edge://') || lower.startsWith('about:')) {
    return {
      scheme: lower.startsWith('edge://')
        ? 'edge'
        : lower.startsWith('about:')
          ? 'about'
          : 'chrome',
      pageType: 'browser_internal_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('devtools://')) {
    return {
      scheme: 'devtools',
      pageType: 'devtools_page',
      supportedForContentScript: false,
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  const scheme = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).toLowerCase() : 'unknown';
  return {
    scheme,
    pageType: 'unsupported_page',
    supportedForContentScript: false,
    unsupportedPageType: 'non_web_tab',
    recommendedAction: 'switch_to_http_tab',
  };
}
