import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TOOL_NAMES } from '@tabrix/shared';
import { SessionManager } from '../execution/session-manager';
import { TaskSessionContext } from '../execution/task-session-context';
import { __hostConfigInternals, setPersistedPolicyCapabilities } from '../host-config';
import {
  runPostProcessor,
  chromeReadPagePostProcessor,
  chromeActionPostProcessor,
  chromeNetworkCapturePostProcessor,
  TOOL_POST_PROCESSORS,
} from './tool-post-processors';

function wrap(body: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}

const readPageBody = {
  mode: 'compact',
  page: {
    url: 'https://github.com/openclaw/openclaw',
    title: 'openclaw/openclaw',
    pageType: 'web_page',
  },
  summary: { pageRole: 'github_repo_home', primaryRegion: 'main', quality: 'usable' },
  interactiveElements: [],
  artifactRefs: [],
  highValueObjects: [],
  historyRef: null,
};

describe('runPostProcessor', () => {
  it('returns raw result untouched for tools without a processor', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_screenshot',
      });
      const raw = wrap(readPageBody);
      const out = runPostProcessor({
        toolName: 'chrome_screenshot',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
    } finally {
      manager.close();
    }
  });
});

describe('chromeReadPagePostProcessor', () => {
  it('injects historyRef into the JSON body and returns it as an artifact ref', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw = wrap(readPageBody);
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: { tabId: 9 },
      });

      expect(out.extraArtifactRefs).toHaveLength(1);
      expect(out.extraArtifactRefs[0]).toMatch(/^memory:\/\/snapshot\/[0-9a-f-]+$/);

      const parsed = JSON.parse((out.rawResult.content as any[])[0].text);
      expect(parsed.historyRef).toBe(out.extraArtifactRefs[0]);

      // Original raw result must not have been mutated.
      const original = JSON.parse((raw.content as any[])[0].text);
      expect(original.historyRef).toBeNull();
    } finally {
      manager.close();
    }
  });

  it('degrades silently when Memory is off (persistenceEnabled=false)', () => {
    const manager = new SessionManager({ persistenceEnabled: false });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw = wrap(readPageBody);
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
    } finally {
      manager.close();
    }
  });

  it('degrades when the body is not JSON, without throwing', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw: CallToolResult = { content: [{ type: 'text', text: 'not a json string' }] };
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      expect(out.extraArtifactRefs).toEqual([]);
      expect(out.rawResult).toBe(raw);
    } finally {
      manager.close();
    }
  });
});

describe('TOOL_POST_PROCESSORS registry (Phase 0.3)', () => {
  it('registers the action processor for all four DOM action tools', () => {
    for (const name of [
      'chrome_click_element',
      'chrome_fill_or_select',
      'chrome_navigate',
      'chrome_keyboard',
    ]) {
      expect(TOOL_POST_PROCESSORS[name]).toBe(chromeActionPostProcessor);
    }
  });
});

describe('chromeActionPostProcessor', () => {
  function bootstrap() {
    const manager = new SessionManager({ dbPath: ':memory:' });
    const task = manager.createTask({
      taskType: 'tool-call',
      title: 't',
      intent: 'i',
      origin: 'jest',
    });
    const session = manager.startSession({
      taskId: task.taskId,
      transport: 'stdio',
      clientName: 'jest',
    });
    const step = manager.startStep({
      sessionId: session.sessionId,
      toolName: 'chrome_click_element',
    });
    return { manager, session, step };
  }

  it('records a click action and injects historyRef into JSON body', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap({ message: 'clicked', elementInfo: { role: 'button' } });
      const out = chromeActionPostProcessor({
        toolName: 'chrome_click_element',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: { tabId: 9, ref: 'e-1' },
      });
      expect(out.extraArtifactRefs).toHaveLength(1);
      expect(out.extraArtifactRefs[0]).toMatch(/^memory:\/\/action\/[0-9a-f-]+$/);
      const parsed = JSON.parse((out.rawResult.content as any[])[0].text);
      expect(parsed.historyRef).toBe(out.extraArtifactRefs[0]);

      // Original is not mutated.
      const original = JSON.parse((raw.content as any[])[0].text);
      expect(original.historyRef).toBeUndefined();

      const persisted = manager.actions!.listByStep(step.stepId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].actionKind).toBe('click');
      expect(persisted[0].tabId).toBe(9);
    } finally {
      manager.close();
    }
  });

  it('still records a row and returns artifactRef for plain-text error bodies', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw: CallToolResult = {
        content: [{ type: 'text', text: 'Element not found' }],
        isError: true,
      };
      const out = chromeActionPostProcessor({
        toolName: 'chrome_click_element',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: { tabId: 9, ref: 'e-missing' },
      });
      expect(out.extraArtifactRefs).toHaveLength(1);
      // Plain-text body: inline injection is skipped.
      expect((out.rawResult.content as any[])[0].text).toBe('Element not found');
      const persisted = manager.actions!.listByStep(step.stepId);
      expect(persisted[0].status).toBe('failed');
    } finally {
      manager.close();
    }
  });

  it('degrades silently when Memory persistence is off', () => {
    const manager = new SessionManager({ persistenceEnabled: false });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_click_element',
      });
      const raw = wrap({ message: 'ok' });
      const out = chromeActionPostProcessor({
        toolName: 'chrome_click_element',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: { tabId: 9, ref: 'e-1' },
      });
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
    } finally {
      manager.close();
    }
  });
});

