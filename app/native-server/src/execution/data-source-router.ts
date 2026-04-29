import type { ContextStrategyName, LayerSourceRoute, ReadPageRequestedLayer } from '@tabrix/shared';
import type {
  EndpointSource,
  EndpointLastFailureReason,
  SeedAdapterRetirementState,
} from '../memory/knowledge/knowledge-api-repository';
import type { EndpointCandidateSemanticType } from '../memory/knowledge/network-observe-classifier';
import { mapDataSourceToLayerContract, type LayerContractEnvelope } from './layer-contract';

export type DataSourceKind =
  | 'experience_replay'
  | 'api_list'
  | 'api_detail'
  | 'dom_region_rows'
  | 'markdown'
  | 'dom_json';

export type DataSourceRiskTier = 'low' | 'medium' | 'high';

export interface DataSourceCostEstimate {
  chosenTokens: number;
  fullReadTokens: number;
  savedTokensEstimate: number;
}

export interface DataSourceFallbackPlan {
  dataSource: 'dom_json';
  entryLayer: 'L0' | 'L0+L1';
  reason: string;
}

// ------------------------------------------------------------
// V27-09 — additive closed enums for the V2 router inputs.
// All values include `'unknown'` so a v2.6 caller that does not
// supply the field surfaces as "we have no opinion" rather than
// throwing. The router never invents these — it only consumes
// what upstream lifecycle / fact-collector / readiness-profiler /
// task-intent-resolver supplied.
// ------------------------------------------------------------

/** V27-02 verdict on whether the supplied `factSnapshotId` is fresh. */
export type FactSnapshotVerdict = 'fresh' | 'stale' | 'missing' | 'unknown';

/** V27-04a readiness verdict feeding the router. */
export type ReadinessVerdict =
  | 'ready'
  | 'document_loading'
  | 'empty'
  | 'error_or_blocked'
  | 'unknown';

/** V27-04b complexity class feeding the router. */
export type ComplexityClass =
  | 'simple'
  | 'list'
  | 'detail'
  | 'document'
  | 'transactional'
  | 'media'
  | 'complex_app'
  | 'unknown';

/**
 * V27-09 — task intent class consumed by the router. Closed enum;
 * upstream resolver maps user-intent strings into one of these.
 * `'click_or_fill'` is the DOM-refs-authority bucket — the router
 * MUST route this to `dom_json` regardless of API knowledge,
 * because API/Markdown/JSON are never locator/execution authority.
 */
export type TaskIntentClass = 'search_list' | 'detail' | 'document' | 'click_or_fill' | 'unknown';

/**
 * V27-09 — closed-enum signal on whether this decision touches the
 * public MCP response shape. Default for a V27-09 router decision
 * is `'none'`; the new evidence fields stay native-server-internal
 * unless owner-lane explicitly approves a public surface delta in
 * a follow-up task. See SoT V3 §V27-09 "Public-surface delta".
 */
export type PublicSurfaceDelta = 'none' | 'additive_internal' | 'additive_public';

/**
 * V27-09 — endpoint evidence the router consumes from the
 * V27-06 / V27-07 / V27-08 closeout. The router NEVER re-derives
 * these — it only reads the closed-enum verdicts the upstream
 * classifier / correlator / repository emitted.
 *
 * Field-by-field cite (SoT V3 §V27-09 "必须消费 V27-06/07/08 closeout
 * 后的 evidence"):
 *
 *   - `endpointSource`            — `EndpointSource` from V27-08.
 *   - `seedAdapterRetirementState`— V27-08 derived state.
 *   - `correlationScore`          — V27-07 numeric `[0, 1]` score.
 *   - `pageRegion`                — V27-07 `correlatedRegionId` alias.
 *   - `inferredSemanticType`      — V27-06 verdict carried through V27-07.
 *   - `evidenceKinds`             — V27-06 `evidenceKinds` list (or
 *                                    V27-07 `correlationSignals` alias).
 *   - `sampleCount`               — V27-07 sample count (always `>= 1`).
 *   - `falseCorrelationGuard`     — V27-07 `[0, 1]` guard.
 *   - `correlationMode`           — V27-07 source mode.
 *   - `lastFailureReason`         — V27-08 last-failure reason.
 *   - `confidence`                — composite confidence from the
 *                                    lookup ranker (`scoreEndpointKnowledge`).
 *   - `usableForTask`             — true iff above the lookup floor.
 */
