import { describe, expect, it } from '@jest/globals';

import { buildSmokeRuntimeLogSummary } from './smoke';
import {
  assessClickOutcome,
  assessKeyboardOutcome,
  assessReadPagePayload,
  assessUploadOutcome,
} from './smoke-assertions';

/**
 * V26-S2-00 — Smoke Gate Repair tests.
 *
 * Locks in:
 *   - the v2.6 layered chrome_read_page payload passes (mode/page/summary/
 *     interactiveElements/L0/L1) without requiring legacy `pageContent`.
 *   - the legacy v2.5 `pageContent`-only payload still passes (back-compat),
 *     but is NOT the only acceptance criterion — layered passes on its own.
 *   - chrome:// / browser_internal_page payloads fail with an actionable
 *     `unsupported_page_type` reason instead of being silently accepted.
 *   - keyboard/click/upload assessments split failures into discrete
 *     reasons (tool error vs. browser state vs. assertion outdated) so a
 *     real smoke failure is triageable without stepping through a debugger.
 */

function compactLayeredPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'compact',
    page: {
      url: 'http://127.0.0.1:54321/',
      title: 'Chrome MCP Smoke Test',
      pageType: 'web_page',
    },
    summary: {
      pageRole: 'tabrix_smoke',
      primaryRegion: 'main',
      quality: 'usable',
    },
    interactiveElements: [
      { ref: 'ref_001', role: 'button', name: 'Click me' },
      { ref: 'ref_002', role: 'textbox', name: '#textInput' },
    ],
    artifactRefs: [{ kind: 'dom_snapshot', ref: 'art_001' }],
    L0: {
      summary: '',
      taskMode: 'read',
      pageRole: 'tabrix_smoke',
      primaryRegion: 'main',
      focusObjectIds: [],
    },
    L1: { overview: '', highValueObjectIds: [], candidateActionIds: [] },
    L2: {
      available: true,
      defaultAccess: 'artifact_ref',
      detailRefs: [],
      expansions: [],
      boundary: '',
    },
    ...overrides,
  };
}

