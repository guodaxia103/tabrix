/**
 * Read-page execution representation contract.
 *
 * T3.2 goal:
 * - lock a small stable layer for downstream tools
 * - keep candidate/action/memory-related fields as evolvable extensions
 */

export type ReadPageMode = 'compact' | 'normal' | 'full';

export type ReadPagePageType =
  | 'web_page'
  | 'extension_page'
  | 'browser_internal_page'
  | 'devtools_page'
  | 'unsupported_page';

export type ReadPageQuality = 'usable' | 'sparse' | string;

export type ReadPagePrimaryRegionConfidence = 'low' | 'medium' | 'high' | null;

export interface ReadPagePage {
  url: string;
  title: string;
  pageType: ReadPagePageType;
}

export interface ReadPageSummary {
  pageRole: string;
  primaryRegion: string | null;
  quality: ReadPageQuality;
}

export interface ReadPageInteractiveElement {
  ref: string;
  role: string;
  name: string;
}

export interface ReadPageArtifactRef {
  kind: 'dom_snapshot' | string;
  ref: string;
}

export interface ReadPageCandidateActionLocator {
  type: 'ref' | 'aria' | 'css' | string;
  value: string;
}

export interface ReadPageCandidateAction {
  id: string;
  actionType: 'click' | 'fill' | string;
  targetRef: string;
  confidence: number;
  matchReason: string;
  locatorChain: ReadPageCandidateActionLocator[];
}

export interface ReadPagePageContext {
  filter: string;
  depth: number | null;
  focus: { refId: string; found: boolean } | null;
  scheme: string;
  viewport: { width: number | null; height: number | null; dpr: number | null };
  sparse: boolean;
  fallbackUsed: boolean;
  fallbackSource: string | null;
  refMapCount: number;
  markedElementsCount: number;
}

export interface ReadPageFrameContext {
  frameId?: number;
  frameUrl?: string;
  frameName?: string;
}

export interface ReadPageMemoryHint {
  key: string;
  value: string;
  confidence?: number;
}

export type ReadPageTaskMode = 'search' | 'read' | 'compare' | 'extract' | 'monitor';

export type ReadPageComplexityLevel = 'simple' | 'medium' | 'complex';

export type ReadPageSourceKind = 'embedded_state' | 'page_api' | 'dom_semantic' | 'artifact';

export interface ReadPageHighValueObject {
  id: string;
  kind: 'candidate_action' | 'interactive_element' | string;
  label: string;
  ref?: string;
  role?: string;
  actionType?: string;
  confidence?: number;
  reason: string;
}

export interface ReadPageTaskLevel0 {
  summary: string;
  taskMode: ReadPageTaskMode;
  pageRole: string;
  primaryRegion: string | null;
  focusObjectIds: string[];
}

export interface ReadPageTaskLevel1 {
  overview: string;
  highValueObjectIds: string[];
  candidateActionIds: string[];
}

export interface ReadPageTaskLevel2 {
  available: boolean;
  defaultAccess: 'artifact_ref' | 'inline_full_snapshot';
  detailRefs: string[];
  expansions: string[];
  boundary: string;
}

export interface ReadPageExtensionFields {
  candidateActions?: ReadPageCandidateAction[];
  pageContext?: ReadPagePageContext;
  frameContext?: ReadPageFrameContext | null;
  historyRef?: string | null;
  memoryHints?: ReadPageMemoryHint[];
  taskMode?: ReadPageTaskMode;
  complexityLevel?: ReadPageComplexityLevel;
  sourceKind?: ReadPageSourceKind;
  highValueObjects?: ReadPageHighValueObject[];
  L0?: ReadPageTaskLevel0;
  L1?: ReadPageTaskLevel1;
  L2?: ReadPageTaskLevel2;
}

export interface ReadPageStableSnapshot {
  mode: ReadPageMode;
  page: ReadPagePage;
  summary: ReadPageSummary;
  interactiveElements: ReadPageInteractiveElement[];
  artifactRefs: ReadPageArtifactRef[];
}

export interface ReadPageCompactSnapshot extends ReadPageStableSnapshot, ReadPageExtensionFields {}

export interface ReadPageDiagnostics {
  stats: { processed: number; included: number; durationMs: number };
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: ReadPageQuality;
  };
  tips: string;
  reason: string | null;
}

export interface ReadPageNormalSnapshot extends ReadPageCompactSnapshot {
  summary: ReadPageSummary & {
    primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
    footerOnly?: boolean;
    anchorTexts?: string[];
  };
  diagnostics: ReadPageDiagnostics;
}

export interface ReadPageFullSnapshot extends ReadPageCompactSnapshot {
  summary: ReadPageSummary & {
    primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
    footerOnly?: boolean;
    anchorTexts?: string[];
  };
  fullSnapshot: {
    pageContent: string;
    refMap: unknown[];
    fallbackElements: unknown[];
    fallbackCount: number;
    markedElements: unknown[];
    stats: { processed: number; included: number; durationMs: number };
    contentSummary: {
      charCount: number;
      normalizedLength: number;
      lineCount: number;
      quality: ReadPageQuality;
    };
    tips: string;
    reason: string | null;
  };
}

export const READ_PAGE_MODE_MINIMUM_FIELDS: Record<ReadPageMode, readonly string[]> = {
  compact: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs'],
  normal: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'diagnostics'],
  full: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'fullSnapshot'],
};

export const READ_PAGE_TASK_PROTOCOL_FIELDS = [
  'taskMode',
  'complexityLevel',
  'sourceKind',
  'highValueObjects',
  'L0',
  'L1',
  'L2',
] as const;
