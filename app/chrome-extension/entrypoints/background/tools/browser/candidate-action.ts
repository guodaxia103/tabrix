import {
  STABLE_TARGET_REF_PREFIX,
  type ReadPageCandidateAction,
  type ReadPageCandidateActionLocator,
} from '@tabrix/shared';

export type CandidateActionSelectorType = 'css' | 'xpath';

export type CandidateActionInput = Partial<
  Pick<ReadPageCandidateAction, 'targetRef' | 'locatorChain'>
>;

/**
 * Optional stable-targetRef hooks. Kept as a thin functional interface
 * so the click bridge can pass in a real registry while unit tests pass
 * a stub.
 *
 * The contract is intentionally narrow:
 *   - `tabId` is the tab the resolved click will target. Without it the
 *     resolver cannot scope the registry lookup.
 *   - `lookupStableTargetRef(tabId, targetRef)` returns the live per-snapshot
 *     `ref` for `targetRef`, or `undefined` if there is no current mapping
 *     (e.g. service worker evicted, page navigated, registry never written).
 */
export interface ResolveCandidateActionTargetParams {
  explicitRef?: string;
  explicitSelector?: string;
  explicitSelectorType?: CandidateActionSelectorType;
  candidateAction?: CandidateActionInput;
  /** Tab the click will execute against. Required for stable-targetRef lookup. */
  tabId?: number;
  /** Lookup function injected by the caller. */
  lookupStableTargetRef?: (tabId: number, targetRef: string) => string | undefined;
}

export interface ResolvedCandidateActionTarget {
  ref?: string;
  selector?: string;
  selectorType?: CandidateActionSelectorType;
  source:
    | 'explicit_ref'
    | 'candidate_stable_target_ref'
    | 'candidate_target_ref'
    | 'explicit_selector'
    | 'candidate_locator_ref'
    | 'candidate_locator_css'
    | 'none'
    | 'unresolved_stable_target_ref';
  /**
   * When `source === 'unresolved_stable_target_ref'` this carries the
   * literal `tgt_*` value the caller supplied so the click bridge can
   * surface it in the error message and tell the upstream LLM exactly
   * what to re-read.
   */
  unresolvedStableTargetRef?: string;
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

function isStableTargetRef(value: string): boolean {
  return value.startsWith(STABLE_TARGET_REF_PREFIX);
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
    // Stable targetRefs (`tgt_*`) MUST route through the per-tab snapshot
    // registry. They are not valid accessibility-tree handles, so
    // forwarding one straight to the content script would always miss.
    // Failing closed here also prevents the click bridge from silently
    // aiming at a stale per-snapshot ref that happens to share a prefix.
    if (isStableTargetRef(candidateTargetRef)) {
      const lookup = params.lookupStableTargetRef;
      const tabId = params.tabId;
      if (lookup && typeof tabId === 'number') {
        const resolved = lookup(tabId, candidateTargetRef);
        if (resolved) {
          return {
            ref: resolved,
            source: 'candidate_stable_target_ref',
          };
        }
      }
      // Surface the unresolved case explicitly so the bridge can return a
      // helpful "call chrome_read_page first" error instead of a generic
      // "ref not found" message from the content-script side.
      return {
        source: 'unresolved_stable_target_ref',
        unresolvedStableTargetRef: candidateTargetRef,
      };
    }
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