export interface RouterEndpointEvidence {
  endpointSource: EndpointSource;
  seedAdapterRetirementState: SeedAdapterRetirementState;
  correlationScore: number;
  pageRegion: string | null;
  inferredSemanticType: EndpointCandidateSemanticType;
  evidenceKinds: ReadonlyArray<string>;
  sampleCount: number;
  falseCorrelationGuard: number;
  correlationMode: string;
  lastFailureReason: EndpointLastFailureReason | null;
  confidence: number;
  usableForTask: boolean;
}

export interface RouterDomRegionRowsEvidence {
  available: boolean;
  rowCount: number;
  confidence: number;
  targetRefCoverageRate?: number | null;
  rejectedReason?: string | null;
}

export interface DataSourceDecisionInput {
  // ---------------- v2.6 (kept verbatim for back-compat) ----------------
  strategy?: ContextStrategyName;
  sourceRoute: LayerSourceRoute;
  chosenLayer: ReadPageRequestedLayer;
  layerDispatchReason?: string;
  tokenEstimateChosen?: number;
  tokenEstimateFullRead?: number;
  tokensSavedEstimate?: number;
  apiCandidateAvailable?: boolean;
  dispatcherInputSource?: string | null;

  // ---------------- V27-09 additive (all optional) ----------------------
  /** V27-09 — task intent class. When omitted the router falls back to
   *  the v2.6 strategy/sourceRoute path (R_KNOWLEDGE_SUPPORTED_LEGACY). */
  taskIntent?: TaskIntentClass;
  /** V27-05 context manager version pin. Null = caller had no version. */
  contextVersion?: string | null;
  /** V27-02 fact snapshot id the upstream observation produced. */
  factSnapshotId?: string | null;
  /** V27-02 verdict on the snapshot freshness. */
  factSnapshotVerdict?: FactSnapshotVerdict;
  /** V27-04a readiness verdict. */
  readinessVerdict?: ReadinessVerdict;
  /** V27-04b complexity class. */
  complexityClass?: ComplexityClass;
  /** V27-06/07/08 endpoint evidence. Null when no candidate fired. */
  endpointEvidence?: RouterEndpointEvidence | null;
  /** V27-P0-REAL-03 — DOM/AX visible-region row evidence from read_page. */
  domRegionRowsEvidence?: RouterDomRegionRowsEvidence | null;
}

export interface DataSourceDecision {
  // ---------------- v2.6 (kept verbatim for back-compat) ----------------
  sourceRoute: LayerSourceRoute;
  dataSource: DataSourceKind;
  chosenSource: DataSourceKind;
  confidence: number;
  costEstimate: DataSourceCostEstimate;
  riskTier: DataSourceRiskTier;
  fallbackPlan: DataSourceFallbackPlan;
  decisionReason: string;
  dispatcherInputSource: string;
  /**
   * V26-FIX-06 — frozen layer-contract envelope describing what the
   * downstream reader/orchestrator may do with this data source.
   * Always present. Read-only at the boundary; consumers MUST call
   * `assertLayerContract(layerContract, intendedUse)` before using
   * the row as a locator/execution target.
   */
  layerContract: LayerContractEnvelope;

  // ---------------- V27-09 additive evidence-contract fields -----------
  /** V27-09 — SoT V3 alias of `dataSource`. Same value, named to match
   *  the SoT V3 evidence-contract spec. Derived from `dataSource`,
   *  not re-computed, so writer drift is impossible. */
  selectedDataSource: DataSourceKind;
  /** V27-09 — read layer the router actually authorised. Mirrors
   *  `layerContract.layer`, NOT the raw `chosenLayer` input — the
   *  layer contract is the only source of truth for what the
   *  downstream reader is allowed to read. For api_rows / markdown
   *  / non-detail api_detail this clamps to L0+L1 even when the
   *  upstream layer dispatcher requested L0+L1+L2; this prevents
   *  evidence reports from over-claiming L2 reads.
   *
   *  See `requestedLayer` for the original input layer, kept as an
   *  additive internal field so operation logs that need both the
   *  ask and the authorised layer have a non-lossy record. */
  selectedLayer: ReadPageRequestedLayer;
  /** V27-09 closeout — original `chosenLayer` input from the upstream
   *  layer dispatcher. Kept for evidence-trail completeness when
   *  `selectedLayer` was clamped by the layer contract. Internal
   *  native-server field; no public MCP surface change. */
  requestedLayer: ReadPageRequestedLayer;
  /** V27-09 — context version the router consumed. `null` when the
   *  caller did not supply one (e.g. legacy v2.6 caller). */
  contextVersion: string | null;
  /** V27-09 — fact-snapshot freshness verdict the router consumed.
   *  `'unknown'` when not supplied. */
  factSnapshotVerdict: FactSnapshotVerdict;
  /** V27-09 — stable id of the rule in `DATA_SOURCE_ROUTER_RULES` that
   *  fired. Always non-empty; one of `DATA_SOURCE_ROUTER_RULE_IDS`. */
  decisionRuleId: DataSourceRouterRuleId;
  /** V27-09 — declares whether this decision touches the public MCP
   *  response shape. Default `'none'` for V27-09; the additive
   *  evidence fields stay native-server-internal. */
  publicSurfaceDelta: PublicSurfaceDelta;
}

