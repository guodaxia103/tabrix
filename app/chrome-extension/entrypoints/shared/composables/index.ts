/**
 * @fileoverview Shared UI Composables
 * @description Composables shared between multiple UI entrypoints (Sidepanel, Popup, etc.)
 *
 * Note: These composables are for UI-only use. Do not import them in background scripts
 * as they depend on Vue and will bloat the service worker bundle.
 *
 * The record-replay (RR) RPC composables were removed as part of the MKEP pruning
 * (see docs/PRODUCT_PRUNING_PLAN.md §1.2). New MKEP-aligned composables will be
 * exported from here in Stage 3+.
 */

export * from './useMemoryTimeline';
