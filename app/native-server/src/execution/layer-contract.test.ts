import {
  assertLayerContract,
  clampFallbackLayer,
  mapDataSourceToLayerContract,
  type LayerContractEnvelope,
} from './layer-contract';

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
      allowedUses: ['list_read'],
      disallowedUses: ['detail_read', 'execution', 'locator'],
      escalationReason: 'api_rows_must_not_be_used_as_dom_locator_or_execution_target',
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

describe('Layer Contract v2 (V26-FIX-06) — closed-enum allowed/disallowed uses', () => {
  it('emits sorted allowedUses/disallowedUses for each data source', () => {
    const apiRows = mapDataSourceToLayerContract({ dataSource: 'api_rows' });
    expect(apiRows.allowedUses).toEqual(['list_read']);
    expect(apiRows.disallowedUses).toEqual(['detail_read', 'execution', 'locator']);

    const apiDetail = mapDataSourceToLayerContract({
      dataSource: 'api_detail',
      taskRequiresDetail: true,
    });
    expect(apiDetail.allowedUses).toEqual(['detail_read']);
    expect(apiDetail.disallowedUses).toEqual(['execution', 'locator']);

    const markdown = mapDataSourceToLayerContract({ dataSource: 'markdown' });
    expect(markdown.allowedUses).toEqual(['reading_surface']);
    expect(markdown.disallowedUses).toEqual(['execution', 'locator']);

    const dom = mapDataSourceToLayerContract({ dataSource: 'dom_json' });
    expect([...dom.allowedUses].sort()).toEqual([
      'detail_read',
      'execution',
      'list_read',
      'locator',
    ]);
    expect(dom.disallowedUses).toEqual([]);
  });

  it('clamps api_detail.allowedUses to list_read when taskRequiresDetail=false', () => {
    const apiDetail = mapDataSourceToLayerContract({
      dataSource: 'api_detail',
      taskRequiresDetail: false,
    });
    expect(apiDetail.allowedUses).toEqual(['list_read']);
    expect(apiDetail.layer).toBe('L0+L1');
  });

  it('publishes a fixed-vocabulary escalationReason on every envelope', () => {
    const envelopes: LayerContractEnvelope[] = [
      mapDataSourceToLayerContract({ dataSource: 'api_rows' }),
      mapDataSourceToLayerContract({ dataSource: 'api_detail' }),
      mapDataSourceToLayerContract({ dataSource: 'markdown' }),
      mapDataSourceToLayerContract({ dataSource: 'dom_json' }),
    ];
    for (const envelope of envelopes) {
      expect(typeof envelope.escalationReason).toBe('string');
      expect(envelope.escalationReason.length).toBeGreaterThan(0);
    }
  });

  it('freezes envelopes so consumers cannot mutate allowedUses', () => {
    const envelope = mapDataSourceToLayerContract({ dataSource: 'api_rows' });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.allowedUses)).toBe(true);
  });
});

describe('assertLayerContract — cross-module invariants', () => {
  it('rejects locator + execution use against api_rows', () => {
    const apiRows = mapDataSourceToLayerContract({ dataSource: 'api_rows' });
    const locator = assertLayerContract(apiRows, 'locator');
    expect(locator.ok).toBe(false);
    expect(locator.rejectionReason).toBe(
      'api_rows_must_not_be_used_as_dom_locator_or_execution_target',
    );
    expect(assertLayerContract(apiRows, 'execution').ok).toBe(false);
    expect(assertLayerContract(apiRows, 'list_read').ok).toBe(true);
  });

  it('rejects locator/execution against markdown reading surface', () => {
    const md = mapDataSourceToLayerContract({ dataSource: 'markdown' });
    expect(assertLayerContract(md, 'locator').ok).toBe(false);
    expect(assertLayerContract(md, 'execution').ok).toBe(false);
    expect(assertLayerContract(md, 'reading_surface').ok).toBe(true);
  });

  it('authorises every closed-enum use against dom_json', () => {
    const dom = mapDataSourceToLayerContract({ dataSource: 'dom_json' });
    for (const use of ['locator', 'execution', 'list_read', 'detail_read'] as const) {
      const a = assertLayerContract(dom, use);
      expect(a.ok).toBe(true);
      expect(a.rejectionReason).toBe('');
    }
  });

  it('rejects detail_read against api_detail when task did not require detail', () => {
    const apiDetail = mapDataSourceToLayerContract({
      dataSource: 'api_detail',
      taskRequiresDetail: false,
    });
    expect(assertLayerContract(apiDetail, 'detail_read').ok).toBe(false);
    expect(assertLayerContract(apiDetail, 'list_read').ok).toBe(true);
  });
});
