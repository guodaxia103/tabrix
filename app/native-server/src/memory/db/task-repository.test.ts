import { openMemoryDb } from './client';
import { TaskRepository } from './task-repository';
import type { Task } from '../../execution/types';

function freshRepo(): { repo: TaskRepository; close: () => void } {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  const repo = new TaskRepository(db);
  return { repo, close: () => db.close() };
}

function fixture(overrides: Partial<Task> = {}): Task {
  return {
    taskId: overrides.taskId ?? 'task-1',
    taskType: 'browser-action',
    title: 'Acme task',
    intent: 'Exercise persistence',
    origin: 'jest',
    owner: undefined,
    projectId: undefined,
    labels: ['smoke'],
    status: 'pending',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('TaskRepository', () => {
  it('round-trips inserted tasks with labels and optional fields', () => {
    const { repo, close } = freshRepo();
    try {
      const task = fixture({
        taskId: 'task-abc',
        owner: 'alice',
        projectId: 'proj-1',
        labels: ['a', 'b', 'c'],
      });
      repo.insert(task);
      expect(repo.get('task-abc')).toEqual(task);
    } finally {
      close();
    }
  });

  it('returns undefined for unknown ids', () => {
    const { repo, close } = freshRepo();
    try {
      expect(repo.get('missing')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('updates status and updatedAt in place', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture());
      repo.updateStatus('task-1', 'running', '2026-04-20T00:00:05.000Z');
      const updated = repo.get('task-1');
      expect(updated?.status).toBe('running');
      expect(updated?.updatedAt).toBe('2026-04-20T00:00:05.000Z');
      expect(updated?.createdAt).toBe('2026-04-20T00:00:00.000Z');
    } finally {
      close();
    }
  });

  it('lists tasks ordered by creation timestamp', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture({ taskId: 't2', createdAt: '2026-04-20T00:00:02.000Z' }));
      repo.insert(fixture({ taskId: 't1', createdAt: '2026-04-20T00:00:01.000Z' }));
      repo.insert(fixture({ taskId: 't3', createdAt: '2026-04-20T00:00:03.000Z' }));
      expect(repo.list().map((t) => t.taskId)).toEqual(['t1', 't2', 't3']);
    } finally {
      close();
    }
  });

  it('clear() removes all rows', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture({ taskId: 't1' }));
      repo.insert(fixture({ taskId: 't2' }));
      repo.clear();
      expect(repo.list()).toEqual([]);
    } finally {
      close();
    }
  });

  it('handles empty labels correctly', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture({ labels: [] }));
      expect(repo.get('task-1')?.labels).toEqual([]);
    } finally {
      close();
    }
  });
});

describe('TaskRepository.get (integration · B-004 closure)', () => {
  it('returns undefined on a virgin DB', () => {
    const { repo, close } = freshRepo();
    try {
      expect(repo.get('task-1')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('fetches by exact task id without leaking adjacent rows', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture({ taskId: 'task-1', title: 'one', labels: ['one'] }));
      repo.insert(fixture({ taskId: 'task-10', title: 'ten', labels: ['ten'] }));

      expect(repo.get('task-1')).toMatchObject({
        taskId: 'task-1',
        title: 'one',
        labels: ['one'],
      });
      expect(repo.get('task')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('returns fresh read models so caller mutation cannot change stored rows', () => {
    const { repo, close } = freshRepo();
    try {
      repo.insert(fixture({ taskId: 'task-readonly', labels: ['stable'] }));

      const fetched = repo.get('task-readonly');
      expect(fetched).toBeDefined();
      fetched!.labels.push('mutated-by-caller');
      fetched!.status = 'failed';

      expect(repo.get('task-readonly')).toMatchObject({
        taskId: 'task-readonly',
        labels: ['stable'],
        status: 'pending',
      });
    } finally {
      close();
    }
  });
});
