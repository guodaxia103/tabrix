import assert from 'node:assert/strict';

import {
  ACTION_KINDS,
  ACTION_OUTCOMES,
  ACTION_SIGNAL_KINDS,
  COMPLEXITY_KINDS,
  CONTEXT_INVALIDATION_REASONS,
  CONTEXT_LEVELS,
  FACT_OBSERVATION_EVENT_KINDS,
  LIFECYCLE_EVENT_KINDS,
  LIFECYCLE_FLAGS,
  LIFECYCLE_STATES,
  NAVIGATION_INTENTS,
  NETWORK_FACT_METHODS,
  NETWORK_FACT_NOISE_CLASSES,
  NETWORK_FACT_SIZE_CLASSES,
  OBSERVATION_KINDS,
  READINESS_STATES,
  RECOMMENDED_LAYERS,
  RECOMMENDED_LAYER_REASONS,
  STABLE_REF_REVALIDATION_OUTCOMES,
  TAB_WINDOW_EVENT_KINDS,
} from '../dist/index.mjs';

function assertClosedVocabulary(name, actual, expected) {
  assert.deepEqual(actual, expected, `${name} vocabulary changed`);
  assert.equal(new Set(actual).size, actual.length, `${name} must not contain duplicates`);
  assert.ok(actual.includes('unknown'), `${name} must include the unknown fallback`);
}

assertClosedVocabulary('LIFECYCLE_STATES', LIFECYCLE_STATES, [
  'idle',
  'navigating',
  'document_loading',
  'document_ready',
  'route_stable',
  'unloading',
  'closed',
  'unknown',
]);

assertClosedVocabulary('LIFECYCLE_FLAGS', LIFECYCLE_FLAGS, [
  'cold_load',
  'spa_route_change',
  'history_state_update',
  'back_forward',
  'reload',
  'tab_replaced',
  'tab_closed',
  'unknown',
]);

assertClosedVocabulary('NAVIGATION_INTENTS', NAVIGATION_INTENTS, [
  'user_initiated',
  'redirect',
  'forward_back',
  'reload',
  'auto',
  'unknown',
]);

assertClosedVocabulary('LIFECYCLE_EVENT_KINDS', LIFECYCLE_EVENT_KINDS, [
  'before_navigate',
  'committed',
  'dom_content_loaded',
  'document_complete',
  'history_state_updated',
  'tab_removed',
  'unknown',
]);

assertClosedVocabulary('NETWORK_FACT_METHODS', NETWORK_FACT_METHODS, [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OTHER',
  'unknown',
]);

assertClosedVocabulary('NETWORK_FACT_SIZE_CLASSES', NETWORK_FACT_SIZE_CLASSES, [
  'empty',
  'small',
  'medium',
  'large',
  'unknown',
]);

assertClosedVocabulary('NETWORK_FACT_NOISE_CLASSES', NETWORK_FACT_NOISE_CLASSES, [
  'asset',
  'analytics',
  'auth',
  'private',
  'telemetry',
  'usable',
  'unknown',
]);

assertClosedVocabulary('FACT_OBSERVATION_EVENT_KINDS', FACT_OBSERVATION_EVENT_KINDS, [
  'network_request',
  'dom_fingerprint',
  'readiness_signal',
  'unknown',
]);

assertClosedVocabulary('ACTION_KINDS', ACTION_KINDS, [
  'click',
  'fill',
  'submit',
  'navigate',
  'keyboard',
  'unknown',
]);

assertClosedVocabulary('ACTION_SIGNAL_KINDS', ACTION_SIGNAL_KINDS, [
  'lifecycle_committed',
  'tab_created',
  'dom_region_changed',
  'network_completed',
  'dialog_opened',
  'unknown',
]);

assertClosedVocabulary('ACTION_OUTCOMES', ACTION_OUTCOMES, [
  'navigated_same_tab',
  'navigated_new_tab',
  'spa_partial_update',
  'modal_opened',
  'no_observed_change',
  'multiple_signals',
  'ambiguous',
  'unknown',
]);

assertClosedVocabulary('READINESS_STATES', READINESS_STATES, [
  'error',
  'empty',
  'document_complete',
  'key_region_ready',
  'network_key_done',
  'route_stable',
  'unknown',
]);

assertClosedVocabulary('COMPLEXITY_KINDS', COMPLEXITY_KINDS, [
  'simple',
  'list_or_search',
  'detail',
  'document',
  'transactional',
  'media',
  'complex_app',
  'unknown',
]);

assertClosedVocabulary('RECOMMENDED_LAYERS', RECOMMENDED_LAYERS, ['L0', 'L1', 'L2', 'unknown']);

assertClosedVocabulary('RECOMMENDED_LAYER_REASONS', RECOMMENDED_LAYER_REASONS, [
  'simple_shell',
  'list_or_search',
  'detail',
  'document',
  'transactional',
  'media',
  'complex_app',
  'not_ready',
  'unknown',
]);

assertClosedVocabulary('TAB_WINDOW_EVENT_KINDS', TAB_WINDOW_EVENT_KINDS, [
  'tab_created',
  'tab_removed',
  'tab_replaced',
  'window_focus_changed',
  'bfcache_restored',
  'unknown',
]);

assertClosedVocabulary('CONTEXT_INVALIDATION_REASONS', CONTEXT_INVALIDATION_REASONS, [
  'navigation',
  'route_change',
  'tab_closed',
  'tab_replaced',
  'task_ended',
  'bfcache_restored',
  'manual_reset',
  'unknown',
]);

assertClosedVocabulary('CONTEXT_LEVELS', CONTEXT_LEVELS, ['site', 'page', 'region', 'action', 'unknown']);

assertClosedVocabulary('STABLE_REF_REVALIDATION_OUTCOMES', STABLE_REF_REVALIDATION_OUTCOMES, [
  'live',
  'stale',
  'missing',
  'unknown',
]);

assertClosedVocabulary('OBSERVATION_KINDS', OBSERVATION_KINDS, [
  'lifecycle_event',
  'fact_snapshot',
  'action_outcome',
  'tab_event',
  'unknown',
]);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'browser-fact',
    vocabularyCount: 19,
  }),
);
