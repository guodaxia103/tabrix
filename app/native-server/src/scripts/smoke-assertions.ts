/**
 * V26-S2-00 — Smoke Gate Repair: pure assertion helpers.
 *
 * Extracted from `smoke.ts` so the layered v2.6 `chrome_read_page` envelope
 * (`mode`/`page`/`summary`/`interactiveElements`/`L0`/`L1`) and the
 * keyboard/click/upload outcome diagnostics can be unit-tested without
 * spinning up the full MCP server.
 *
 * Each helper returns a `SmokeAssertion` whose `reason` is a *small closed
 * vocabulary* so a failed smoke step can be triaged into one of:
 *   - the assertion is outdated and needs updating
 *   - the test page can no longer satisfy the assertion
 *   - the underlying tool actually failed (`isError === true`)
 *   - the browser side never moved (state unchanged / observation missing)
 *
 * No sleeps, no timeouts: helpers are pure transforms over a tool result
 * and a DOM observation already gathered by the caller.
 */

export type SmokeAssertionReason =
  // read_page success paths
  | 'ok_layered_v26'
  | 'ok_legacy_pageContent'
  // generic non-read-page success
  | 'ok'
  // read_page failure paths
  | 'unsupported_page_type'
  | 'wrong_url'
  | 'missing_layered_fields'
  // shared failure paths
  | 'invalid_payload'
  | 'tool_returned_error'
  | 'browser_state_unchanged'
  | 'assertion_outdated'
  | 'observation_unavailable'
  | 'wrong_value_attached';

export interface SmokeAssertion {
  ok: boolean;
  reason: SmokeAssertionReason;
  detail: string;
}

const UNSUPPORTED_PAGE_TYPES = new Set([
  'browser_internal_page',
  'extension_page',
  'devtools_page',
  'unsupported_page',
]);

function brief(value: unknown, max = 120): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (!s) return '<empty>';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function unwrapJsResult(observed: unknown): string {
  if (
    observed &&
    typeof observed === 'object' &&
    'result' in (observed as Record<string, unknown>)
  ) {
    const inner = (observed as Record<string, unknown>).result;
    return inner == null ? '' : String(inner);
  }
  return observed == null ? '' : String(observed);
}

interface ToolResultLike {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
}

function describeToolError(result: ToolResultLike | null | undefined): string {
  if (!result) return 'no result returned';
  const text = result.content?.find((c) => c?.type === 'text')?.text;
  return brief(text ?? '<no text content>');
}

// ---------------------------------------------------------------------------
// chrome_read_page assessment
// ---------------------------------------------------------------------------

export interface AssessReadPageOptions {
  /**
   * If provided, the layered `page.url` (or legacy `url`) MUST start with
   * this prefix. Lets the smoke harness assert that the read came from
   * the temporary smoke server instead of an unrelated tab the browser
   * happened to switch to.
   */
  expectedUrlPrefix?: string | null;
}

/**
 * Validate a parsed `chrome_read_page` payload against the v2.6 layered
 * contract (`packages/shared/src/read-page-contract.ts`).
 *
 * Acceptance rules — in order:
 *   1. Reject explicit unsupported-page payloads (`success === false`,
 *      `reason === 'unsupported_page_type'`, or `pageType` in the
 *      non-web-tab set). This is the `chrome://newtab` /
 *      `browser_internal_page` failure mode the brief calls out.
 *   2. Accept the v2.6 layered shape: `mode` + `page.url/title` +
 *      `summary.pageRole` + `interactiveElements`. `L0` / `L1` are
 *      observed but not required (so a `requestedLayer === 'L0'` reply
 *      with `L1 === undefined` still passes).
 *   3. As back-compat ONLY, accept a legacy v2.5 payload that carries a
 *      non-empty top-level `pageContent`. Marked as `ok_legacy_pageContent`
 *      so the smoke output makes the back-compat path explicit.
 */
