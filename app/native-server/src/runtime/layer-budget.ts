/**
 * Layer Budget Composer.
 *
 * Pure helper that combines a `ReadinessProfile` (V27-04a) and a
 * `ComplexityProfile` (V27-04b) into a `RecommendedLayerBudget`. The
 * composer is the only runtime module that is allowed to take both
 * arms as input at the same time — the readiness/complexity profilers
 * themselves stay orthogonal so the test matrix is small and the
 * decision rule has a paper trail.
 *
 * The recommendation is advisory. Router/Policy combine it with
 * privacy/risk policy + the active task intent + the latency budget
 * before committing. Batch A only declares the type and the composer;
 * actual wiring onto the production decision path lands later (V27-15
 * + V27-09 owner-lane Gate B).
 *
 * Privacy / boundary: pure function, no I/O. Inputs are already
 * brand-neutral (V27-02 guarantee). Outputs carry closed-enum metadata
 * only.
 */

import type {
  ComplexityProfile,
  ReadinessProfile,
  RecommendedLayer,
  RecommendedLayerBudget,
  RecommendedLayerReason,
} from '@tabrix/shared';

export interface ComposeLayerBudgetOptions {
  /** Optional clock for tests; defaults to the readiness profile's
   *  `producedAtMs` (so the verdict is deterministic). */
  now?: () => number;
}

/**
 * Compose a `RecommendedLayerBudget` from the two arms.
 *
 * Decision rule (closed enum, matches the V27-04 SoT):
 *   1. If readiness is `'error'` or `'empty'`, recommend `'L0'` with
 *      reason `'not_ready'` — there is no point reading deeper.
 *   2. If readiness is `'unknown'`, recommend `'unknown'` (the Router
 *      defaults to its existing v2.6 behaviour).
 *   3. Otherwise, map the complexity kind to a layer:
 *        - `simple`              -> `L0` / `simple_shell`
 *        - `list_or_search`      -> `L1` / `list_or_search` (needsApi)
 *        - `detail`              -> `L1` / `detail`         (needsApi)
 *        - `document`            -> `L1` / `document`       (needsMarkdown)
 *        - `transactional`       -> `L1` / `transactional`  (needsApi)
 *        - `media`               -> `L1` / `media`
 *        - `complex_app`         -> `L2` / `complex_app`    (needsL2)
 *        - `unknown`             -> `'unknown'` / `unknown`
 *
 * The composer's confidence is the lower of the two arm confidences
 * so callers can reason about it as a min-bound.
 */
export function composeLayerBudget(
  readiness: ReadinessProfile,
  complexity: ComplexityProfile,
  options: ComposeLayerBudgetOptions = {},
): RecommendedLayerBudget {
  const now = options.now ?? (() => readiness.producedAtMs);

  if (readiness.state === 'error' || readiness.state === 'empty') {
    return wrap({
      recommendedLayer: 'L0',
      reason: 'not_ready',
      needsApi: false,
      needsMarkdown: false,
      needsL2: false,
      readiness,
      complexity,
      confidence: minConfidence(readiness, complexity),
      producedAtMs: now(),
    });
  }

  if (readiness.state === 'unknown') {
    return wrap({
      recommendedLayer: 'unknown',
      reason: 'unknown',
      needsApi: false,
      needsMarkdown: false,
      needsL2: false,
      readiness,
      complexity,
      confidence: minConfidence(readiness, complexity),
      producedAtMs: now(),
    });
  }

  const mapped = mapComplexityToLayer(complexity);
  return wrap({
    recommendedLayer: mapped.layer,
    reason: mapped.reason,
    needsApi: mapped.needsApi,
    needsMarkdown: mapped.needsMarkdown,
    needsL2: mapped.needsL2,
    readiness,
    complexity,
    confidence: minConfidence(readiness, complexity),
    producedAtMs: now(),
  });
}

function mapComplexityToLayer(complexity: ComplexityProfile): {
  layer: RecommendedLayer;
  reason: RecommendedLayerReason;
  needsApi: boolean;
  needsMarkdown: boolean;
  needsL2: boolean;
} {
  switch (complexity.kind) {
    case 'simple':
      return {
        layer: 'L0',
        reason: 'simple_shell',
        needsApi: false,
        needsMarkdown: false,
        needsL2: false,
      };
    case 'list_or_search':
      return {
        layer: 'L1',
        reason: 'list_or_search',
        needsApi: true,
        needsMarkdown: false,
        needsL2: false,
      };
    case 'detail':
      return {
        layer: 'L1',
        reason: 'detail',
        needsApi: true,
        needsMarkdown: false,
        needsL2: false,
      };
    case 'document':
      return {
        layer: 'L1',
        reason: 'document',
        needsApi: false,
        needsMarkdown: true,
        needsL2: false,
      };
    case 'transactional':
      return {
        layer: 'L1',
        reason: 'transactional',
        needsApi: true,
        needsMarkdown: false,
        needsL2: false,
      };
    case 'media':
      return {
        layer: 'L1',
        reason: 'media',
        needsApi: false,
        needsMarkdown: false,
        needsL2: false,
      };
    case 'complex_app':
      return {
        layer: 'L2',
        reason: 'complex_app',
        needsApi: false,
        needsMarkdown: false,
        needsL2: true,
      };
    case 'unknown':
      return {
        layer: 'unknown',
        reason: 'unknown',
        needsApi: false,
        needsMarkdown: false,
        needsL2: false,
      };
    default: {
      const _exhaustive: never = complexity.kind;
      void _exhaustive;
      return {
        layer: 'unknown',
        reason: 'unknown',
        needsApi: false,
        needsMarkdown: false,
        needsL2: false,
      };
    }
  }
}

function minConfidence(a: ReadinessProfile, b: ComplexityProfile): number {
  const ca = clampUnit(a.confidence);
  const cb = clampUnit(b.confidence);
  return ca < cb ? ca : cb;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function wrap(input: RecommendedLayerBudget): RecommendedLayerBudget {
  return {
    ...input,
    confidence: clampUnit(input.confidence),
  };
}
