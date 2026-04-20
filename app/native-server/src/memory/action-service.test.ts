import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { openMemoryDb } from './db/client';
import { ActionRepository } from './db/action-repository';
import { PageSnapshotRepository } from './db/page-snapshot-repository';
import { SessionRepository } from './db/session-repository';
import { StepRepository } from './db/step-repository';
import { TaskRepository } from './db/task-repository';
import {
  ActionService,
  buildActionFromTool,
  redactFillValue,
  ACTION_KIND_BY_TOOL,
} from './action-service';

function wrap(body: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }], isError };
}

function wrapPlain(text: string, isError = true): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function bootstrap() {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const stepRepo = new StepRepository(db);
  const snapshotRepo = new PageSnapshotRepository(db);
  const actionRepo = new ActionRepository(db);

  taskRepo.insert({
    taskId: 'task-a',
    taskType: 't',
    title: 't',
    intent: 'i',
    origin: 'jest',
    labels: [],
    status: 'running',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
  });
  sessionRepo.insert({
    sessionId: 'sess-1',
    taskId: 'task-a',
    transport: 'stdio',
    clientName: 'jest',
    status: 'running',
    startedAt: '2026-04-20T00:00:01.000Z',
    steps: [],
  });
  stepRepo.insert({
    stepId: 'step-1',
    sessionId: 'sess-1',
    index: 1,
    toolName: 'chrome_click_element',
    stepType: 'tool_call',
    status: 'running',
    inputSummary: undefined,
    resultSummary: undefined,
    errorCode: undefined,
    errorSummary: undefined,
    artifactRefs: [],
    startedAt: '2026-04-20T00:00:02.000Z',
  });

  const service = new ActionService(actionRepo, snapshotRepo);
  return { actionRepo, snapshotRepo, service, close: () => db.close() };
}

describe('ACTION_KIND_BY_TOOL', () => {
  it('covers exactly the four Phase 0.3 DOM action tools', () => {
    expect(Object.keys(ACTION_KIND_BY_TOOL).sort()).toEqual([
      'chrome_click_element',
      'chrome_fill_or_select',
      'chrome_keyboard',
      'chrome_navigate',
    ]);
  });
});

describe('redactFillValue', () => {
  it('produces a stable length + sha256 for string values, no plaintext', () => {
    const summary = redactFillValue('hunter2');
    const parsed = JSON.parse(summary);
    expect(parsed.kind).toBe('redacted');
    expect(parsed.type).toBe('string');
    expect(parsed.length).toBe('hunter2'.length);
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary).not.toContain('hunter2');
  });

  it('handles number / boolean / null without leaking plaintext shape', () => {
    expect(JSON.parse(redactFillValue(42)).type).toBe('number');
    expect(JSON.parse(redactFillValue(true)).type).toBe('boolean');
    expect(JSON.parse(redactFillValue(null)).type).toBe('null');
  });
});