export function assessReadPagePayload(
  payload: unknown,
  opts: AssessReadPageOptions = {},
): SmokeAssertion {
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      reason: 'invalid_payload',
      detail: `chrome_read_page returned non-object payload: ${brief(payload)}`,
    };
  }

  const obj = payload as Record<string, unknown>;
  const page =
    obj.page && typeof obj.page === 'object' ? (obj.page as Record<string, unknown>) : null;
  const summary =
    obj.summary && typeof obj.summary === 'object'
      ? (obj.summary as Record<string, unknown>)
      : null;

  const declaredPageType =
    typeof obj.pageType === 'string'
      ? obj.pageType
      : page && typeof page.pageType === 'string'
        ? (page.pageType as string)
        : null;

  // 1) explicit unsupported guard
  if (
    obj.success === false ||
    obj.reason === 'unsupported_page_type' ||
    (declaredPageType && UNSUPPORTED_PAGE_TYPES.has(declaredPageType))
  ) {
    const recommended =
      typeof obj.recommendedAction === 'string' ? obj.recommendedAction : 'switch_to_http_tab';
    const observedUrl =
      page && typeof page.url === 'string' ? (page.url as string) : (obj.url as string | undefined);
    return {
      ok: false,
      reason: 'unsupported_page_type',
      detail:
        `chrome_read_page declined: pageType=${declaredPageType ?? 'unknown'} ` +
        `reason=${String(obj.reason ?? 'unsupported_page_type')} ` +
        `recommendedAction=${recommended} url=${brief(observedUrl ?? '<unknown>', 80)}`,
    };
  }

  // 2) v2.6 layered shape
  const hasLayered =
    typeof obj.mode === 'string' &&
    page !== null &&
    typeof page.url === 'string' &&
    typeof page.title === 'string' &&
    summary !== null &&
    typeof summary.pageRole === 'string' &&
    Array.isArray(obj.interactiveElements);

  if (hasLayered) {
    const url = page!.url as string;
    if (opts.expectedUrlPrefix && !url.startsWith(opts.expectedUrlPrefix)) {
      return {
        ok: false,
        reason: 'wrong_url',
        detail: `chrome_read_page page.url=${brief(url, 80)} does not start with ${opts.expectedUrlPrefix}`,
      };
    }
    const interactiveCount = (obj.interactiveElements as unknown[]).length;
    return {
      ok: true,
      reason: 'ok_layered_v26',
      detail:
        `mode=${String(obj.mode)} pageRole=${String((summary as Record<string, unknown>).pageRole)} ` +
        `interactive=${interactiveCount} L0=${obj.L0 ? 'present' : 'absent'} ` +
        `L1=${obj.L1 ? 'present' : 'absent'}`,
    };
  }

  // 3) legacy back-compat (NOT the documented v2.6 path; kept so the smoke
  //    does not regress when older snapshots flow through fallback paths).
  if (typeof obj.pageContent === 'string' && (obj.pageContent as string).length > 0) {
    if (
      opts.expectedUrlPrefix &&
      typeof obj.url === 'string' &&
      !(obj.url as string).startsWith(opts.expectedUrlPrefix)
    ) {
      return {
        ok: false,
        reason: 'wrong_url',
        detail: `legacy chrome_read_page url=${brief(obj.url, 80)} does not start with ${opts.expectedUrlPrefix}`,
      };
    }
    return {
      ok: true,
      reason: 'ok_legacy_pageContent',
      detail: `legacy v2.5 shape (pageContent length=${(obj.pageContent as string).length})`,
    };
  }

  return {
    ok: false,
    reason: 'missing_layered_fields',
    detail:
      `chrome_read_page payload missing both layered fields ` +
      `(mode/page/summary/interactiveElements) and legacy pageContent. ` +
      `Saw keys=[${Object.keys(obj).slice(0, 12).join(',')}]`,
  };
}

// ---------------------------------------------------------------------------
// chrome_keyboard / chrome_click_element / chrome_upload_file diagnostics
// ---------------------------------------------------------------------------

export interface AssessKeyboardOptions {
  /**
   * Pre-existing value we expect to still be in the input AFTER the
   * keyboard tool runs (proves chrome_fill_or_select did not regress).
   */
  expectedExistingValue: string;
  /**
   * Keys we asked chrome_keyboard to type. Their presence in the
   * observed value is what proves the keyboard tool actually fired.
   */
  expectedTypedSequence: string;
  /**
   * Raw chrome_javascript readback ToolResult. If this failed (policy-denied,
   * timeout, etc.) we surface `observation_unavailable` instead of pretending
   * the keyboard tool itself broke. P3 chrome_javascript blocked by default
   * Tabrix policy is the typical cause in non-allowlisted smoke runs.
   */
  observationCall?: ToolResultLike | null;
}

export function assessKeyboardOutcome(
  toolResult: ToolResultLike | null | undefined,
  observedValue: unknown,
  opts: AssessKeyboardOptions,
): SmokeAssertion {
  if (toolResult?.isError === true) {
    return {
      ok: false,
      reason: 'tool_returned_error',
      detail: `chrome_keyboard returned isError=true (${describeToolError(toolResult)})`,
    };
  }

  if (opts.observationCall?.isError === true) {
    return {
      ok: false,
      reason: 'observation_unavailable',
      detail:
        `chrome_keyboard tool call did not error, but the chrome_javascript readback ` +
        `failed (${describeToolError(opts.observationCall)}). ` +
        `Cannot decide whether the typed keys reached the page.`,
    };
  }

  const value = unwrapJsResult(observedValue);

  if (value.length === 0) {
    return {
      ok: false,
      reason: 'observation_unavailable',
      detail: 'chrome_javascript readback of #textInput.value returned empty',
    };
  }

  const hasExisting = value.includes(opts.expectedExistingValue);
  const hasTyped = value.includes(opts.expectedTypedSequence);

  if (hasExisting && hasTyped) {
    return {
      ok: true,
      reason: 'ok',
      detail: `chrome_keyboard appended ${JSON.stringify(opts.expectedTypedSequence)} (value=${brief(value, 80)})`,
    };
  }

  if (!hasExisting) {
    return {
      ok: false,
      reason: 'browser_state_unchanged',
      detail:
        `Pre-typed value (${JSON.stringify(opts.expectedExistingValue)}) was lost; ` +
        `observed value=${brief(value, 80)}. ` +
        `Likely chrome_fill_or_select regressed or the page was reloaded.`,
    };
  }

  return {
    ok: false,
    reason: 'assertion_outdated',
    detail:
      `chrome_fill_or_select value preserved but chrome_keyboard keys ` +
      `${JSON.stringify(opts.expectedTypedSequence)} not present (value=${brief(value, 80)}). ` +
      `Either the assertion is stale or chrome_keyboard never dispatched.`,
  };
}

