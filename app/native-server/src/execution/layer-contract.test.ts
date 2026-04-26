import { clampFallbackLayer, mapDataSourceToLayerContract } from './layer-contract';

describe('Layer Contract v1 (V26-13)', () => {
  it('maps API rows to L1 list data without locator authority', () => {
    expect(
      mapDataSourceToLayerContract({
        dataSource: 'api_rows',
        requestedLayer: 'L0+L1+L2',
      }),
    ).toEqual({
      dataSource: 'api_rows',
      layer: 'L0+L1',
      locatorAuthority: false,
      executionAuthority: false,
      fallbackEntryLayer: 'L0+L1',
      reason: 'api_rows_are_list_fields_not_locator_authority',
    });
  });

  it('allows API detail and Markdown to reach L2 only for detail tasks', () => {
    expect(
      mapDataSourceToLayerContract({
        dataSource: 'api_detail',
        taskRequiresDetail: true,
      }).layer,
    ).toBe('L0+L1+L2');
    expect(
      mapDataSourceToLayerContract({
        dataSource: 'markdown',
        taskRequiresDetail: false,
      }),
    ).toMatchObject({
      layer: 'L0+L1',
      locatorAuthority: false,
      executionAuthority: false,
    });
  });

  it('keeps DOM JSON as the only locator/execution authority', () => {
    expect(
      mapDataSourceToLayerContract({
        dataSource: 'dom_json',
        requestedLayer: 'L0+L1+L2',
      }),
    ).toMatchObject({
      layer: 'L0+L1+L2',
      locatorAuthority: true,
      executionAuthority: true,
      fallbackEntryLayer: 'L0+L1',
    });
  });

  it('clamps every fallback layer to L0 or L0+L1', () => {
    expect(clampFallbackLayer('L0')).toBe('L0');
    expect(clampFallbackLayer('L0+L1')).toBe('L0+L1');
    expect(clampFallbackLayer('L0+L1+L2')).toBe('L0+L1');
    expect(clampFallbackLayer(null)).toBe('L0+L1');
  });
});
