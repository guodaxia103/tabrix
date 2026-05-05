/**
 * V24-01 closeout (replay-args portability): single source of truth for
 * "what makes an Experience step's `args` actually replayable across
 * sessions". The aggregator (`experience-aggregator.ts`) and the
 * chooser (`choose-context.ts::isReplayEligible`) BOTH route through
 * `extractPortableReplayArgs` so the persisted contract and the
 * routing gate cannot drift.
 *
 * Why a per-tool allowlist (instead of "parse JSON, strip a denylist
 * of session keys"):
 *
 *   - Recorded `inputSummary` for `chrome_click_element` /
 *     `chrome_fill_or_select` may carry per-snapshot accessibility
 *     refs (`ref`, `candidateAction.targetRef` like `ref_xyz`,
 *     `candidateAction.locatorChain[*].type === 'ref'`) plus tab/window
 *     handles (`tabId`, `windowId`, `frameId`) plus viewport
 *     `coordinates`. Replaying any of those against a different
 *     session would either silently click the wrong element or hit a
 *     dead handle. A denylist that misses a single new key would
 *     leak it back into replay.
 *   - The brief's v1 supported step kinds are a closed set
 *     (`TABRIX_EXPERIENCE_REPLAY_SUPPORTED_STEP_KINDS`). Their input
 *     schemas are stable (see `packages/shared/src/tools.ts`). An
 *     allowlist ties the persisted args 1:1 to the brief; widening
 *     replay to a new step kind requires an explicit edit here, not
 *     a passive "oh the recorder happens to dump everything".
 *
 * Fail-closed contract:
 *
 *   - Unsupported `toolName` → `undefined`.
 *   - Non-object input → `undefined`.
 *   - After stripping non-portable keys: if no portable target field
 *     survives (no `selector`, no portable `candidateAction.targetRef`,
 *     no `css` locator) → `undefined`.
 *   - For `chrome_fill_or_select`: missing `value` → `undefined`
 *     (the schema requires it; without `value` replay would fail at
 *     dispatch anyway).
 *
 * `undefined` means "this row is NOT replay-eligible" everywhere it
 * is consumed. The aggregator simply omits `args`; the chooser then
 * refuses to route the row to `experience_replay` and falls back to
 * `experience_reuse`.
 *
 * v1 explicitly DOES NOT introduce `templateFields` capture - that
 * substitution-side expansion is V24-02+'s job and is deliberately
 * out of scope for this PR (`templateFields` stays absent on
 * aggregator-written rows).
 */

import { STABLE_TARGET_REF_PREFIX } from '@tabrix/shared';

const SUPPORTED_TOOLS = new Set(['chrome_click_element', 'chrome_fill_or_select']);

/**
 * Per-tool top-level portable allowlist. Keys NOT listed here are
 * dropped on the floor - that includes the session-local handles
 * (`tabId`, `windowId`, `frameId`), the per-snapshot accessibility
 * `ref`, and viewport `coordinates`. Anything portable across a fresh
 * session (selector text, behavioural modifiers, the form `value`) is
 * preserved verbatim.
 *
 * `candidateAction` is intentionally on the allowlist but gets a
 * second pass through `extractPortableCandidateAction` so we can drop
 * non-`tgt_*` `targetRef`s and `type !== 'css'` locator chain entries.
 */
const PORTABLE_TOP_LEVEL_KEYS_BY_TOOL: Readonly<Record<string, ReadonlySet<string>>> = {
  chrome_click_element: new Set([
    'selector',
    'selectorType',
    'candidateAction',
    'double',
    'button',
    'modifiers',
    'allowDownloadClick',
    'waitForNavigation',
    'timeout',
  ]),
  chrome_fill_or_select: new Set(['selector', 'selectorType', 'candidateAction', 'value']),
};

/**
 * Reduce a raw object (parsed `inputSummary` for the aggregator,
 * already-persisted `step.args` for the chooser) to the portable
 * subset, OR return `undefined` if the result would not be safely
 * replayable across sessions.
 *
 * Pure: no IO, no logging, no clock - both call sites use this in a
 * tight per-step loop.
 */
export function extractPortableReplayArgs(
  toolName: string,
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!SUPPORTED_TOOLS.has(toolName)) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const allowlist = PORTABLE_TOP_LEVEL_KEYS_BY_TOOL[toolName];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowlist.has(key)) continue;
    if (key === 'candidateAction') {
      const portableCa = extractPortableCandidateAction(value);
      if (portableCa !== undefined) out.candidateAction = portableCa;
      continue;
    }
    out[key] = value;
  }

  // chrome_fill_or_select's input schema marks `value` as required.
  // Without it the bridge would reject the call at dispatch time, so
  // refuse to mark such rows replayable up front.
  if (toolName === 'chrome_fill_or_select' && !('value' in out)) return undefined;

  // Need at least ONE portable targeting handle. A row that only
  // carries behavioural modifiers (`button`, `timeout`, ...) but no
  // way to find the element is not replayable.
  if (!hasPortableTarget(out)) return undefined;

  return out;
}

function extractPortableCandidateAction(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const candidateAction = raw as Record<string, unknown>;
  const portableCandidateAction: Record<string, unknown> = {};

  // B-011 stable targetRef survives across snapshots and is the
  // explicitly portable form. Legacy `ref_xyz` accessibility-tree
  // refs are per-snapshot session-local handles; refusing them here
  // is the entire point of this PR.
  if (
    typeof candidateAction.targetRef === 'string' &&
    candidateAction.targetRef.startsWith(STABLE_TARGET_REF_PREFIX)
  ) {
    portableCandidateAction.targetRef = candidateAction.targetRef;
  }

  if (Array.isArray(candidateAction.locatorChain)) {
    const cssChain: Array<{ type: 'css'; value: string }> = [];
    for (const item of candidateAction.locatorChain) {
      if (
        item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'css' &&
        typeof (item as { value?: unknown }).value === 'string'
      ) {
        cssChain.push({ type: 'css', value: (item as { value: string }).value });
      }
      // type === 'ref' (and any future non-portable type) is dropped
      // on the floor - same reason `targetRef: 'ref_*'` is dropped.
    }
    if (cssChain.length > 0) portableCandidateAction.locatorChain = cssChain;
  }

  if (Object.keys(portableCandidateAction).length === 0) return undefined;
  return portableCandidateAction;
}

function hasPortableTarget(args: Record<string, unknown>): boolean {
  if (typeof args.selector === 'string' && args.selector.length > 0) return true;
  const ca = args.candidateAction;
  if (ca && typeof ca === 'object' && !Array.isArray(ca)) {
    const candidateAction = ca as Record<string, unknown>;
    if (typeof candidateAction.targetRef === 'string' && candidateAction.targetRef.length > 0) {
      return true;
    }
    if (Array.isArray(candidateAction.locatorChain) && candidateAction.locatorChain.length > 0) {
      return true;
    }
  }
  return false;
}
