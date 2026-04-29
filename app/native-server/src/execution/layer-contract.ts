import type { ReadPageRequestedLayer } from '@tabrix/shared';

export type LayerContractDataSource =
  | 'dom_json'
  | 'dom_region_rows'
  | 'markdown'
  | 'api_rows'
  | 'api_detail';

/**
 * V26-FIX-06 — closed enum of intended uses that downstream
 * consumers (router / orchestrator / reader) declare when they
 * assert the contract. The contract layer is the GA mechanism that
 * stops a list-class data source (api_rows / markdown) from being
 * passed back to a click/action site, and stops API detail reads
 * from being reused as locator authority.
 *
 * - `list_read`: bulk row enumeration (search/list/pagination).
 * - `detail_read`: per-record deep read (issue body, package detail).
 * - `reading_surface`: human-readable rendering only (markdown).
 * - `locator`: identifying a DOM element for inspection/highlight.
 * - `execution`: clicking / typing / submitting against a DOM target.
 */
export type LayerContractIntendedUse =
  | 'list_read'
  | 'detail_read'
  | 'reading_surface'
  | 'locator'
  | 'execution';

export interface LayerContractInput {
  dataSource: LayerContractDataSource;
  requestedLayer?: ReadPageRequestedLayer | null;
  taskRequiresDetail?: boolean;
  fallbackEntryLayer?: 'L0' | 'L0+L1';
}

export interface LayerContractEnvelope {
  dataSource: LayerContractDataSource;
  layer: ReadPageRequestedLayer;
  locatorAuthority: boolean;
  executionAuthority: boolean;
  fallbackEntryLayer: 'L0' | 'L0+L1';
  reason: string;
  /**
   * V26-FIX-06 — closed list of intended uses this envelope authorises.
   * Sorted ascending for determinism. Read-only at the boundary; do NOT
   * mutate after the envelope is constructed.
   */
  allowedUses: ReadonlyArray<LayerContractIntendedUse>;
  /**
   * V26-FIX-06 — closed list of intended uses the envelope explicitly
   * rejects (i.e. consumers MUST escalate to dom_json before doing any
   * of these). Sorted ascending for determinism.
   */
  disallowedUses: ReadonlyArray<LayerContractIntendedUse>;
  /**
   * V26-FIX-06 — fixed-vocabulary diagnostic the envelope returns when
   * a consumer passed a `disallowedUses` operation. Populated for every
   * envelope shape (not just on rejection) so the operation log can
   * record a constant-time why-we-clamped marker.
   */
  escalationReason: string;
}

export type AiFacingLayerEnvelopeSurface = 'dom' | 'api' | 'markdown' | 'json';

export interface BuildAiFacingLayerEnvelopeInput extends LayerContractInput {
  surface?: AiFacingLayerEnvelopeSurface;
  pageComplexity?: 'simple' | 'medium' | 'complex' | 'unknown';
  summary?: string | null;
  stableRefs?: ReadonlyArray<string> | null;
  candidateActionIds?: ReadonlyArray<string> | null;
  rowCount?: number | null;
  detailRefs?: ReadonlyArray<string> | null;
}

export interface AiFacingLayerEnvelope {
  contract: LayerContractEnvelope;
  surface: AiFacingLayerEnvelopeSurface;
  layer: ReadPageRequestedLayer;
  summary: string | null;
  rowCount: number | null;
  authority: {
    locator: boolean;
    execution: boolean;
  };
  domRefs: {
    stableRefs: ReadonlyArray<string>;
    candidateActionIds: ReadonlyArray<string>;
  };
  detailRefs: ReadonlyArray<string>;
  complexPageDefaultedToL2: false;
}

export function mapDataSourceToLayerContract(input: LayerContractInput): LayerContractEnvelope {
  switch (input.dataSource) {
    case 'api_rows':
      return freezeEnvelope({
        dataSource: 'api_rows',
        layer: 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: 'api_rows_are_list_fields_not_locator_authority',
        allowedUses: sortUses(['list_read']),
        disallowedUses: sortUses(['locator', 'execution', 'detail_read']),
        escalationReason: 'api_rows_must_not_be_used_as_dom_locator_or_execution_target',
      });
    case 'api_detail':
      return freezeEnvelope({
        dataSource: 'api_detail',
        layer: input.taskRequiresDetail ? 'L0+L1+L2' : 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: input.taskRequiresDetail
          ? 'api_detail_allowed_for_detail_tasks'
          : 'api_detail_clamped_when_detail_not_required',
        allowedUses: sortUses(input.taskRequiresDetail ? ['detail_read'] : ['list_read']),
        disallowedUses: sortUses(['locator', 'execution']),
        escalationReason: 'api_detail_must_not_be_used_as_dom_locator_or_execution_target',
      });
    case 'markdown':
      return freezeEnvelope({
        dataSource: 'markdown',
        layer: input.taskRequiresDetail ? 'L0+L1+L2' : 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: 'markdown_is_reading_surface_not_locator_authority',
        allowedUses: sortUses(['reading_surface']),
        disallowedUses: sortUses(['locator', 'execution']),
        escalationReason: 'markdown_is_reading_surface_only_no_target_refs_emitted',
      });
    case 'dom_json':
      return freezeEnvelope({
        dataSource: 'dom_json',
        layer: normalizeRequestedLayer(input.requestedLayer),
        locatorAuthority: true,
        executionAuthority: true,
        fallbackEntryLayer: clampFallbackLayer(input.requestedLayer),
        reason: 'dom_json_is_execution_authority',
        allowedUses: sortUses(['locator', 'execution', 'list_read', 'detail_read']),
        disallowedUses: [],
        escalationReason: 'dom_json_is_full_authority_no_escalation_required',
      });
    case 'dom_region_rows':
      return freezeEnvelope({
        dataSource: 'dom_region_rows',
        layer: 'L0+L1',
        locatorAuthority: true,
        executionAuthority: true,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: 'dom_region_rows_are_visible_dom_refs_for_list_tasks',
        allowedUses: sortUses(['locator', 'execution', 'list_read']),
        disallowedUses: sortUses(['detail_read']),
        escalationReason: 'dom_region_rows_require_detail_read_before_detail_reuse',
      });
  }
}

