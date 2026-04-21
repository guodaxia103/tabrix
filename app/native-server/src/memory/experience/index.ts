/**
 * Stage 3b Experience layer public exports.
 */

export const EXPERIENCE_ACTION_PATHS_TABLE = 'experience_action_paths';
export const EXPERIENCE_LOCATOR_PREFS_TABLE = 'experience_locator_prefs';

export const EXPERIENCE_SELECTOR_KINDS = ['role', 'text', 'data-testid', 'css'] as const;
export type ExperienceSelectorKind = (typeof EXPERIENCE_SELECTOR_KINDS)[number];

export {
  ExperienceAggregator,
  buildActionPathId,
  normalizeIntentSignature,
  type ExperienceAggregationResult,
} from './experience-aggregator';
export {
  ExperienceRepository,
  type ExperienceActionPathRow,
  type ExperienceActionPathStep,
  type UpsertActionPathInput,
} from './experience-repository';