// ----------------------------------------------------------------------
// V27-09 — Truth table.
//
// Each rule is a small object with:
//   - `id`     : stable closed-enum id surfaced as `decisionRuleId`.
//   - `match`  : pure predicate over the input. Returning `true` means
//                this rule wins; the executor builds the decision via
//                `produce()` and does not consult later rules.
//   - `produce`: pure decision builder.
//
// The list ORDER IS THE PRIORITY. We check the most-specific rules
// first (experience replay > intent override > dispatcher fail-safe
// > V27-09 evidence-driven > legacy v2.6 > default), so a v2.6 caller
// that supplies no V27-09 evidence still walks straight into the
// legacy rules and produces a bit-identical decision.
//
// Why a table and not nested if/else: SoT V3 §V27-09 explicitly bans
// "不可审计的 if-else 串". A single ordered table is auditable: every
// rule has an id, a one-line predicate, and a one-line producer; the
// test suite asserts every id has at least one matching test.
// ----------------------------------------------------------------------

export type DataSourceRouterRuleId =
  | 'R_EXPERIENCE_REPLAY'
  | 'R_CLICK_FILL_DOM_AUTHORITY'
  | 'R_DISPATCHER_FAIL_SAFE_DOM'
  | 'R_FACTS_STALE_DEMOTE_DOM'
  | 'R_DEPRECATED_SEED_DEMOTE_DOM'
  | 'R_API_LIST_HIGH_CONFIDENCE'
  | 'R_API_DETAIL_HIGH_CONFIDENCE'
  | 'R_DOM_REGION_ROWS_HIGH_CONFIDENCE'
  | 'R_MARKDOWN_READING_SURFACE'
  | 'R_EMPTY_RESULT_API_CONFIRMED'
  | 'R_EMPTY_RESULT_DOM_CONFIRM'
  | 'R_KNOWLEDGE_SUPPORTED_LEGACY'
  | 'R_DOM_DEFAULT';

export const DATA_SOURCE_ROUTER_RULE_IDS: ReadonlyArray<DataSourceRouterRuleId> = [
  'R_EXPERIENCE_REPLAY',
  'R_CLICK_FILL_DOM_AUTHORITY',
  'R_DISPATCHER_FAIL_SAFE_DOM',
  'R_FACTS_STALE_DEMOTE_DOM',
  'R_DEPRECATED_SEED_DEMOTE_DOM',
  'R_API_LIST_HIGH_CONFIDENCE',
  'R_API_DETAIL_HIGH_CONFIDENCE',
  'R_DOM_REGION_ROWS_HIGH_CONFIDENCE',
  'R_MARKDOWN_READING_SURFACE',
  'R_EMPTY_RESULT_API_CONFIRMED',
  'R_EMPTY_RESULT_DOM_CONFIRM',
  'R_KNOWLEDGE_SUPPORTED_LEGACY',
  'R_DOM_DEFAULT',
] as const;

interface RuleContext {
  input: DataSourceDecisionInput;
  costEstimate: DataSourceCostEstimate;
  fallbackPlan: DataSourceFallbackPlan;
  dispatcherInputSource: string;
  factSnapshotVerdict: FactSnapshotVerdict;
  readinessVerdict: ReadinessVerdict;
  complexityClass: ComplexityClass;
  taskIntent: TaskIntentClass;
  endpointEvidence: RouterEndpointEvidence | null;
  domRegionRowsEvidence: RouterDomRegionRowsEvidence | null;
  factsAreFresh: boolean;
  endpointPassesGate: boolean;
  domRegionRowsPassGate: boolean;
}

interface DataSourceRouterRule {
  readonly id: DataSourceRouterRuleId;
  readonly match: (ctx: RuleContext) => boolean;
  readonly produce: (ctx: RuleContext) => DataSourceDecision;
}