/**
 * B-017 end-to-end — proves the capability gate + redaction contract
 * actually fires through the post-processor that real `chrome_network_capture`
 * results flow through.
 *
 * The shape we feed `runPostProcessor` here mirrors the JSON body the
 * extension's `network-capture-debugger.ts` / `network-capture-web-request.ts`
 * tools serialize when `action: "stop"` returns. We do NOT mock the
 * post-processor itself — we want the registry → gate → derive → upsert
 * chain to be the unit under test.
 */
describe('chromeNetworkCapturePostProcessor (B-017 integration)', () => {
  const SAMPLE_BUNDLE = {
    requests: [
      {
        url: 'https://api.github.com/search/repositories?q=AI助手&sort=stars&order=desc',
        method: 'GET',
        statusCode: 200,
        specificRequestHeaders: {
          Authorization: 'Bearer ghp_SUPERSECRET_token_VALUE_should_never_persist',
          Cookie: 'session=cookie-payload-PII; tracking=xyz',
          'User-Agent': 'tabrix-test/1.0',
          Accept: 'application/json',
        },
        specificResponseHeaders: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'session=NEW_VALUE_PII; HttpOnly',
        },
        requestBody: 'raw-request-body-PII=should_never_persist',
        responseBody: JSON.stringify({
          items: [{ id: 1, full_name: 'octocat/private-title-PII', owner: { login: 'octocat' } }],
        }),
      },
      // A non-github request that must be silently dropped.
      {
        url: 'https://example.com/api/things?secret=hunter2',
        method: 'GET',
        statusCode: 200,
        responseBody: '{}',
      },
      // A private telemetry-like GitHub endpoint must not become
      // unclassified endpoint knowledge.
      {
        url: 'https://api.github.com/_private/browser/stats?token=raw_query_secret',
        method: 'GET',
        statusCode: 200,
        mimeType: 'application/json',
        responseBody: '{}',
      },
    ],
  };

  function bootstrap() {
    const manager = new SessionManager({ dbPath: ':memory:' });
    const task = manager.createTask({
      taskType: 'tool-call',
      title: 't',
      intent: 'i',
      origin: 'jest',
    });
    const session = manager.startSession({
      taskId: task.taskId,
      transport: 'stdio',
      clientName: 'jest',
    });
    const step = manager.startStep({
      sessionId: session.sessionId,
      toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
    });
    return { manager, session, step };
  }

  const ENV_KEY = 'TABRIX_POLICY_CAPABILITIES';
  let prevEnv: string | undefined;
  let configDir: string;
  beforeEach(() => {
    prevEnv = process.env[ENV_KEY];
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabrix-network-capabilities-'));
    __hostConfigInternals.setConfigFileForTesting(path.join(configDir, 'config.json'));
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnv;
    __hostConfigInternals.setConfigFileForTesting(null);
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('is registered for the canonical NETWORK_CAPTURE tool name', () => {
    expect(TOOL_POST_PROCESSORS[TOOL_NAMES.BROWSER.NETWORK_CAPTURE]).toBe(
      chromeNetworkCapturePostProcessor,
    );
  });

  it('captures NOTHING when capability gate is closed (default)', () => {
    delete process.env[ENV_KEY];
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      // Result is unchanged (Knowledge capture is invisible side-effect).
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
      // And NOTHING landed in the Knowledge table.
      expect(manager.knowledgeApi!.countAll()).toBe(0);
    } finally {
      manager.close();
    }
  });

  it('captures GitHub-only rows from persisted api_knowledge when shell env is absent', () => {
    delete process.env[ENV_KEY];
    setPersistedPolicyCapabilities('api_knowledge');
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      // Exactly one row — example.com was dropped at the classifier.
      expect(manager.knowledgeApi!.countAll()).toBe(1);
      const rows = manager.knowledgeApi!.listBySite('api.github.com');
      expect(rows).toHaveLength(1);
      const row = rows[0];

      // Useful, redacted shape:
      expect(row.semanticTag).toBe('github.search_repositories');
      expect(row.urlPattern).toBe('api.github.com/search/repositories');
      expect(row.method).toBe('GET');
      expect(row.statusClass).toBe('2xx');
      expect(row.requestSummary.hasAuth).toBe(true);
      expect(row.requestSummary.hasCookie).toBe(true);
      expect(row.requestSummary.queryKeys).toEqual(['order', 'q', 'sort']);
      expect(row.responseSummary.shape).toMatchObject({
        kind: 'object',
      });
      expect(row.sourceSessionId).toBe(session.sessionId);
      expect(row.sourceStepId).toBe(step.stepId);

      // Hard PII guarantee: no raw secret leaked anywhere into the row.
      const blob = JSON.stringify(row);
      const FORBIDDEN = [
        'ghp_SUPERSECRET',
        'SUPERSECRET',
        'cookie-payload-PII',
        'NEW_VALUE_PII',
        'private-title-PII',
        'raw-request-body-PII',
        'raw_query_secret',
        '_private/browser/stats',
        'AI助手',
        'stars',
        'hunter2',
        'octocat',
      ];
      for (const needle of FORBIDDEN) {
        expect(blob).not.toContain(needle);
      }
    } finally {
      manager.close();
    }
  });

  it('gives shell env priority over persisted config when deciding capture enablement', () => {
    setPersistedPolicyCapabilities('api_knowledge');
    process.env[ENV_KEY] = 'experience_replay';
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      expect(manager.knowledgeApi!.countAll()).toBe(0);
    } finally {
      manager.close();
    }
  });

  it('does not mutate the MCP response on success (response stays byte-identical)', () => {
    process.env[ENV_KEY] = 'all';
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      const originalText = (raw.content as any[])[0].text;
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
      expect((raw.content as any[])[0].text).toBe(originalText);
    } finally {
      manager.close();
    }
  });

  it('degrades silently on malformed bundle JSON', () => {
    process.env[ENV_KEY] = 'api_knowledge';
    const { manager, session, step } = bootstrap();
    try {
      const raw: CallToolResult = { content: [{ type: 'text', text: 'not json' }] };
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(manager.knowledgeApi!.countAll()).toBe(0);
    } finally {
      manager.close();
    }
  });

  it('upsert dedup: re-running the same bundle does not double-count', () => {
    process.env[ENV_KEY] = 'api_knowledge';
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      for (let i = 0; i < 3; i++) {
        runPostProcessor({
          toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
          rawResult: raw,
          stepId: step.stepId,
          sessionId: session.sessionId,
          sessionManager: manager,
          args: {},
        });
      }
      expect(manager.knowledgeApi!.countAll()).toBe(1);
      const [row] = manager.knowledgeApi!.listBySite('api.github.com');
      expect(row.sampleCount).toBe(3);
      // First-seen provenance sticks to the first observation; even after
      // 3 hits, sourceSessionId is still the original session.
      expect(row.sourceSessionId).toBe(session.sessionId);
    } finally {
      manager.close();
    }
  });

  it('uses capture tabUrl as live observed relevance context when task currentUrl is absent', () => {
    process.env[ENV_KEY] = 'api_knowledge';
    const { manager, session, step } = bootstrap();
    const taskContext = new TaskSessionContext();
    const raw = wrap({
      tabUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 8,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      requests: [
        {
          url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
          method: 'GET',
          statusCode: 200,
          mimeType: 'application/json',
          specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
          responseBody: JSON.stringify({
            items: [
              { title: 'Desk Alpha', score: 1 },
              { title: 'Desk Beta', score: 2 },
            ],
          }),
          base64Encoded: false,
          responseBodySource: 'debugger_api',
          rawBodyPersisted: false,
          bodyCompacted: true,
        },
      ],
    });

    try {
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        taskContext,
        args: {},
      });

      expect(taskContext.currentUrl).toBeNull();
      expect(taskContext.peekLiveObservedApiData()).toMatchObject({
        selectedDataSource: 'cdp_enhanced_api_rows',
        endpointSource: 'observed',
        responseSummarySource: 'debugger_body_probe',
        responseBodySource: 'debugger_api',
        rowCount: 2,
      });
    } finally {
      manager.close();
    }
  });
});
