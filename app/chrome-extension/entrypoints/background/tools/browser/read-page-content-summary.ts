export interface ReadPageContentSummary {
  charCount: number;
  normalizedLength: number;
  lineCount: number;
  quality: string;
}

export function summarizePageContent(pageContent: string): ReadPageContentSummary {
  const normalized = (pageContent || '').replace(/\s+/g, ' ').trim();
  const lineCount = (pageContent || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;

  return {
    charCount: pageContent.length,
    normalizedLength: normalized.length,
    lineCount,
    quality: normalized.length < 120 || lineCount < 10 ? 'sparse' : 'usable',
  };
}

export function hasMeaningfulReadPageText(contentSummary: {
  normalizedLength: number;
  lineCount: number;
}): boolean {
  return contentSummary.normalizedLength >= 80 || contentSummary.lineCount >= 2;
}