export interface AssessClickOptions {
  /**
   * Substring expected in the observed state element AFTER the click
   * handler fires (e.g. the `clicked` token from `#status`).
   */
  expectedStateSubstring: string;
  /**
   * Pre-click value of the same element. Used to distinguish "click did
   * nothing" (value still equals this) from "click triggered something
   * else entirely" (value mutated but does not match the assertion).
   */
  preClickIdleValue?: string;
  /**
   * Raw chrome_javascript readback ToolResult. Same purpose as in
   * AssessKeyboardOptions: if the readback channel was policy-denied we
   * cannot decide whether the click handler fired, and we report
   * `observation_unavailable` instead of falsely accusing chrome_click_element.
   */
  observationCall?: ToolResultLike | null;
}

export function assessClickOutcome(
  toolResult: ToolResultLike | null | undefined,
  observedState: unknown,
  opts: AssessClickOptions,
): SmokeAssertion {
  if (toolResult?.isError === true) {
    return {
      ok: false,
      reason: 'tool_returned_error',
      detail: `chrome_click_element returned isError=true (${describeToolError(toolResult)})`,
    };
  }

  if (opts.observationCall?.isError === true) {
    return {
      ok: false,
      reason: 'observation_unavailable',
      detail:
        `chrome_click_element tool call did not error, but the chrome_javascript readback ` +
        `failed (${describeToolError(opts.observationCall)}). ` +
        `Cannot decide whether the click handler fired.`,
    };
  }

  const value = unwrapJsResult(observedState);

  if (value.length === 0) {
    return {
      ok: false,
      reason: 'observation_unavailable',
      detail: 'chrome_javascript readback of click target state returned empty',
    };
  }

  if (value.includes(opts.expectedStateSubstring)) {
    return {
      ok: true,
      reason: 'ok',
      detail: `Click handler fired (state=${brief(value, 80)})`,
    };
  }

  if (opts.preClickIdleValue && value.includes(opts.preClickIdleValue)) {
    return {
      ok: false,
      reason: 'browser_state_unchanged',
      detail:
        `Click did not toggle state; still pre-click value=${brief(value, 80)}. ` +
        `Likely the click did not reach the handler (selector mismatch / page navigation).`,
    };
  }

  return {
    ok: false,
    reason: 'assertion_outdated',
    detail:
      `Click target state changed but does not include ` +
      `${JSON.stringify(opts.expectedStateSubstring)} (value=${brief(value, 80)}). ` +
      `Either the page contract changed or the assertion is stale.`,
  };
}

export interface AssessUploadOptions {
  /**
   * Basename of the file that was uploaded; the smoke fixture echoes
   * the chosen file via `#fileName.textContent`.
   */
  expectedFileName: string;
}

export function assessUploadOutcome(
  toolResult: ToolResultLike | null | undefined,
  observedFileName: unknown,
  opts: AssessUploadOptions,
): SmokeAssertion {
  if (toolResult?.isError === true) {
    return {
      ok: false,
      reason: 'tool_returned_error',
      detail: `chrome_upload_file returned isError=true (${describeToolError(toolResult)})`,
    };
  }

  const value = unwrapJsResult(observedFileName).trim();

  if (value.length === 0) {
    return {
      ok: false,
      reason: 'browser_state_unchanged',
      detail:
        '#fileName remained empty after chrome_upload_file. ' +
        'The file picker callback never fired (file did not actually attach).',
    };
  }

  if (value.includes(opts.expectedFileName)) {
    return {
      ok: true,
      reason: 'ok',
      detail: `Uploaded file visible in DOM as ${brief(value, 80)}`,
    };
  }

  return {
    ok: false,
    reason: 'wrong_value_attached',
    detail:
      `#fileName=${brief(value, 80)} does not include expected file ` +
      `(${opts.expectedFileName}). A different file was attached or the readback is stale.`,
  };
}
