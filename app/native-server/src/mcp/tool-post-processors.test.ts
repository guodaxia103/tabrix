import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../execution/session-manager';
import {
  runPostProcessor,
  chromeReadPagePostProcessor,
  chromeActionPostProcessor,
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
