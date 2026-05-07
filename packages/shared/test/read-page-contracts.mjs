import assert from 'node:assert/strict';

import {
  LAYER_DISPATCH_REASON_VALUES,
  LAYER_SOURCE_ROUTE_VALUES,
  READ_PAGE_MODE_MINIMUM_FIELDS,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  READ_PAGE_TASK_PROTOCOL_FIELDS,
  STABLE_TARGET_REF_PREFIX,
  estimateTokensFromBytes,
  estimateTokensFromString,
} from '../dist/index.mjs';

assert.deepEqual(READ_PAGE_REQUESTED_LAYER_VALUES, ['L0', 'L0+L1', 'L0+L1+L2']);

assert.deepEqual(LAYER_SOURCE_ROUTE_VALUES, [
  'read_page_required',
  'experience_replay_skip_read',
  'knowledge_supported_read',
  'dispatcher_fallback_safe',
]);

assert.deepEqual(LAYER_DISPATCH_REASON_VALUES, [
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
]);

assert.deepEqual(READ_PAGE_TASK_PROTOCOL_FIELDS, [
  'taskMode',
  'complexityLevel',
  'sourceKind',
  'highValueObjects',
  'L0',
  'L1',
  'L2',
]);

assert.deepEqual(READ_PAGE_MODE_MINIMUM_FIELDS, {
  compact: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs'],
  normal: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'diagnostics'],
  full: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'fullSnapshot'],
});

assert.equal(STABLE_TARGET_REF_PREFIX, 'tgt_');
assert.equal(estimateTokensFromBytes(null), 0);
assert.equal(estimateTokensFromBytes(0), 0);
assert.equal(estimateTokensFromBytes(1), 1);
assert.equal(estimateTokensFromBytes(4), 1);
assert.equal(estimateTokensFromBytes(5), 2);
assert.equal(estimateTokensFromString('abcd'), 1);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'read-page',
    requestedLayerCount: READ_PAGE_REQUESTED_LAYER_VALUES.length,
    sourceRouteCount: LAYER_SOURCE_ROUTE_VALUES.length,
    dispatchReasonCount: LAYER_DISPATCH_REASON_VALUES.length,
  }),
);
