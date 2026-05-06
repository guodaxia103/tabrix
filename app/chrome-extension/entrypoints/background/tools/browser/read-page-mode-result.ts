import type {
  ReadPageCompactSnapshot,
  ReadPageFullSnapshot,
  ReadPageNormalSnapshot,
  ReadPagePrimaryRegionConfidence,
} from '@tabrix/shared';

export function buildReadPageModeResult(params: {
  sharedPayload: ReadPageCompactSnapshot;
  mode: 'compact' | 'normal' | 'full';
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
  pageContent: string;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  stats: { processed: number; included: number; durationMs: number };
  elements: any[];
  count: number;
  markedElements: any[];
  refMap: any[];
  reason: string | null;
  tips: string;
}): ReadPageCompactSnapshot | ReadPageNormalSnapshot | ReadPageFullSnapshot {
  if (params.mode === 'compact') {
    return params.sharedPayload;
  }

  if (params.mode === 'normal') {
    return {
      ...params.sharedPayload,
      summary: {
        ...params.sharedPayload.summary,
        primaryRegionConfidence: params.primaryRegionConfidence,
        footerOnly: params.footerOnly,
        anchorTexts: params.anchorTexts,
      },
      diagnostics: {
        stats: params.stats,
        contentSummary: params.contentSummary,
        tips: params.tips,
        reason: params.reason,
      },
    };
  }

  return {
    ...params.sharedPayload,
    summary: {
      ...params.sharedPayload.summary,
      primaryRegionConfidence: params.primaryRegionConfidence,
      footerOnly: params.footerOnly,
      anchorTexts: params.anchorTexts,
    },
    fullSnapshot: {
      pageContent: params.pageContent,
      refMap: params.refMap,
      fallbackElements: params.elements,
      fallbackCount: params.count,
      markedElements: params.markedElements,
      stats: params.stats,
      contentSummary: params.contentSummary,
      tips: params.tips,
      reason: params.reason,
    },
  };
}
