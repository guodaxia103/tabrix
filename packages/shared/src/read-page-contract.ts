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
  /**
   * Optional raw `href` captured from the DOM snapshot. Present only for
   * link-like elements. Consumers MUST treat this as optional; older
   * snapshots do not emit it.
   *
   * Added in T5.4.5 to let downstream pickers disambiguate between
   * same-label links that point to different URLs (e.g. a workflow file
   * vs a workflow run on GitHub `/actions`).
   */
  href?: string;
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

/**
 * T5.4 object-type enumeration. Source of truth: Feishu
 * `Tabrix T5.4 高价值对象提取 正式产品级规格 v2026.04.20.1`.
 *
 * These are *semantic* types (what the object IS in task terms), distinct
 * from the legacy `kind` field (where the object came FROM).
 */
export type ReadPageObjectType =
  | 'nav_entry'
  | 'record'
  | 'entry'
  | 'control'
  | 'status_item'
  | 'metric_card'
  | 'doc_block';

export interface ReadPageHighValueObjectAction {
  type: 'open_detail' | 'click' | 'fill' | 'navigate' | 'expand' | string;
  ref?: string;
  actionType?: string;
}

/**
 * T3.2 legacy shape is preserved for backward compatibility. T5.4 adds
 * optional semantic fields (objectType / region / importance / reasons /
 * actions / sourceKind). The protocol starts emitting them at T5.4.4.
 * Until then the T3.2 fields are the only stable surface; downstream
 * consumers MUST treat T5.4 fields as optional.
 */
export interface ReadPageHighValueObject {
  id: string;
  kind: 'candidate_action' | 'interactive_element' | 'page_role_seed' | string;
  label: string;
  ref?: string;
  role?: string;
  actionType?: string;
  confidence?: number;
  reason: string;
  objectType?: ReadPageObjectType;
  /**
   * Optional family-specific sub-type that refines `objectType`. Carries
   * namespaced values like `'github.workflow_run_entry'` or
   * `'github.repo_nav_tab'`. Added in T5.4.5 to let downstream pickers
   * select the RIGHT link on visually-ambiguous pages (e.g. GitHub
   * `/actions` where workflow files and workflow runs look the same).
   *
   * Recommended GitHub values (non-exhaustive):
   *   - `github.repo_nav_tab`            (Issues / PRs / Actions / Security / Insights top nav)
   *   - `github.security_quality_tab`    (independent "Security and quality" tab)
   *   - `github.workflow_run_entry`      (a specific `/actions/runs/<id>` row)
   *   - `github.workflow_file_entry`     (a `.github/workflows/<name>.yml` link under /actions)
   *   - `github.workflow_filter_control` (filter button / `/actions?query=...`)
   *   - `github.page_anchor`             (in-page `#fragment` link like `#start-of-content`)
   *
   * Consumers MUST treat this as optional and use string-prefix matching
   * (`startsWith('github.')`) rather than exhaustive switches so new
   * values can be added without breaking downstream code.
   */
  objectSubType?: string;
  region?: string | null;
  importance?: number;
  reasons?: string[];
  actions?: ReadPageHighValueObjectAction[];
  sourceKind?: ReadPageSourceKind;
  /**
   * Optional raw `href` mirrored from the originating interactive element.
   * Present only for link-like objects. Added in T5.4.5 so an LLM / test
   * picker can match a target by URL instead of fragile label text.
   */
  href?: string;
  /**
   * B-011 stable targetRef. Format: `tgt_<10-hex>`, derived deterministically
   * from `(pageRole | objectSubType | role | normalizedLabel | hrefPathBucket
   * | ordinal)` so that the same logical DOM object surfaces the same value
   * across reloads, cosmetic class toggles, and minor list churn.
   *
   * Distinct from `id` (which is derived from per-snapshot `ref` and
   * therefore volatile) and from `ref` (the per-snapshot accessibility-tree
   * handle). Upstream callers MAY persist this value across turns and feed
   * it back as `candidateAction.targetRef` on `chrome_click_element` /
   * `chrome_fill_or_select` / `chrome_computer left_click|fill`. The click
   * bridge resolves it through an internal per-tab snapshot registry; if the
   * registry has no mapping (e.g. caller has not re-read the page since the
   * last navigation), the click bridge fails closed with a clear message
   * rather than silently aiming at a stale ref.
   *
   * Optional: present whenever the snapshot has enough signal to derive a
   * deterministic key. Older snapshots and degraded snapshots may omit it.
   */
  targetRef?: string;
}

/**
 * B-011 prefix marking a stable targetRef. Pure constant so the click
 * bridge can deterministically distinguish stable refs from per-snapshot
 * refs without parsing or guessing.
 */
export const STABLE_TARGET_REF_PREFIX = 'tgt_' as const;

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
