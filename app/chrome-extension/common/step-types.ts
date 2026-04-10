// step-types.ts — re-export shared constants to keep single source of truth
export { STEP_TYPES } from '@tabrix/shared';
export type StepTypeConst =
  (typeof import('@tabrix/shared'))['STEP_TYPES'][keyof (typeof import('@tabrix/shared'))['STEP_TYPES']];
