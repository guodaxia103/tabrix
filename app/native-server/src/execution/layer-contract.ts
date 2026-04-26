import type { ReadPageRequestedLayer } from '@tabrix/shared';

export type LayerContractDataSource = 'dom_json' | 'markdown' | 'api_rows' | 'api_detail';

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
}

export function mapDataSourceToLayerContract(input: LayerContractInput): LayerContractEnvelope {
  switch (input.dataSource) {
    case 'api_rows':
      return {
        dataSource: 'api_rows',
        layer: 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: 'api_rows_are_list_fields_not_locator_authority',
      };
    case 'api_detail':
      return {
        dataSource: 'api_detail',
        layer: input.taskRequiresDetail ? 'L0+L1+L2' : 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: input.taskRequiresDetail
          ? 'api_detail_allowed_for_detail_tasks'
          : 'api_detail_clamped_when_detail_not_required',
      };
    case 'markdown':
      return {
        dataSource: 'markdown',
        layer: input.taskRequiresDetail ? 'L0+L1+L2' : 'L0+L1',
        locatorAuthority: false,
        executionAuthority: false,
        fallbackEntryLayer: input.fallbackEntryLayer ?? 'L0+L1',
        reason: 'markdown_is_reading_surface_not_locator_authority',
      };
    case 'dom_json':
      return {
        dataSource: 'dom_json',
        layer: normalizeRequestedLayer(input.requestedLayer),
        locatorAuthority: true,
        executionAuthority: true,
        fallbackEntryLayer: clampFallbackLayer(input.requestedLayer),
        reason: 'dom_json_is_execution_authority',
      };
  }
}

export function clampFallbackLayer(requestedLayer?: ReadPageRequestedLayer | null): 'L0' | 'L0+L1' {
  return requestedLayer === 'L0' ? 'L0' : 'L0+L1';
}

function normalizeRequestedLayer(
  requestedLayer?: ReadPageRequestedLayer | null,
): ReadPageRequestedLayer {
  return requestedLayer ?? 'L0+L1';
}
