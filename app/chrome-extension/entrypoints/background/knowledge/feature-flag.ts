/**
 * Feature flag for the MKEP Knowledge Registry Stage 1 rollout.
 *
 * Mode semantics — mirrors `docs/KNOWLEDGE_STAGE_1.md §4.4`:
 *
 * - `off`  — skip the registry entirely, `inferPageUnderstanding` runs the
 *            legacy TS family adapters. This is the one-line rollback.
 * - `on`   — registry-first: try the registry; on miss fall through to the
 *            legacy adapters. Default.
 * - `diff` — dev-only: run both paths, `console.warn` any divergence, but
 *            **return the legacy result** so any bug in the registry cannot
 *            affect production output.
 *
 * Stage 1 keeps this as an internal constant deliberately (not env / not
 * chrome.storage): we do not yet ship user-facing configuration surfaces for
 * Knowledge. When Stage 2 introduces cross-process sync or persistence we
 * revisit promoting this to a real config source.
 */
export type KnowledgeRegistryMode = 'off' | 'on' | 'diff';

export const KNOWLEDGE_REGISTRY_MODE: KnowledgeRegistryMode = 'on';

export function isKnowledgeRegistryEnabled(
  mode: KnowledgeRegistryMode = KNOWLEDGE_REGISTRY_MODE,
): boolean {
  return mode !== 'off';
}

export function isKnowledgeRegistryDiffMode(
  mode: KnowledgeRegistryMode = KNOWLEDGE_REGISTRY_MODE,
): boolean {
  return mode === 'diff';
}
