/**
 * Read-page execution representation contract.
 *
 * T3.2 goal:
 * - lock a small stable layer for downstream tools
 * - keep candidate/action/memory-related fields as evolvable extensions
 */

export type ReadPageMode = 'compact' | 'normal' | 'full';

/**
 * V23-03 / B-015: render mode for `read_page`.
 *
 * `'json'` (default) is the existing behavior: a structured DOM-semantic
 * snapshot whose HVOs / candidateActions / `targetRef` are the execution
 * truth (see `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §4.1).
 *
 * `'markdown'` adds a low-token Markdown projection of the same snapshot
 * for text-heavy reading. The Markdown projection is a READING surface,
 * NOT an execution surface (§4.3): the JSON HVOs / candidateActions /
 * `targetRef` are still emitted unchanged so click resolution stays
 * deterministic. `L2` source routing (`markdownRef`) lets upstream
 * planners pick the right detail source instead of dumping both.
 */
export type ReadPageRenderMode = 'json' | 'markdown';

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

export type ReadPageSelectedDataSource =
  | 'api_rows'
  | 'cdp_enhanced_api_rows'
  | 'dom_region_rows'
  | 'dom_json'
  | 'markdown'
  | string;

export type ReadPageReadinessVerdict = 'ready' | 'empty' | 'error' | 'blocked' | 'unknown' | string;

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
  /**
   * V23-03 explicit source routing (per
   * `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §11.5). `L2` should
   * point the caller at the *right* deeper source instead of emitting all
   * three at once. Each field is optional and may be `null` when the
   * corresponding source is not currently available for this snapshot.
   *
   * - `domJsonRef`   — artifact ref for the structured DOM-semantic
   *   snapshot. Always populated in v1 because DOM JSON is the execution
   *   truth (§4.1).
   * - `markdownRef`  — artifact ref for the Markdown projection. Present
   *   only when `read_page(render='markdown')` was requested AND a
   *   markdown projection was successfully generated.
   * - `knowledgeRef` — placeholder for API Knowledge structured-data
   *   sources (B-017 / `knowledge_api_endpoints`). Always `null` in v1
   *   because the runtime call surface does not yet exist; reserved so
   *   downstream consumers can start coding against the field shape.
   */
  domJsonRef?: string | null;
  markdownRef?: string | null;
  knowledgeRef?: string | null;
}

