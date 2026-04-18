import type { ReadPageCandidateAction, ReadPageCandidateActionLocator } from '@tabrix/shared';

export type CandidateActionSelectorType = 'css' | 'xpath';

export type CandidateActionInput = Partial<
  Pick<ReadPageCandidateAction, 'targetRef' | 'locatorChain'>
>;

export interface ResolveCandidateActionTargetParams {
  explicitRef?: string;
  explicitSelector?: string;
  explicitSelectorType?: CandidateActionSelectorType;
  candidateAction?: CandidateActionInput;
}

export interface ResolvedCandidateActionTarget {
  ref?: string;
  selector?: string;
  selectorType?: CandidateActionSelectorType;
  source:
    | 'explicit_ref'
    | 'candidate_target_ref'
    | 'explicit_selector'
    | 'candidate_locator_ref'
    | 'candidate_locator_css'
    | 'none';
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstLocatorValue(
  locatorChain: ReadPageCandidateActionLocator[] | undefined,
  type: 'ref' | 'css',
): string | undefined {
  if (!Array.isArray(locatorChain)) return undefined;
  for (const locator of locatorChain) {
    if (locator?.type !== type) continue;
    const value = asNonEmptyString(locator.value);
    if (value) return value;
  }
  return undefined;
}

export function resolveCandidateActionTarget(
  params: ResolveCandidateActionTargetParams,
): ResolvedCandidateActionTarget {
  const explicitRef = asNonEmptyString(params.explicitRef);
  if (explicitRef) {
    return {
      ref: explicitRef,
      source: 'explicit_ref',
    };
  }

  const candidateTargetRef = asNonEmptyString(params.candidateAction?.targetRef);
  if (candidateTargetRef) {
    return {
      ref: candidateTargetRef,
      source: 'candidate_target_ref',
    };
  }

  const explicitSelector = asNonEmptyString(params.explicitSelector);
  if (explicitSelector) {
    return {
      selector: explicitSelector,
      selectorType: params.explicitSelectorType || 'css',
      source: 'explicit_selector',
    };
  }

  const locatorRef = firstLocatorValue(params.candidateAction?.locatorChain, 'ref');
  if (locatorRef) {
    return {
      ref: locatorRef,
      source: 'candidate_locator_ref',
    };
  }

  const locatorCss = firstLocatorValue(params.candidateAction?.locatorChain, 'css');
  if (locatorCss) {
    return {
      selector: locatorCss,
      selectorType: 'css',
      source: 'candidate_locator_css',
    };
  }

  return { source: 'none' };
}