// V27-09 — evidence gate for "API path may win". A row passes when:
//   - usableForTask is true (lookup ranker confidence floor).
//   - endpointSource is NOT 'deprecated_seed' (deprecated_seed never
//     wins API path; SoT V3 §V27-09 explicit invariant).
//   - falseCorrelationGuard <= 0.5 (V27-07 false-positive ceiling).
//   - lastFailureReason is NOT a "this endpoint just broke" verdict
//     (closeout fix — see RECENT_FAILURE_BLOCKS_API_GATE below).
//   - inferredSemanticType is one of the read-shaped verdicts.
const READ_SHAPED_SEMANTIC_TYPES: ReadonlySet<EndpointCandidateSemanticType> = new Set([
  'search',
  'list',
  'detail',
  'pagination',
  'filter',
  'document',
  'empty',
]);

/**
 * Closeout — closed-enum set of last-failure reasons that disqualify
 * a Knowledge endpoint from winning the API high-confidence path.
 *
 * Includes `'empty_response'` on purpose: V27-08 records this when
 * the most recent fetch returned no rows, but at the router layer we
 * cannot tell whether that was a legitimate empty result or a
 * silently-broken endpoint. The conservative reading is to demote
 * to DOM L0+L1 and let the readiness profiler / DOM observer
 * confirm the empty. The R_EMPTY_RESULT_API_CONFIRMED rule still
 * has its own (`readinessVerdict==='empty'` + endpoint lineage)
 * gate, so a clean "empty success" is unaffected.
 *
 * `'unknown'` is also blocking: an unknown failure verdict is
 * exactly the case where we have no evidence the endpoint is OK.
 *
 * `null` (no last failure on file) does NOT block.
 */
const RECENT_FAILURE_BLOCKS_API_GATE: ReadonlySet<EndpointLastFailureReason> =
  new Set<EndpointLastFailureReason>([
    'timeout',
    'status_4xx',
    'status_5xx',
    'semantic_mismatch',
    'shape_drift',
    'empty_response',
    'rate_limited',
    'unknown',
  ]);

function endpointPassesApiGate(ev: RouterEndpointEvidence | null): boolean {
  if (!ev) return false;
  if (!ev.usableForTask) return false;
  if (ev.endpointSource === 'deprecated_seed') return false;
  if (ev.falseCorrelationGuard > 0.5) return false;
  if (ev.lastFailureReason !== null && RECENT_FAILURE_BLOCKS_API_GATE.has(ev.lastFailureReason)) {
    return false;
  }
  return READ_SHAPED_SEMANTIC_TYPES.has(ev.inferredSemanticType);
}

function endpointSemanticIsListLike(ev: RouterEndpointEvidence | null): boolean {
  if (!ev) return false;
  return (
    ev.inferredSemanticType === 'search' ||
    ev.inferredSemanticType === 'list' ||
    ev.inferredSemanticType === 'pagination' ||
    ev.inferredSemanticType === 'filter'
  );
}

function endpointSemanticIsDetail(ev: RouterEndpointEvidence | null): boolean {
  return !!ev && ev.inferredSemanticType === 'detail';
}

function endpointSemanticIsEmpty(ev: RouterEndpointEvidence | null): boolean {
  return !!ev && ev.inferredSemanticType === 'empty';
}

function domRegionRowsPassGate(ev: RouterDomRegionRowsEvidence | null): boolean {
  if (!ev) return false;
  if (!ev.available) return false;
  if (ev.rowCount <= 0) return false;
  if (ev.confidence < 0.7) return false;
  if (
    ev.targetRefCoverageRate !== undefined &&
    ev.targetRefCoverageRate !== null &&
    ev.targetRefCoverageRate <= 0
  ) {
    return false;
  }
  return true;
}

