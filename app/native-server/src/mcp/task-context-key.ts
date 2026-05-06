import {
  READ_PAGE_REQUESTED_LAYER_VALUES,
  TOOL_NAMES,
  type ReadPageRequestedLayer,
} from '@tabrix/shared';

/**
 * Extract a stable, externally-supplied task / session key from a
 * tool-call's `args`. Lookup precedence:
 *
 *   1. `taskSessionId` (preferred — explicit naming)
 *   2. `taskId`        (alias for legacy MCP clients)
 *   3. `clientTaskId`  (alias for clients that already key their
 *                       work by a client-side request id)
 *
 * Returns `null` when nothing usable is found, in which case
 * `handleToolCall` falls back to the v2.5/v2.6 behaviour of using
 * the freshly-minted internal `taskId` (i.e. no cross-call
 * accumulation — strictly preserves the prior contract).
 *
 * Pure: tolerates `null`/non-object args, non-string values, and
 * whitespace-only strings without throwing.
 */
function extractStableTaskKey(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const argsObject = args as Record<string, unknown>;
  for (const key of ['taskSessionId', 'taskId', 'clientTaskId'] as const) {
    const raw = argsObject[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/**
 * Read the `chrome_read_page` requested layer from tool args using
 * the public schema name (`requestedLayer`) with the legacy `layer`
 * field as a graceful fallback for any historical client. Returns
 * `null` when neither field carries a value belonging to the closed
 * {@link READ_PAGE_REQUESTED_LAYER_VALUES} enum, which the caller
 * turns into the MCP-schema default (`'L0+L1+L2'`).
 *
 * The pre-fix code read `(args as any).layer` exclusively, which
 * silently downgraded every real client request to the gate's
 * internal default and sent the wrong layer to `noteReadPage`. The
 * gate decisions and post-success bookkeeping were therefore
 * decoupled from what the caller actually asked for.
 */
export function extractRequestedLayer(args: unknown): ReadPageRequestedLayer | null {
  if (!args || typeof args !== 'object') return null;
  const argsObject = args as Record<string, unknown>;
  for (const key of ['requestedLayer', 'layer'] as const) {
    const raw = argsObject[key];
    if (typeof raw !== 'string') continue;
    if ((READ_PAGE_REQUESTED_LAYER_VALUES as readonly string[]).includes(raw)) {
      return raw as ReadPageRequestedLayer;
    }
  }
  return null;
}

/**
 * MCP schema default per `packages/shared/src/tools.ts`:
 * "Optional; when omitted preserves the legacy full L0+L1+L2
 * payload." Centralised so the pre-gate and post-success sites
 * cannot drift apart on the default again.
 */
export const READ_PAGE_DEFAULT_LAYER: ReadPageRequestedLayer = 'L0+L1+L2';

/**
 * Make the read-budget task key visible to schema-following MCP clients
 * that DO NOT (and cannot) pass `taskSessionId / taskId / clientTaskId`,
 * since those fields are not part of the public `chrome_read_page`
 * schema (a strict client may even strip unknown fields).
 *
 * Only `chrome_read_page` (the gated tool), `chrome_navigate` (the
 * tool that invalidates the gate's lastReadLayer / targetRefsSeen
 * via `noteUrlChange`), `chrome_network_capture` (the live observed API
 * writer), and `tabrix_choose_context` (the decision writer that the
 * `chrome_read_page` shim consumes via
 * `peekChooseContextDecision`) participate in auto-keying. Every
 * other tool returns `null`, so click/fill/screenshot/etc. cannot
 * accidentally mint phantom external task contexts or pollute the
 * LRU map.
 *
 * `tabrix_choose_context` joins the auto set so a chooser → reader pair
 * issued back-to-back without an explicit `taskSessionId` lands on the
 * SAME `TaskSessionContext`. This is the only way the orchestrator can
 * read what the chooser wrote without the test having to spy on
 * `getTaskContext`. The chooser's public schema does not advertise
 * `tabId` either, so the auto fallback (primary tab →
 * `mcp:auto:tab:default`) is what makes the pairing work in the
 * schema-strict path.
 *
 * Resolution order (highest precedence first):
 *
 *   1. Explicit `extractStableTaskKey(args)` — caller already
 *      threaded a stable id through; honour it verbatim. This
 *      preserves the c21ac8b precedence contract bit-for-bit.
 *   2. Auto-key from `args.tabId` (positive integer) — strict
 *      schema clients pass this and the public schema documents it.
 *      Yields `mcp:auto:tab:<id>` so different tabs get isolated
 *      contexts (no cross-tab redundant pollution).
 *   3. Auto-key from `bridgeRuntimeState.primaryTabId` — when the
 *      caller omitted `tabId` and the bridge knows which tab is
 *      primary (e.g. set by an earlier `chrome_navigate`). Same
 *      `mcp:auto:tab:<id>` shape.
 *   4. Auto-key fallback `mcp:auto:tab:default` — single-tab
 *      session, or pre-bridge-ready cold start. URL invalidation
 *      via `chrome_navigate` still keeps redundancy honest inside
 *      this single context.
 *
 * Returning `null` (only possible for tools outside the auto set with no
 * explicit key) preserves the internal-taskId fallback path in
 * `handleToolCall`.
 */
export function resolveTaskContextKey(
  toolName: string,
  args: unknown,
  bridge: { primaryTabId: number | null },
): string | null {
  const explicit = extractStableTaskKey(args);
  if (explicit) return explicit;

  const autoEligible =
    toolName === TOOL_NAMES.BROWSER.READ_PAGE ||
    toolName === TOOL_NAMES.BROWSER.NAVIGATE ||
    toolName === TOOL_NAMES.BROWSER.NETWORK_CAPTURE ||
    toolName === TOOL_NAMES.CONTEXT.CHOOSE;
  if (!autoEligible) return null;

  const argTabId =
    args && typeof args === 'object' ? (args as Record<string, unknown>).tabId : undefined;
  if (typeof argTabId === 'number' && Number.isInteger(argTabId) && argTabId > 0) {
    return `mcp:auto:tab:${argTabId}`;
  }

  const primary = bridge.primaryTabId;
  if (typeof primary === 'number' && Number.isInteger(primary) && primary > 0) {
    return `mcp:auto:tab:${primary}`;
  }

  return 'mcp:auto:tab:default';
}

/**
 * Defensively walk a `chrome_navigate` extension response and extract
 * the resulting `tabId`. The extension may return the tabId directly on
 * the data object OR embed it in a stringified JSON content payload
 * (CallToolResult shape). Returns `null` when no integer-valued `tabId`
 * is found anywhere.
 *
 * Pure function. Tolerates malformed inputs (returns `null`) so the
 * controller observation hook in `handleToolCall` cannot throw.
 */
export function extractTabIdFromCallToolResult(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const direct = (data as Record<string, unknown>).tabId;
  if (Number.isInteger(direct)) return direct as number;
  const content = (data as { content?: unknown }).content;
  if (Array.isArray(content)) {
    for (const entry of content) {
      if (entry && typeof entry === 'object') {
        const text = (entry as { text?: unknown }).text;
        if (typeof text === 'string' && text.length > 0) {
          try {
            const parsed = JSON.parse(text);
            if (
              parsed &&
              typeof parsed === 'object' &&
              Number.isInteger((parsed as Record<string, unknown>).tabId)
            ) {
              return (parsed as Record<string, number>).tabId;
            }
          } catch {
            // Not JSON — skip.
          }
        }
      }
    }
  }
  return null;
}