export function buildAiFacingLayerEnvelope(
  input: BuildAiFacingLayerEnvelopeInput,
): AiFacingLayerEnvelope {
  const contract = mapDataSourceToLayerContract(input);
  return Object.freeze({
    contract,
    surface: input.surface ?? defaultSurfaceForDataSource(input.dataSource),
    layer: contract.layer,
    summary: normalizeNullableText(input.summary),
    rowCount: normalizeNullableCount(input.rowCount),
    authority: Object.freeze({
      locator: contract.locatorAuthority,
      execution: contract.executionAuthority,
    }),
    domRefs: Object.freeze({
      stableRefs: Object.freeze(
        contract.locatorAuthority ? stableStringList(input.stableRefs) : [],
      ),
      candidateActionIds: Object.freeze(
        contract.executionAuthority ? stableStringList(input.candidateActionIds) : [],
      ),
    }),
    detailRefs: Object.freeze(stableStringList(input.detailRefs)),
    // V27-10 invariant: page complexity is advisory. A complex page
    // alone must not widen the AI-facing envelope to L2; only the
    // existing requestedLayer/taskRequiresDetail contract can do so.
    complexPageDefaultedToL2: false as const,
  });
}

/**
 * V26-FIX-06 — closed-result of asserting the contract envelope
 * against an intended downstream use.
 *
 * `ok = true` means the envelope authorises this use without any
 * widening or fallback. `ok = false` means the consumer MUST stop
 * before writing the row out and either fall back to a `dom_json`
 * envelope or surface an explicit fail-shape entry. The
 * orchestrator and direct-api-executor both consume this result.
 */
export interface LayerContractAssertion {
  ok: boolean;
  envelope: LayerContractEnvelope;
  intendedUse: LayerContractIntendedUse;
  /** Empty when `ok = true`; populated with `escalationReason` otherwise. */
  rejectionReason: string;
}

/**
 * V26-FIX-06 — assert a contract envelope against a single intended
 * use. Pure function. The router/orchestrator/reader call this on
 * the way out of their respective decision branches; the operation
 * log pulls `envelope.allowedUses / disallowedUses / escalationReason`
 * directly from the envelope.
 */
export function assertLayerContract(
  envelope: LayerContractEnvelope,
  intendedUse: LayerContractIntendedUse,
): LayerContractAssertion {
  const isAllowed = envelope.allowedUses.includes(intendedUse);
  return {
    ok: isAllowed,
    envelope,
    intendedUse,
    rejectionReason: isAllowed ? '' : envelope.escalationReason,
  };
}

function sortUses(
  values: ReadonlyArray<LayerContractIntendedUse>,
): ReadonlyArray<LayerContractIntendedUse> {
  return Object.freeze([...values].sort());
}

function freezeEnvelope(envelope: LayerContractEnvelope): LayerContractEnvelope {
  return Object.freeze({
    ...envelope,
    allowedUses: Object.freeze([...envelope.allowedUses]),
    disallowedUses: Object.freeze([...envelope.disallowedUses]),
  });
}

function defaultSurfaceForDataSource(
  dataSource: LayerContractDataSource,
): AiFacingLayerEnvelopeSurface {
  switch (dataSource) {
    case 'dom_json':
    case 'dom_region_rows':
      return 'dom';
    case 'api_rows':
    case 'api_detail':
      return 'api';
    case 'markdown':
      return 'markdown';
  }
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableCount(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value as number));
}

function stableStringList(values: ReadonlyArray<string> | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).sort();
}

export function clampFallbackLayer(requestedLayer?: ReadPageRequestedLayer | null): 'L0' | 'L0+L1' {
  return requestedLayer === 'L0' ? 'L0' : 'L0+L1';
}

function normalizeRequestedLayer(
  requestedLayer?: ReadPageRequestedLayer | null,
): ReadPageRequestedLayer {
  return requestedLayer ?? 'L0+L1';
}