const DATA_SOURCE_ROUTER_RULES: ReadonlyArray<DataSourceRouterRule> = [
  // 1. Experience replay is recorded action playback; nothing else
  //    can win when the upstream layer dispatcher already chose this
  //    source route. Same shape as v2.6.
  {
    id: 'R_EXPERIENCE_REPLAY',
    match: (ctx) => ctx.input.sourceRoute === 'experience_replay_skip_read',
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_EXPERIENCE_REPLAY',
        dataSource: 'experience_replay',
        confidence: 0.82,
        riskTier: 'medium',
        decisionReason: 'experience_replay_route_selected',
        dispatcherInputSource: ctx.dispatcherInputSource,
        // Replay engine issues a real DOM action → contract layer
        // must permit `execution` (dom_json envelope).
        contractDataSource: 'dom_json',
      }),
  },

  // 2. click/fill must keep DOM refs as authority. Even when API
  //    knowledge is available we MUST NOT route execution intent to
  //    api_*. This is a hard SoT V3 invariant.
  {
    id: 'R_CLICK_FILL_DOM_AUTHORITY',
    match: (ctx) => ctx.taskIntent === 'click_or_fill',
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_CLICK_FILL_DOM_AUTHORITY',
        dataSource: 'dom_json',
        confidence: 0.9,
        riskTier: 'medium',
        decisionReason: 'click_or_fill_requires_dom_refs_authority',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },

  // 3. Dispatcher fail-safe → compact DOM. Identical to v2.6 path.
  {
    id: 'R_DISPATCHER_FAIL_SAFE_DOM',
    match: (ctx) => ctx.input.sourceRoute === 'dispatcher_fallback_safe',
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_DISPATCHER_FAIL_SAFE_DOM',
        dataSource: 'dom_json',
        confidence: 0.25,
        riskTier: 'low',
        decisionReason: 'router_fail_safe_dom_compact',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },

  // 4. V27-09 — empty readiness with high-confidence empty endpoint
  //    semantic + non-deprecated source = success-empty path. We
  //    route to api_list (compact rows envelope) and let the
  //    downstream reader emit `emptyResult=true` because the
  //    endpoint lineage was strong enough to trust the empty.
  {
    id: 'R_EMPTY_RESULT_API_CONFIRMED',
    match: (ctx) =>
      ctx.readinessVerdict === 'empty' &&
      ctx.factsAreFresh &&
      ctx.endpointEvidence !== null &&
      ctx.endpointEvidence.usableForTask &&
      ctx.endpointEvidence.endpointSource !== 'deprecated_seed' &&
      ctx.endpointEvidence.falseCorrelationGuard <= 0.5 &&
      (ctx.endpointEvidence.lastFailureReason === null ||
        !RECENT_FAILURE_BLOCKS_API_GATE.has(ctx.endpointEvidence.lastFailureReason)) &&
      (endpointSemanticIsEmpty(ctx.endpointEvidence) ||
        endpointSemanticIsListLike(ctx.endpointEvidence)) &&
      ctx.endpointEvidence.confidence >= 0.7,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_EMPTY_RESULT_API_CONFIRMED',
        dataSource: 'api_list',
        confidence: 0.78,
        riskTier: 'low',
        decisionReason: 'empty_result_endpoint_lineage_sufficient',
        dispatcherInputSource: 'api_knowledge',
        contractDataSource: 'api_rows',
      }),
  },

  // 5. V27-09 — empty readiness without endpoint backing → fall back
  //    to compact DOM L0+L1 to confirm the empty.
  //
  //    Closeout — this rule runs strictly after R_EMPTY_RESULT_API_
  //    CONFIRMED, so by the time we arrive here we KNOW the API
  //    confirmed-empty path rejected the row (missing/low-confidence/
  //    deprecated_seed/false-correlation/recent-failure). A bare
  //    `readinessVerdict==='empty'` predicate is enough; we no longer
  //    re-list every rejection condition (drift risk).
  {
    id: 'R_EMPTY_RESULT_DOM_CONFIRM',
    match: (ctx) => ctx.readinessVerdict === 'empty',
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_EMPTY_RESULT_DOM_CONFIRM',
        dataSource: 'dom_json',
        confidence: 0.55,
        riskTier: 'low',
        decisionReason: 'empty_result_requires_dom_l0_l1_confirm',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },

  // 6. V27-09 — facts stale / missing / unknown but a V27-09 caller
  //    asked for evidence-driven routing → demote to compact DOM with
  //    explicit reduced confidence. Matches the SoT V3 invariant
  //    "不得把旧快照、缺失快照或未知 readiness 当作现场事实".
  //
  //    Important: we ONLY fire this when the caller actually supplied
  //    V27-09 evidence (taskIntent != 'unknown' OR endpointEvidence
  //    present). v2.6 callers that supply none of those go through
  //    the legacy rule below and stay bit-identical.
  {
    id: 'R_FACTS_STALE_DEMOTE_DOM',
    match: (ctx) =>
      callerSuppliedV27_09Evidence(ctx) &&
      !ctx.factsAreFresh &&
      ctx.readinessVerdict !== 'empty' &&
      !ctx.domRegionRowsPassGate,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_FACTS_STALE_DEMOTE_DOM',
        dataSource: 'dom_json',
        confidence: 0.45,
        riskTier: 'low',
        decisionReason: 'facts_stale_or_missing_demote_to_dom',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },

  // 7. V27-09 — deprecated_seed-only endpoint must NOT win the API
  //    path. We demote to compact DOM with an explicit reason; the
  //    seed_adapter row stays in Knowledge for lineage but is
  //    structurally barred from being chosen here.
  {
    id: 'R_DEPRECATED_SEED_DEMOTE_DOM',
    match: (ctx) =>
      ctx.endpointEvidence !== null &&
      ctx.endpointEvidence.endpointSource === 'deprecated_seed' &&
      !ctx.domRegionRowsPassGate,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_DEPRECATED_SEED_DEMOTE_DOM',
        dataSource: 'dom_json',
        confidence: 0.5,
        riskTier: 'low',
        decisionReason: 'deprecated_seed_demoted_no_api_authority',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },

  // 8. V27-09 — search/list intent + fresh facts + endpoint passes
  //    gate → api_list high confidence.
  {
    id: 'R_API_LIST_HIGH_CONFIDENCE',
    match: (ctx) =>
      ctx.taskIntent === 'search_list' &&
      ctx.factsAreFresh &&
      ctx.endpointPassesGate &&
      endpointSemanticIsListLike(ctx.endpointEvidence),
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_API_LIST_HIGH_CONFIDENCE',
        dataSource: 'api_list',
        confidence: 0.88,
        riskTier: 'low',
        decisionReason: 'api_list_endpoint_evidence_sufficient',
        dispatcherInputSource: 'api_knowledge',
        contractDataSource: 'api_rows',
      }),
  },

  // 9. V27-09 — detail intent + fresh facts + endpoint passes gate
  //    AND inferred semantic is detail → api_detail.
  {
    id: 'R_API_DETAIL_HIGH_CONFIDENCE',
    match: (ctx) =>
      ctx.taskIntent === 'detail' &&
      ctx.factsAreFresh &&
      ctx.endpointPassesGate &&
      endpointSemanticIsDetail(ctx.endpointEvidence),
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_API_DETAIL_HIGH_CONFIDENCE',
        dataSource: 'api_detail',
        confidence: 0.85,
        riskTier: 'low',
        decisionReason: 'api_detail_endpoint_evidence_sufficient',
        dispatcherInputSource: 'api_knowledge',
        contractDataSource: 'api_detail',
      }),
  },

  // 10. V27-P0-REAL-03 — search/list intent + API gate did not win
  //     + visible DOM rows are high-confidence -> use DOM region
  //     rows as the structured list source.
  {
    id: 'R_DOM_REGION_ROWS_HIGH_CONFIDENCE',
    match: (ctx) =>
      ctx.taskIntent === 'search_list' &&
      (ctx.readinessVerdict === 'ready' || ctx.readinessVerdict === 'unknown') &&
      !ctx.endpointPassesGate &&
      ctx.input.apiCandidateAvailable !== true &&
      ctx.domRegionRowsPassGate,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_DOM_REGION_ROWS_HIGH_CONFIDENCE',
        dataSource: 'dom_region_rows',
        confidence: Math.max(0.7, Math.min(0.9, ctx.domRegionRowsEvidence?.confidence ?? 0.7)),
        riskTier: 'low',
        decisionReason: apiUnavailableReason(ctx.endpointEvidence),
        dispatcherInputSource: 'dom_visible_region',
        contractDataSource: 'dom_region_rows',
      }),
  },

  // 11. Markdown reading surface. Honours both:
  //     - v2.6 strategy `'read_page_markdown'` (legacy callers)
  //     - V27-09 `taskIntent='document'` + complexity=document
  {
    id: 'R_MARKDOWN_READING_SURFACE',
    match: (ctx) =>
      ctx.input.strategy === 'read_page_markdown' ||
      (ctx.taskIntent === 'document' && ctx.complexityClass === 'document'),
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_MARKDOWN_READING_SURFACE',
        dataSource: 'markdown',
        confidence: 0.68,
        riskTier: 'low',
        decisionReason: 'markdown_reading_surface_preferred',
        dispatcherInputSource:
          ctx.input.strategy === 'read_page_markdown'
            ? 'markdown_surface'
            : ctx.dispatcherInputSource,
        contractDataSource: 'markdown',
      }),
  },

  // 12. v2.6 legacy back-compat: knowledge_supported_read +
  //     apiCandidateAvailable=true. This is the rule the existing
  //     choose-context.ts caller hits when no V27-09 evidence was
  //     supplied; produces the bit-identical v2.6 decision.
  //
  //     Closeout — only fires when the caller did NOT supply V27-09
  //     endpoint evidence. A V27-09 caller that handed us an
  //     `endpointEvidence` row and saw the API gate reject it
  //     (e.g. `lastFailureReason='timeout'`) MUST NOT silently fall
  //     through to the legacy api_list path; it falls all the way
  //     to R_DOM_DEFAULT instead. This keeps the legacy back-compat
  //     for v2.6 callers (who never set `endpointEvidence`) without
  //     letting the legacy rule undo the evidence-driven gate.
  {
    id: 'R_KNOWLEDGE_SUPPORTED_LEGACY',
    match: (ctx) =>
      ctx.input.sourceRoute === 'knowledge_supported_read' &&
      ctx.input.apiCandidateAvailable === true &&
      ctx.endpointEvidence === null,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_KNOWLEDGE_SUPPORTED_LEGACY',
        dataSource: 'api_list',
        confidence: 0.88,
        riskTier: 'low',
        decisionReason: 'api_knowledge_candidate_available',
        dispatcherInputSource: 'api_knowledge',
        contractDataSource: 'api_rows',
      }),
  },

  // 13. Final fallback: compact DOM. Same shape as v2.6.
  {
    id: 'R_DOM_DEFAULT',
    match: () => true,
    produce: (ctx) =>
      buildDecision({
        ctx,
        ruleId: 'R_DOM_DEFAULT',
        dataSource: 'dom_json',
        confidence: 0.55,
        riskTier: 'low',
        decisionReason: 'dom_compact_required',
        dispatcherInputSource: ctx.dispatcherInputSource,
        contractDataSource: 'dom_json',
      }),
  },
];