export interface ReadPageVisibleRegionBoundingBox {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export interface ReadPageVisibleRegionRow {
  rowId: string;
  title: string;
  primaryText: string | null;
  secondaryText: string | null;
  summary: string | null;
  metaText: string | null;
  interactionText: string | null;
  visibleTextFields: string[];
  targetRef: string | null;
  targetRefCoverageRate: number;
  boundingBox: ReadPageVisibleRegionBoundingBox | null;
  regionId: string;
  sourceRegion: string;
  confidence: number;
  qualityReasons: string[];
}

export interface ReadPageVisibleRegionPageInfo {
  url: string | null;
  title: string | null;
  viewport: { width: number | null; height: number | null; dpr: number | null };
  scrollY: number | null;
  pixelsAbove: number | null;
  pixelsBelow: number | null;
  visibleRegionCount: number;
  candidateRegionCount: number;
}

export type ReadPageVisibleRegionRejectionReason =
  | 'low_value_region'
  | 'footer_like_region'
  | 'navigation_like_region'
  | 'target_ref_coverage_insufficient'
  | 'single_isolated_text'
  | 'empty_shell'
  | 'broad_page_shell'
  | 'dom_region_rows_unavailable';

export interface ReadPageVisibleRegionRows {
  sourceDataSource: 'dom_region_rows';
  rows: ReadPageVisibleRegionRow[];
  rowCount: number;
  visibleRegionRowsUsed: boolean;
  visibleRegionRowsRejectedReason: string | null;
  sourceRegion: string;
  rowExtractionConfidence: number;
  cardExtractorUsed: boolean;
  cardPatternConfidence: number;
  cardRowsCount: number;
  rowOrder: 'visual_order';
  targetRefCoverageRate: number;
  regionQualityScore: number;
  visibleDomRowsCandidateCount: number;
  visibleDomRowsSelectedCount: number;
  lowValueRegionRejectedCount: number;
  footerLikeRejectedCount: number;
  navigationLikeRejectedCount: number;
  targetRefCoverageRejectedCount: number;
  rejectedRegionReasonDistribution: Record<ReadPageVisibleRegionRejectionReason, number>;
  pageInfo: ReadPageVisibleRegionPageInfo;
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
  visibleRegionRows?: ReadPageVisibleRegionRows;
  /**
   * V27 additive AI-facing data-source router evidence.
   * Mirrors `visibleRegionRows` only when DOM region rows are actually used,
   * so gates and agents do not need to parse nested diagnostic details to
   * know which source was selected.
   */
  kind?: ReadPageSelectedDataSource;
  selectedDataSource?: ReadPageSelectedDataSource;
  readinessVerdict?: ReadPageReadinessVerdict;
  rowCount?: number;
  visibleRegionRowsUsed?: boolean;
  targetRefCoverageRate?: number;
  regionQualityScore?: number;
  visibleDomRowsCandidateCount?: number;
  visibleDomRowsSelectedCount?: number;
  lowValueRegionRejectedCount?: number;
  footerLikeRejectedCount?: number;
  navigationLikeRejectedCount?: number;
  targetRefCoverageRejectedCount?: number;
  rejectedRegionReasonDistribution?: Record<ReadPageVisibleRegionRejectionReason, number>;
  /**
   * V23-03 / B-015: which render mode was requested for this snapshot.
   * `'json'` is the default and matches the legacy contract. `'markdown'`
   * means a Markdown projection was opportunistically attached (see
   * `markdown` below); the JSON HVO/candidateActions/targetRef payload
   * is still emitted unchanged so execution paths are unaffected.
   *
   * Optional so older snapshots that pre-date V23-03 stay valid against
   * the contract.
   */
  renderMode?: ReadPageRenderMode;
  /**
   * V23-03 / B-015: optional Markdown projection of the snapshot's
   * top objects + interactive labels, intended as a *reading surface*
   * (per `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §4.3).
   *
   * MUST NOT be used as the source of truth for click/fill targeting;
   * `targetRef` / `candidateActions` remain authoritative. Present iff
   * `renderMode === 'markdown'` AND the projection succeeded.
   */
  markdown?: string | null;
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

// ---------------------------------------------------------------------------
// V25-02 — Layer Dispatch Runtime contract
// ---------------------------------------------------------------------------

/**
 * V25-02 / B-LAYER-DISPATCH: which layer envelope the caller wants
 * `chrome_read_page` to materialize. `L0+L1+L2` is the legacy default
 * shape that callers see when this field is omitted; the two narrower
 * shapes are opt-in by the chooser through the layer dispatcher.
 *
 * The values are intentionally serialization-stable strings (not bit
 * flags) so they can land in the MCP schema and the SQLite telemetry
 * column without a side index. Order of the values mirrors §11 of
 * `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` (smallest first).
 */
export type ReadPageRequestedLayer = 'L0' | 'L0+L1' | 'L0+L1+L2';

export const READ_PAGE_REQUESTED_LAYER_VALUES = ['L0', 'L0+L1', 'L0+L1+L2'] as const;

/**
 * V25-02: closed enum of dispatcher reasons. Each value corresponds to
 * one row of the V25-02 Layer Dispatch Strategy Table (V3.1 §V25-02).
 * Stable for telemetry; new reasons MUST be appended, not reordered or
 * renamed, because v2.5 release-gate aggregates against these names.
 */
export type LayerDispatchReason =
  // priority 1: safety override
  | 'safety_required_full_layers'
  // priority 2: user intent override
  | 'user_intent_summary'
  | 'user_intent_open_or_select'
  | 'user_intent_form_or_submit'
  | 'user_intent_details_or_compare'
  // priority 3: task type
  | 'task_type_reading_only'
  | 'task_type_action'
  // priority 4: page complexity
  | 'simple_page_low_density'
  | 'medium_page_overview'
  | 'complex_page_detail_required'
  // priority 5: MKEP support
  | 'experience_replay_executable'
  | 'knowledge_supports_summary'
  | 'knowledge_with_action'
  // priority 6: fail-safe
  | 'dispatcher_fallback_safe';

export const LAYER_DISPATCH_REASON_VALUES: readonly LayerDispatchReason[] = [
  'safety_required_full_layers',
  'user_intent_summary',
  'user_intent_open_or_select',
  'user_intent_form_or_submit',
  'user_intent_details_or_compare',
  'task_type_reading_only',
  'task_type_action',
  'simple_page_low_density',
  'medium_page_overview',
  'complex_page_detail_required',
  'experience_replay_executable',
  'knowledge_supports_summary',
  'knowledge_with_action',
  'dispatcher_fallback_safe',
] as const;

/**
 * V25-02 kickoff binding — locked 4-value `LayerSourceRoute` enum.
 * Source of truth for both telemetry and the v25 release gate.
 *
 * - `read_page_required` — caller MUST call `chrome_read_page` with
 *   the chosen layer; the chooser cannot pre-build context for it.
 * - `experience_replay_skip_read` — caller can replay a recorded path
 *   directly. `chrome_read_page` is NOT required ahead of replay.
 * - `knowledge_supported_read` — caller should call `chrome_read_page`
 *   but the chooser surfaced API Knowledge shape evidence as well.
 * - `dispatcher_fallback_safe` — dispatcher could not classify the
 *   input; fall back to `L0+L1+L2` and call `chrome_read_page`.
 *
 * Adding a fifth value requires a full v2.5 → v2.6 enum migration in
 * the release gate library, the telemetry column allow-list, and the
 * benchmark transformer's `KNOWN_SOURCE_ROUTES`.
 */
export type LayerSourceRoute =
  | 'read_page_required'
  | 'experience_replay_skip_read'
  | 'knowledge_supported_read'
  | 'dispatcher_fallback_safe';

export const LAYER_SOURCE_ROUTE_VALUES: readonly LayerSourceRoute[] = [
  'read_page_required',
  'experience_replay_skip_read',
  'knowledge_supported_read',
  'dispatcher_fallback_safe',
] as const;

/**
 * V25-02 token estimate helper — `ceil(byteLength / 4)`. Pure, no
 * dependencies. Mirrors the locked decision in V3.1 §V25-02 so the
 * dispatcher, the read-page tool, and the release gate all derive the
 * same numbers from the same source string.
 *
 * `null`/`undefined` input → 0. Callers MUST pass the UTF-8 byte
 * length explicitly when they have it (so rendered token counts stay
 * stable across surrogate pairs).
 */
export function estimateTokensFromBytes(byteLength: number | null | undefined): number {
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength) || byteLength <= 0) {
    return 0;
  }
  return Math.ceil(byteLength / 4);
}

/**
 * Convenience wrapper — most callers have a serialized JSON string.
 * Uses TextEncoder when available (browser + node 20+); falls back to
 * Buffer in plain Node.js test environments. Pure besides the global
 * lookup.
 */
export function estimateTokensFromString(serialized: string | null | undefined): number {
  if (typeof serialized !== 'string' || serialized.length === 0) {
    return 0;
  }
  let bytes: number;
  // Prefer the platform-native path so chrome-extension and native-server
  // agree on the count without pulling Buffer into the bundler graph.
  if (typeof TextEncoder !== 'undefined') {
    bytes = new TextEncoder().encode(serialized).length;
  } else {
    // Fallback: Node.js Buffer. Only reached in legacy test runners.

    const buf = (globalThis as { Buffer?: { byteLength(s: string, enc: string): number } }).Buffer;
    bytes = buf ? buf.byteLength(serialized, 'utf8') : serialized.length;
  }
  return estimateTokensFromBytes(bytes);
}
