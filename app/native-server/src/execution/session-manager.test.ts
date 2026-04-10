import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  it('creates tasks and tracks a basic execution lifecycle', () => {
    const manager = new SessionManager();
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
  });
});