function callerSuppliedV27_09Evidence(ctx: RuleContext): boolean {
  return (
    ctx.input.taskIntent !== undefined ||
    ctx.input.factSnapshotVerdict !== undefined ||
    ctx.input.readinessVerdict !== undefined ||
    ctx.input.complexityClass !== undefined ||
    ctx.input.contextVersion !== undefined ||
    ctx.input.factSnapshotId !== undefined ||
    !!ctx.input.domRegionRowsEvidence ||
    !!ctx.input.endpointEvidence
  );
}

function apiUnavailableReason(ev: RouterEndpointEvidence | null): string {
  if (!ev) return 'api_rows_unavailable_dom_region_rows_available';
  if (ev.endpointSource === 'deprecated_seed') return 'api_rows_rejected_deprecated_seed_dom_rows';
  if (ev.falseCorrelationGuard > 0.5) return 'api_rows_rejected_false_correlation_dom_rows';
  if (ev.lastFailureReason) return `api_rows_rejected_${ev.lastFailureReason}_dom_rows`;
  if (!ev.usableForTask) return 'api_rows_rejected_low_relevance_dom_rows';
  return 'api_rows_rejected_dom_region_rows_available';
}

export function routeDataSource(input: DataSourceDecisionInput): DataSourceDecision {
  const ctx = buildRuleContext(input);
  for (const rule of DATA_SOURCE_ROUTER_RULES) {
    if (rule.match(ctx)) {
      return rule.produce(ctx);
    }
  }
  // Unreachable — `R_DOM_DEFAULT` matches anything. Kept so the
  // compiler enforces the truth-table is exhaustive even if a
  // future edit accidentally drops the default.
  throw new Error('data-source-router: truth table missed every rule (default removed?)');
}

