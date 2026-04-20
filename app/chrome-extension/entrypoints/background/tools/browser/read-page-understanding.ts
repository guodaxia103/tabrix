import type {
  PageFamilyAdapter,
  PageRole,
  PageUnderstandingContext,
  PageUnderstandingSummary,
  RegionRule,
} from './read-page-understanding-core';
import {
  buildUnderstandingContext,
  hasAnySignal,
  resolvePrimaryRegion,
} from './read-page-understanding-core';
import { githubPageFamilyAdapter } from './read-page-understanding-github';
import { douyinPageFamilyAdapter } from './read-page-understanding-douyin';

export type { PageRole, PageUnderstandingSummary } from './read-page-understanding-core';

const PAGE_FAMILY_ADAPTERS: PageFamilyAdapter[] = [
  douyinPageFamilyAdapter,
  githubPageFamilyAdapter,
];

const LOGIN_GATE_RULES: RegionRule[] = [
  {
    region: 'login_gate',
    patterns: [/登录/i, /login/i, /signin/i, /手机号/i, /验证码/i, /phone/i, /code/i],
    minMatches: 2,
    priority: 1000,
    confidence: 'high',
  },
];

const FOOTER_SHELL_RULES: RegionRule[] = [
  {
    region: 'footer_shell',
    patterns: [
      /用户服务协议/i,
      /隐私政策/i,
      /联系我们/i,
      /账号授权协议/i,
      /terms of service/i,
      /privacy policy/i,
      /contact us/i,
    ],
    minMatches: 1,
    priority: 1000,
    confidence: 'low',
  },
];

function runFamilyAdapters(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  for (const adapter of PAGE_FAMILY_ADAPTERS) {
    const summary = adapter.infer(context);
    if (summary) {
      return summary;
    }
  }
  return null;
}

function inferLoginRequired(context: PageUnderstandingContext): PageUnderstandingSummary | null {
  const loginSignals = [context.lowerUrl, context.lowerTitle, context.content];
  const hasLoginHint = hasAnySignal(loginSignals, [/登录/i, /login/i, /signin/i]);
  const hasCredentialHint = hasAnySignal(loginSignals, [
    /手机号/i,
    /验证码/i,
    /phone/i,
    /code/i,
    /password/i,
    /密码/i,
    /email/i,
    /邮箱/i,
  ]);
  if (!hasLoginHint || !hasCredentialHint) {
    return null;
  }
  const loginRegion = resolvePrimaryRegion(loginSignals, LOGIN_GATE_RULES, 'login_gate', 'high');
  return {
    pageRole: 'login_required',
    primaryRegion: loginRegion.region,
    primaryRegionConfidence: loginRegion.confidence,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

function inferFallback(context: PageUnderstandingContext): PageUnderstandingSummary {
  if (context.footerOnly) {
    const footerRegion = resolvePrimaryRegion([context.content], FOOTER_SHELL_RULES, null, null);
    return {
      pageRole: 'outer_shell',
      primaryRegion: footerRegion.region || 'footer_shell',
      primaryRegionConfidence: footerRegion.confidence || 'low',
      footerOnly: true,
      anchorTexts: context.anchorTexts,
    };
  }
  return {
    pageRole: 'unknown',
    primaryRegion: null,
    primaryRegionConfidence: null,
    footerOnly: context.footerOnly,
    anchorTexts: context.anchorTexts,
  };
}

export function inferPageUnderstanding(
  url: string,
  title: string,
  pageContent: string,
): PageUnderstandingSummary {
  const neutralContext = buildUnderstandingContext(url, title, pageContent);

  const familySummary = runFamilyAdapters(neutralContext);
  if (familySummary) {
    return familySummary;
  }

  const loginSummary = inferLoginRequired(neutralContext);
  if (loginSummary) {
    return loginSummary;
  }

  return inferFallback(neutralContext);
}
