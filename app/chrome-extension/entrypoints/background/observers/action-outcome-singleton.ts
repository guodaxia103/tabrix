/**
 * Background-side singleton seam for the Action Outcome Observer.
 *
 * Why a seam?
 * - `attachActionOutcomeObserver()` returns a handle that only the
 *   service-worker boot path (`native-host.ts`) is allowed to construct
 *   (it owns the bridge `send` + `connectionId` accessors). Browser
 *   tools (`chrome_click_element`, etc.) need to call `observe()` on
 *   that handle, but importing them from the same module would either
 *   pull the entire native-host wiring graph into a tool, or force the
 *   tool to take an injected handle through every call site.
 * - This module is the smallest in-memory binding. `native-host.ts`
 *   calls `setActionOutcomeObserverHandle()` once after attaching the
 *   observer; tools call `armActionOutcome()` to start an observation.
 *   When the bridge is not yet up (the handle is `null`), arming
 *   degrades to a no-op handle and the tool's main path is untouched.
 *
 * Boundary:
 * - Best-effort: every helper here returns synchronously, swallows any
 *   thrown exception, and never blocks the tool's main path.
 * - No DOM access, no MCP tool surface change.
 * - The handle is module-local; tests reset it via
 *   `__resetActionOutcomeObserverHandleForTests()`.
 */
import type {
  ActionOutcomeObserverHandle,
  ActionOutcomeHandle,
  ActionDescriptor,
} from './action-outcome';
import type { ActionSignal } from '@tabrix/shared';

let handle: ActionOutcomeObserverHandle | null = null;

/**
 * Wire the singleton. Called once from `native-host.ts` right after
 * `attachActionOutcomeObserver()` so any subsequent
 * `armActionOutcome()` call by a tool can start observing.
 */
export function setActionOutcomeObserverHandle(next: ActionOutcomeObserverHandle | null): void {
  handle = next;
}

/**
 * Resolve the current handle. Internal helper; tools should prefer
 * `armActionOutcome()` so the no-op fallback is centralised.
 */
export function getActionOutcomeObserverHandle(): ActionOutcomeObserverHandle | null {
  return handle;
}

/**
 * No-op handle returned when no observer is wired (e.g. bridge not up
 * yet, or the SW just initialised). The tool's main path treats arming
 * as best-effort, so silently degrading is the right default — see the
 * product invariant: the observer must remain best-effort and must not
 * block a tool's main path.
 */
const NOOP_HANDLE: ActionOutcomeHandle = {
  pushSignal(): void {
    // intentionally empty
  },
  flush(): void {
    // intentionally empty
  },
  dispose(): void {
    // intentionally empty
  },
};

/**
 * Arm the action-outcome observer for a specific action. Returns a
 * handle the tool can use to push DOM-region / dialog signals or to
 * flush early. Always returns a handle (never `null`); when no
 * observer is wired the returned handle is a silent no-op.
 *
 * Best-effort: any error thrown by `observe()` is swallowed and a
 * no-op handle is returned in its place.
 */
export function armActionOutcome(
  descriptor: ActionDescriptor,
  options?: { settleWindowMs?: number },
): ActionOutcomeHandle {
  const live = handle;
  if (!live) return NOOP_HANDLE;
  try {
    return live.observe(descriptor, options);
  } catch {
    return NOOP_HANDLE;
  }
}

/** Test-only: drop the singleton. */
export function __resetActionOutcomeObserverHandleForTests(): void {
  handle = null;
}