function buildRuleContext(input: DataSourceDecisionInput): RuleContext {
  const costEstimate = buildCostEstimate(input);
  const fallbackPlan = buildFallbackPlan(input.chosenLayer, input.sourceRoute);
  const dispatcherInputSource = resolveDispatcherInputSource(input);
  const factSnapshotVerdict: FactSnapshotVerdict = input.factSnapshotVerdict ?? 'unknown';
  const readinessVerdict: ReadinessVerdict = input.readinessVerdict ?? 'unknown';
  const complexityClass: ComplexityClass = input.complexityClass ?? 'unknown';
  const taskIntent: TaskIntentClass = input.taskIntent ?? 'unknown';
  const endpointEvidence = input.endpointEvidence ?? null;
  const domRegionRowsEvidence = input.domRegionRowsEvidence ?? null;

  // Facts are "fresh" only when explicitly fresh AND readiness is
  // either ready or empty (an `empty` page is a usable fact —
  // see R_EMPTY_RESULT_API_CONFIRMED). Anything else (unknown,
  // stale, missing, document_loading, error_or_blocked) reads as
  // "we cannot trust browser facts here" and demotes the decision.
  const factsAreFresh =
    factSnapshotVerdict === 'fresh' &&
    (readinessVerdict === 'ready' || readinessVerdict === 'empty');

  const endpointPassesGate = endpointPassesApiGate(endpointEvidence);
  const domRowsPassGate = domRegionRowsPassGate(domRegionRowsEvidence);

  return {
    input,
    costEstimate,
    fallbackPlan,
    dispatcherInputSource,
    factSnapshotVerdict,
    readinessVerdict,
    complexityClass,
    taskIntent,
    endpointEvidence,
    domRegionRowsEvidence,
    factsAreFresh,
    endpointPassesGate,
    domRegionRowsPassGate: domRowsPassGate,
  };
}