describe('buildSmokeRuntimeLogSummary — V27-OBS-00 smoke integration', () => {
  it('passes when bridge is ready and page console has no errors', () => {
    const summary = buildSmokeRuntimeLogSummary({
      statusSnapshot: { bridge: { bridgeState: 'READY' } },
      pageConsoleResult: [{ level: 'info', message: 'click button triggered' }],
    });

    expect(summary.runtimeLogMonitoringEnabled).toBe(true);
    expect(summary.bridgeReady).toBe(true);
    expect(summary.pageConsoleErrorCountDelta).toBe(0);
    expect(summary.status).toBe('pass');
  });

  it('marks missing page console and bridge status sources explicitly', () => {
    const summary = buildSmokeRuntimeLogSummary({});

    expect(summary.status).toBe('blocked');
    expect(summary.logSourceUnavailable).toEqual(['page_console', 'bridge_status']);
    expect(summary.blockedReasons).toEqual([
      'log_source_unavailable:page_console',
      'log_source_unavailable:bridge_status',
      'bridge_not_ready',
    ]);
  });
  it('blocks when bridge is not ready, log sources are unavailable, or page console has errors', () => {
    const summary = buildSmokeRuntimeLogSummary({
      statusSnapshot: { bridge: { bridgeState: 'BRIDGE_BROKEN' } },
      pageConsoleResult: [{ level: 'error', message: 'TypeError: failed' }],
      unavailableSources: ['extension_service_worker', 'chrome_extensions', 'operation_log'],
    });

    expect(summary.status).toBe('blocked');
    expect(summary.blockedReasons).toEqual([
      'log_source_unavailable:extension_service_worker',
      'log_source_unavailable:chrome_extensions',
      'log_source_unavailable:operation_log',
      'page_console_error_count_delta:1',
      'bridge_not_ready',
    ]);
  });
});
describe('assessReadPagePayload — v2.6 layered acceptance', () => {
  it('accepts the current v2.6 compact payload (no legacy pageContent required)', () => {
    const payload = compactLayeredPayload();
    expect('pageContent' in payload).toBe(false);

    const result = assessReadPagePayload(payload, {
      expectedUrlPrefix: 'http://127.0.0.1:54321',
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok_layered_v26');
    expect(result.detail).toContain('mode=compact');
    expect(result.detail).toContain('pageRole=tabrix_smoke');
    expect(result.detail).toContain('interactive=2');
    expect(result.detail).toContain('L0=present');
    expect(result.detail).toContain('L1=present');
  });

  it('still passes when L1/L2 are absent (requestedLayer=L0 envelope)', () => {
    const payload = compactLayeredPayload({ L1: undefined, L2: undefined });
    delete (payload as Record<string, unknown>).L1;
    delete (payload as Record<string, unknown>).L2;

    const result = assessReadPagePayload(payload);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok_layered_v26');
    expect(result.detail).toContain('L1=absent');
  });

  it('still accepts a legacy v2.5 pageContent-only payload (back-compat fallback)', () => {
    // Intentionally has NO mode/page/summary/interactiveElements — only the
    // old top-level pageContent surface that v2.5 callers used to inspect.
    const legacy = {
      pageContent: 'Chrome MCP Smoke Test\nClick me\nFetch data',
      url: 'http://127.0.0.1:54321/',
    };

    const result = assessReadPagePayload(legacy, {
      expectedUrlPrefix: 'http://127.0.0.1:54321',
    });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok_legacy_pageContent');
  });

  it('marks layered and legacy success paths with DIFFERENT reasons (legacy is back-compat, not the documented path)', () => {
    const layered = assessReadPagePayload(compactLayeredPayload());
    const legacy = assessReadPagePayload({
      pageContent: 'Chrome MCP Smoke Test',
      url: 'http://127.0.0.1:54321/',
    });

    expect(layered.ok).toBe(true);
    expect(legacy.ok).toBe(true);
    expect(layered.reason).toBe('ok_layered_v26');
    expect(legacy.reason).toBe('ok_legacy_pageContent');
    expect(layered.reason).not.toBe(legacy.reason);
  });
});

describe('assessReadPagePayload — unsupported / non-web tabs MUST fail', () => {
  it('rejects chrome://newtab-style browser_internal_page payloads with an actionable reason', () => {
    // Mirrors the unsupported branch in
    // `app/chrome-extension/entrypoints/background/tools/browser/read-page.ts`
    // (success: false + reason: 'unsupported_page_type' + recommendedAction).
    const newtabPayload = {
      success: false,
      mode: 'compact',
      page: {
        url: 'chrome://newtab/',
        title: 'New Tab',
        pageType: 'browser_internal_page',
      },
      summary: { pageRole: 'unknown', primaryRegion: null, quality: 'sparse' },
      interactiveElements: [],
      artifactRefs: [],
      reason: 'unsupported_page_type',
      pageType: 'browser_internal_page',
      scheme: 'chrome',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };

    const result = assessReadPagePayload(newtabPayload);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported_page_type');
    expect(result.detail).toContain('pageType=browser_internal_page');
    expect(result.detail).toContain('switch_to_http_tab');
  });

  it('rejects extension_page / devtools_page / unsupported_page even without an explicit success:false flag', () => {
    for (const pageType of ['extension_page', 'devtools_page', 'unsupported_page']) {
      const payload = {
        mode: 'compact',
        page: { url: `chrome-extension://abc/${pageType}.html`, title: pageType, pageType },
        summary: { pageRole: 'unknown', primaryRegion: null, quality: 'sparse' },
        interactiveElements: [],
        artifactRefs: [],
      };
      const result = assessReadPagePayload(payload);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unsupported_page_type');
      expect(result.detail).toContain(`pageType=${pageType}`);
    }
  });

  it('rejects layered payloads whose page.url does not match the expected prefix', () => {
    const wrongTab = compactLayeredPayload({
      page: {
        url: 'https://example.com/some-other-page',
        title: 'Different page',
        pageType: 'web_page',
      },
    });

    const result = assessReadPagePayload(wrongTab, {
      expectedUrlPrefix: 'http://127.0.0.1:54321',
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_url');
    expect(result.detail).toContain('does not start with http://127.0.0.1:54321');
  });

  it('rejects payloads that have neither layered fields nor legacy pageContent', () => {
    const result = assessReadPagePayload({ tips: 'hi', refMap: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_layered_fields');
  });

  it('rejects non-object payloads', () => {
    expect(assessReadPagePayload(null).reason).toBe('invalid_payload');
    expect(assessReadPagePayload('a string instead of JSON').reason).toBe('invalid_payload');
  });
});

describe('assessKeyboardOutcome — split failure reasons', () => {
  const okOpts = { expectedExistingValue: 'phase0', expectedTypedSequence: 'X' };

  it('passes when the typed sequence appears alongside the pre-filled value', () => {
    const result = assessKeyboardOutcome({ isError: false }, { result: 'phase0X' }, okOpts);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('flags an actual chrome_keyboard tool failure as tool_returned_error', () => {
    const result = assessKeyboardOutcome(
      { isError: true, content: [{ type: 'text', text: 'bridge timeout' }] },
      { result: 'phase0' },
      okOpts,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tool_returned_error');
    expect(result.detail).toContain('bridge timeout');
  });

  it('flags a missing typed key (state preserved but X not appended) as assertion_outdated', () => {
    // The existing value is still there but chrome_keyboard never typed `X`.
    // This is the "assertion is checking the wrong thing" failure mode.
    const result = assessKeyboardOutcome({ isError: false }, { result: 'phase0' }, okOpts);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('assertion_outdated');
  });

  it('flags a lost pre-filled value (page reloaded / fill regressed) as browser_state_unchanged', () => {
    const result = assessKeyboardOutcome({ isError: false }, { result: '' }, okOpts);
    // empty observation → observation_unavailable, not state_unchanged.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('observation_unavailable');

    const drifted = assessKeyboardOutcome(
      { isError: false },
      { result: 'something-else-entirely' },
      okOpts,
    );
    expect(drifted.ok).toBe(false);
    expect(drifted.reason).toBe('browser_state_unchanged');
  });

  it('flags a policy-denied chrome_javascript readback as observation_unavailable (NOT a keyboard regression)', () => {
    // Mirrors the real smoke run where chrome_javascript is P3 by default
    // and returns isError=true with a TABRIX_POLICY_DENIED_P3 envelope.
    // chrome_keyboard succeeded; we cannot OBSERVE the result, so the brief
    // is explicit: do NOT silently mark this as a tool regression.
    const result = assessKeyboardOutcome(
      { isError: false },
      { code: 'TABRIX_POLICY_DENIED_P3', message: '...' },
      {
        ...okOpts,
        observationCall: {
          isError: true,
          content: [{ type: 'text', text: '{"code":"TABRIX_POLICY_DENIED_P3"}' }],
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('observation_unavailable');
    expect(result.detail).toContain('TABRIX_POLICY_DENIED_P3');
  });
});

describe('assessClickOutcome — split failure reasons', () => {
  const opts = { expectedStateSubstring: 'clicked', preClickIdleValue: 'idle' };

  it('passes when the click handler updates state to include the expected token', () => {
    const result = assessClickOutcome({ isError: false }, { result: 'clicked' }, opts);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('flags chrome_click_element tool failures as tool_returned_error', () => {
    const result = assessClickOutcome(
      { isError: true, content: [{ type: 'text', text: 'selector not found' }] },
      { result: 'idle' },
      opts,
    );
    expect(result.reason).toBe('tool_returned_error');
    expect(result.detail).toContain('selector not found');
  });

  it('flags an unmoved state (still idle) as browser_state_unchanged', () => {
    const result = assessClickOutcome({ isError: false }, { result: 'idle' }, opts);
    expect(result.reason).toBe('browser_state_unchanged');
  });

  it('flags a moved-but-different state as assertion_outdated', () => {
    const result = assessClickOutcome({ isError: false }, { result: 'something-else' }, opts);
    expect(result.reason).toBe('assertion_outdated');
  });

  it('flags an empty readback as observation_unavailable (chrome_javascript could not see the node)', () => {
    const result = assessClickOutcome({ isError: false }, '', opts);
    expect(result.reason).toBe('observation_unavailable');
  });

  it('flags a policy-denied chrome_javascript readback as observation_unavailable (NOT a click regression)', () => {
    const result = assessClickOutcome(
      { isError: false },
      { code: 'TABRIX_POLICY_DENIED_P3' },
      {
        ...opts,
        observationCall: {
          isError: true,
          content: [{ type: 'text', text: '{"code":"TABRIX_POLICY_DENIED_P3"}' }],
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('observation_unavailable');
    expect(result.detail).toContain('TABRIX_POLICY_DENIED_P3');
  });
});

describe('assessUploadOutcome — split failure reasons', () => {
  const opts = { expectedFileName: 'tabrix-smoke-1234.txt' };

  it('passes when the uploaded filename appears in the DOM', () => {
    const result = assessUploadOutcome(
      { isError: false },
      { result: 'tabrix-smoke-1234.txt' },
      opts,
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('flags chrome_upload_file tool failures as tool_returned_error', () => {
    const result = assessUploadOutcome(
      { isError: true, content: [{ type: 'text', text: 'file not found' }] },
      { result: '' },
      opts,
    );
    expect(result.reason).toBe('tool_returned_error');
  });

  it('flags an empty #fileName as browser_state_unchanged (file picker never fired)', () => {
    const result = assessUploadOutcome({ isError: false }, { result: '' }, opts);
    expect(result.reason).toBe('browser_state_unchanged');
    expect(result.detail).toContain('did not actually attach');
  });

  it('flags a different filename as wrong_value_attached', () => {
    const result = assessUploadOutcome(
      { isError: false },
      { result: 'someone-elses-file.zip' },
      opts,
    );
    expect(result.reason).toBe('wrong_value_attached');
  });
});
