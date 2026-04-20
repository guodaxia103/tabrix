import type { ReadPagePrimaryRegionConfidence } from '@tabrix/shared';

export type CorePageRole = 'unknown' | 'outer_shell' | 'login_required';

export type PageRole = CorePageRole | (string & Record<never, never>);

export interface PageUnderstandingSummary {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
}

export interface PageUnderstandingContext {
  lowerUrl: string;
  lowerTitle: string;
  content: string;
  anchorTexts: string[];
  footerOnly: boolean;
}

export interface RegionRule {
  region: string;
  patterns: RegExp[];
  minMatches?: number;
  priority?: number;
  confidence: ReadPagePrimaryRegionConfidence;
}

export interface RegionResolution {
  region: string | null;
  confidence: ReadPagePrimaryRegionConfidence;
  matchedPatterns: number;
}

export interface PageFamilyAdapter {
  family: string;
  infer: (context: PageUnderstandingContext) => PageUnderstandingSummary | null;
}

export interface UnderstandingContextOptions {
  anchors?: readonly string[];
  footerDetector?: (content: string, anchorTexts: string[]) => boolean;
}

const GENERIC_LEGAL_FOOTER_PATTERN =
  /用户服务协议|隐私政策|联系我们|账号授权协议|terms of service|privacy policy|contact us/i;

export function collectAnchorTexts(pageContent: string, anchors: readonly string[] = []): string[] {
  if (!anchors.length) {
    return [];
  }
  return anchors.filter((anchor) => pageContent.includes(anchor));
}

export function detectLegalFooter(content: string): boolean {
  return GENERIC_LEGAL_FOOTER_PATTERN.test(content);
}

export function buildUnderstandingContext(
  url: string,
  title: string,
  pageContent: string,
  options: UnderstandingContextOptions = {},
): PageUnderstandingContext {
  const lowerUrl = String(url || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  const content = String(pageContent || '');
  const anchorTexts = collectAnchorTexts(content, options.anchors);
  const footerDetector = options.footerDetector ?? defaultFooterDetector;
  const footerOnly = footerDetector(content, anchorTexts);

  return {
    lowerUrl,
    lowerTitle,
    content,
    anchorTexts,
    footerOnly,
  };
}

function defaultFooterDetector(content: string, anchorTexts: string[]): boolean {
  if (!detectLegalFooter(content)) {
    return false;
  }
  const trimmedLength = content.replace(/\s+/g, '').length;
  const hasFewAnchors = anchorTexts.length <= 2;
  const isShortContent = trimmedLength <= 120;
  return hasFewAnchors && isShortContent;
}

export function hasAnySignal(sources: string[], patterns: RegExp[]): boolean {
  return patterns.some((pattern) => sources.some((source) => pattern.test(source)));
}

function countMatchedPatterns(sources: string[], patterns: RegExp[]): number {
  return patterns.filter((pattern) => sources.some((source) => pattern.test(source))).length;
}

export function resolvePrimaryRegion(
  sources: string[],
  rules: RegionRule[],
  fallbackRegion: string | null,
  fallbackConfidence: ReadPagePrimaryRegionConfidence,
): RegionResolution {
  let bestMatch: RegionResolution | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const rule of rules) {
    const matchedPatterns = countMatchedPatterns(sources, rule.patterns);
    const minMatches = Math.max(1, Number(rule.minMatches || 1));
    if (matchedPatterns < minMatches) {
      continue;
    }
    const score = matchedPatterns * 100 + Number(rule.priority || 0);

    if (!bestMatch || score > bestScore) {
      bestMatch = {
        region: rule.region,
        confidence: rule.confidence,
        matchedPatterns,
      };
      bestScore = score;
    }
  }

  return (
    bestMatch || {
      region: fallbackRegion,
      confidence: fallbackConfidence,
      matchedPatterns: 0,
    }
  );
}