interface BuildDecisionArgs {
  ctx: RuleContext;
  ruleId: DataSourceRouterRuleId;
  dataSource: DataSourceKind;
  confidence: number;
  riskTier: DataSourceRiskTier;
  decisionReason: string;
  dispatcherInputSource: string;
  contractDataSource: 'dom_json' | 'dom_region_rows' | 'markdown' | 'api_rows' | 'api_detail';
}

function buildDecision(args: BuildDecisionArgs): DataSourceDecision {
  const { ctx, ruleId, dataSource, confidence, riskTier, decisionReason } = args;
  const layerContract = mapDataSourceToLayerContract({
    dataSource: args.contractDataSource,
    requestedLayer: ctx.input.chosenLayer,
    fallbackEntryLayer: ctx.fallbackPlan.entryLayer,
    // V27-09 — `api_detail` envelope respects whether the task
    // actually requires detail. We mirror the rule's intent here.
    taskRequiresDetail: ruleId === 'R_API_DETAIL_HIGH_CONFIDENCE',
  });

  return {
    sourceRoute: ctx.input.sourceRoute,
    dataSource,
    chosenSource: dataSource,
    confidence,
    costEstimate: ctx.costEstimate,
    riskTier,
    fallbackPlan: ctx.fallbackPlan,
    decisionReason,
    dispatcherInputSource: args.dispatcherInputSource,
    layerContract,
    // V27-09 additive evidence-contract fields. `selectedLayer`
    // mirrors `layerContract.layer` (the authoritative read layer
    // the contract permitted) — NOT the raw `chosenLayer` input.
    // For api_rows / markdown / non-detail api_detail the contract
    // clamps to L0+L1 even when the dispatcher requested L2; using
    // the raw input here would leak a virtual L2 ask into the
    // operation log when no L2 read was authorised. The original
    // request is preserved on `requestedLayer` for trail-completeness.
    selectedDataSource: dataSource,
    selectedLayer: layerContract.layer,
    requestedLayer: ctx.input.chosenLayer,
    contextVersion: ctx.input.contextVersion ?? null,
    factSnapshotVerdict: ctx.factSnapshotVerdict,
    decisionRuleId: ruleId,
    // V27-09 — additive fields stay native-server-internal. No
    // change to public MCP response shape; choose-context.ts only
    // forwards `chosenSource / dataSource / routerConfidence`
    // (already public-additive in v2.6).
    publicSurfaceDelta: 'none',
  };
}

function buildCostEstimate(input: DataSourceDecisionInput): DataSourceCostEstimate {
  const chosenTokens = clampNonNegativeInt(input.tokenEstimateChosen);
  const fullReadTokens = clampNonNegativeInt(input.tokenEstimateFullRead);
  const savedTokensEstimate =
    input.tokensSavedEstimate === undefined
      ? Math.max(0, fullReadTokens - chosenTokens)
      : clampNonNegativeInt(input.tokensSavedEstimate);
  return { chosenTokens, fullReadTokens, savedTokensEstimate };
}

function buildFallbackPlan(
  chosenLayer: ReadPageRequestedLayer,
  sourceRoute: LayerSourceRoute,
): DataSourceFallbackPlan {
  return {
    dataSource: 'dom_json',
    entryLayer: chosenLayer === 'L0' ? 'L0' : 'L0+L1',
    reason:
      sourceRoute === 'dispatcher_fallback_safe'
        ? 'dispatcher_fallback_clamped_to_compact_dom'
        : 'fallback_to_compact_dom',
  };
}

function resolveDispatcherInputSource(input: DataSourceDecisionInput): string {
  if (typeof input.dispatcherInputSource === 'string' && input.dispatcherInputSource.length > 0) {
    return input.dispatcherInputSource;
  }
  if (input.sourceRoute === 'knowledge_supported_read' && input.apiCandidateAvailable === true) {
    return 'api_knowledge';
  }
  if (input.strategy === 'read_page_markdown') {
    return 'markdown_surface';
  }
  return 'fallback_zero';
}

function clampNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
