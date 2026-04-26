import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  it('creates tasks and tracks a basic execution lifecycle', () => {
    const manager = new SessionManager();
    try {
      const task = manager.createTask({
        taskType: 'browser-action',
        title: 'Smoke browser action',
        intent: 'Verify execution primitives',
        origin: 'test',
        labels: ['smoke'],
      });

      expect(task.status).toBe('pending');
      expect(manager.listTasks()).toHaveLength(1);

      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'streamable-http',
        clientName: 'jest',
      });

      expect(session.status).toBe('running');
      expect(manager.getTask(task.taskId).status).toBe('running');

      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
        inputSummary: 'Read active page',
      });

      expect(step.index).toBe(1);
      expect(manager.getSession(session.sessionId).steps).toHaveLength(1);

      manager.completeStep(session.sessionId, step.stepId, {
        resultSummary: 'Page read succeeded',
        artifactRefs: ['artifact://page-text'],
      });

      const completedSession = manager.finishSession(session.sessionId, {
        status: 'completed',
        summary: 'Smoke execution completed successfully',
      });

      expect(completedSession.status).toBe('completed');
      expect(completedSession.steps[0].status).toBe('completed');
      expect(completedSession.steps[0].artifactRefs).toEqual(['artifact://page-text']);
      expect(manager.getTask(task.taskId).status).toBe('completed');
    } finally {
      manager.close();
    }
  });

  it('persistence round-trip: second manager on same DB file sees prior state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-'));
    const dbPath = join(dir, 'memory.db');
    try {
      const writer = new SessionManager({ dbPath });
      const task = writer.createTask({
        taskType: 'browser-action',
        title: 't1',
        intent: 'persist test',
        origin: 'jest',
      });
      const session = writer.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = writer.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_click_element',
        inputSummary: 'click nav',
      });
      writer.completeStep(session.sessionId, step.stepId, {
        resultSummary: 'clicked',
        artifactRefs: ['artifact://screenshot-1'],
      });
      writer.finishSession(session.sessionId, { status: 'completed', summary: 'ok' });
      writer.close();

      const reader = new SessionManager({ dbPath });
      try {
        expect(reader.getPersistenceStatus().mode).toBe('disk');
        expect(reader.listTasks()).toHaveLength(1);
        expect(reader.getTask(task.taskId).status).toBe('completed');
        const restored = reader.getSession(session.sessionId);
        expect(restored.status).toBe('completed');
        expect(restored.summary).toBe('ok');
        expect(restored.steps).toHaveLength(1);
        expect(restored.steps[0].resultSummary).toBe('clicked');
        expect(restored.steps[0].artifactRefs).toEqual(['artifact://screenshot-1']);
      } finally {
        reader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a fail-open operation log when a step completes', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'browser-action',
        title: 'operation log task',
        intent: 'read list',
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

      manager.completeStep(session.sessionId, step.stepId, {
        operationLog: {
          requestedLayer: 'L0+L1',
          selectedDataSource: 'api_rows',
          sourceRoute: 'knowledge_supported_read',
          tokensSaved: 128,
        },
      });

      const logs = manager.operationLogs?.listBySession(session.sessionId);
      expect(logs).toHaveLength(1);
      expect(logs?.[0]).toEqual(
        expect.objectContaining({
          taskId: task.taskId,
          stepId: step.stepId,
          toolName: 'chrome_read_page',
          success: true,
          selectedDataSource: 'api_rows',
          sourceRoute: 'knowledge_supported_read',
          tokensSaved: 128,
        }),
      );
    } finally {
      manager.close();
    }
  });

  it('does not fail the tool lifecycle when operation-log persistence throws', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'browser-action',
        title: 'operation log fail open task',
        intent: 'click',
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
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const repo = manager.operationLogs as unknown as { insert: () => never };
        repo.insert = () => {
          throw new Error('simulated operation-log failure');
        };

        expect(() => manager.completeStep(session.sessionId, step.stepId)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('[tabrix/operation-log] write failed:'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    } finally {
      manager.close();
    }
  });

  it('reset() clears persisted state as well as in-memory caches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-reset-'));
    const dbPath = join(dir, 'memory.db');
    try {
      const mgr = new SessionManager({ dbPath });
      const task = mgr.createTask({
        taskType: 't',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      mgr.startSession({ taskId: task.taskId, transport: 'stdio', clientName: 'jest' });
      mgr.reset();
      mgr.close();

      const restored = new SessionManager({ dbPath });
      try {
        expect(restored.listTasks()).toEqual([]);
        expect(restored.listSessions()).toEqual([]);
      } finally {
        restored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persistenceEnabled=false keeps sessions in memory only', () => {
    const mgr = new SessionManager({ persistenceEnabled: false });
    try {
      expect(mgr.getPersistenceStatus()).toEqual({ mode: 'off', enabled: false });
      const task = mgr.createTask({ taskType: 't', title: 't', intent: 'i', origin: 'jest' });
      expect(mgr.getTask(task.taskId)).toBeDefined();
    } finally {
      mgr.close();
    }
  });

  it('default in-memory DB under test env yields persistenceMode=memory', () => {
    const mgr = new SessionManager();
    try {
      expect(mgr.getPersistenceStatus().mode).toBe('memory');
      expect(mgr.getPersistenceStatus().enabled).toBe(true);
    } finally {
      mgr.close();
    }
  });
});