describe('buildActionFromTool', () => {
  it('builds a click action with target ref and success status', () => {
    const action = buildActionFromTool({
      stepId: 'step-1',
      sessionId: 'sess-1',
      toolName: 'chrome_click_element',
      args: { tabId: 9, ref: 'e-42', selector: '#btn' },
      rawResult: wrap({ message: 'ok', elementInfo: { role: 'button' } }),
      preSnapshotRef: null,
    });
    expect(action).not.toBeNull();
    expect(action!.actionKind).toBe('click');
    expect(action!.tabId).toBe(9);
    expect(action!.targetRef).toBe('e-42');
    expect(action!.targetSelector).toBe('#btn');
    expect(action!.status).toBe('success');
    expect(action!.navigateMode).toBeNull();
    expect(action!.resultBlob).toContain('"message":"ok"');
  });

  it('redacts chrome_fill_or_select value and omits result_blob', () => {
    const action = buildActionFromTool({
      stepId: 'step-1',
      sessionId: 'sess-1',
      toolName: 'chrome_fill_or_select',
      args: { tabId: 9, ref: 'e-1', value: 'hunter2' },
      rawResult: wrap({ message: 'Filled e-1' }),
      preSnapshotRef: null,
    });
    expect(action).not.toBeNull();
    expect(action!.actionKind).toBe('fill');
    expect(action!.resultBlob).toBeNull();
    expect(action!.argsBlob).not.toContain('hunter2');
    expect(action!.argsBlob).toContain('[redacted]');
    const summary = JSON.parse(action!.valueSummary!);
    expect(summary.kind).toBe('redacted');
    expect(summary.length).toBe('hunter2'.length);
  });

  it('classifies navigate modes: url / refresh / back / forward / new_tab', () => {
    const build = (args: Record<string, unknown>) =>
      buildActionFromTool({
        stepId: 'step-1',
        sessionId: 'sess-1',
        toolName: 'chrome_navigate',
        args,
        rawResult: wrap({ finalUrl: 'https://x/' }),
        preSnapshotRef: null,
      });
    expect(build({ url: 'https://x/' })!.navigateMode).toBe('url');
    expect(build({ refresh: true })!.navigateMode).toBe('refresh');
    expect(build({ url: 'back' })!.navigateMode).toBe('back');
    expect(build({ url: 'forward' })!.navigateMode).toBe('forward');
    expect(build({ url: 'https://x/', newWindow: true })!.navigateMode).toBe('new_tab');
  });

  it('records status=failed when isError is true (plain-text error body)', () => {
    const action = buildActionFromTool({
      stepId: 'step-1',
      sessionId: 'sess-1',
      toolName: 'chrome_click_element',
      args: { tabId: 9, ref: 'e-bad' },
      rawResult: wrapPlain('Element not found'),
      preSnapshotRef: null,
    });
    expect(action!.status).toBe('failed');
    expect(action!.errorCode).toBe('tool_error');
    expect(action!.resultBlob).toBe('Element not found');
  });

  it('records status=soft_failure when isError=false but body.success=false', () => {
    const action = buildActionFromTool({
      stepId: 'step-1',
      sessionId: 'sess-1',
      toolName: 'chrome_click_element',
      args: { tabId: 9, ref: 'e-soft' },
      rawResult: wrap({ success: false, message: 'Unsupported page' }),
      preSnapshotRef: null,
    });
    expect(action!.status).toBe('soft_failure');
  });

  it('returns null for tools that are not Phase 0.3 actions', () => {
    const action = buildActionFromTool({
      stepId: 'step-1',
      sessionId: 'sess-1',
      toolName: 'chrome_read_page',
      args: {},
      rawResult: wrap({}),
      preSnapshotRef: null,
    });
    expect(action).toBeNull();
  });
});

describe('ActionService.recordFromToolCall', () => {
  it('persists a row and returns a memory://action historyRef', () => {
    const { service, actionRepo, close } = bootstrap();
    try {
      const rec = service.recordFromToolCall({
        stepId: 'step-1',
        sessionId: 'sess-1',
        toolName: 'chrome_click_element',
        args: { tabId: 9, ref: 'e-1' },
        rawResult: wrap({ message: 'ok' }),
      });
      expect(rec).not.toBeNull();
      expect(rec!.historyRef).toMatch(/^memory:\/\/action\/[0-9a-f-]+$/);
      const stored = actionRepo.get(rec!.actionId);
      expect(stored?.toolName).toBe('chrome_click_element');
    } finally {
      close();
    }
  });

  it('links pre_snapshot_ref when a prior snapshot exists for the tab in the session', () => {
    const { service, snapshotRepo, close } = bootstrap();
    try {
      snapshotRepo.insert({
        snapshotId: 'snap-x',
        stepId: 'step-1',
        tabId: 9,
        url: null,
        title: null,
        pageType: null,
        mode: null,
        pageRole: null,
        primaryRegion: null,
        quality: null,
        taskMode: null,
        complexityLevel: null,
        sourceKind: null,
        fallbackUsed: false,
        interactiveCount: 0,
        candidateActionCount: 0,
        highValueObjectCount: 0,
        summaryBlob: null,
        pageContextBlob: null,
        highValueObjectsBlob: null,
        interactiveElementsBlob: null,
        candidateActionsBlob: null,
        protocolL0Blob: null,
        protocolL1Blob: null,
        protocolL2Blob: null,
        capturedAt: '2026-04-20T00:00:05.000Z',
      });
      const rec = service.recordFromToolCall({
        stepId: 'step-1',
        sessionId: 'sess-1',
        toolName: 'chrome_click_element',
        args: { tabId: 9, ref: 'e-1' },
        rawResult: wrap({ message: 'ok' }),
        nowIso: '2026-04-20T00:00:10.000Z',
      });
      const stored = service.get(rec!.actionId);
      expect(stored?.preSnapshotRef).toBe('memory://snapshot/snap-x');
    } finally {
      close();
    }
  });

  it('returns null and does not throw when DB write fails (e.g. missing step)', () => {
    const { service, close } = bootstrap();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const rec = service.recordFromToolCall({
        stepId: 'does-not-exist',
        sessionId: 'sess-1',
        toolName: 'chrome_click_element',
        args: { tabId: 9, ref: 'e-1' },
        rawResult: wrap({ message: 'ok' }),
      });
      expect(rec).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      close();
    }
  });
});
