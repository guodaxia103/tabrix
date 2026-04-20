import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../execution/session-manager';
import { runPostProcessor, chromeReadPagePostProcessor } from './tool-post-processors';

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
        toolName: 'chrome_click_element',
      });
      const raw = wrap(readPageBody);
      const out = runPostProcessor({
        toolName: 'chrome_click_element',
        rawResult: raw,
        stepId: step.stepId,
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
