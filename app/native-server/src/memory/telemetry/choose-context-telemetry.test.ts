/**
 * V23-04 / B-018 v1.5 — `ChooseContextTelemetryRepository` unit tests.
 *
 * Uses a real in-memory SQLite handle so the assertions exercise the
 * actual schema (`tabrix_choose_context_decisions` /
 * `tabrix_choose_context_outcomes`) — this is the fastest signal that
 * the DDL in `memory/db/schema.ts` and the repo SQL stay in sync.
 */

import { openMemoryDb } from '../db/client';
import {
  ChooseContextTelemetryRepository,
  type RecordChooseContextDecisionInput,
  type RecordChooseContextOutcomeInput,
} from './choose-context-telemetry';

interface Harness {
  repo: ChooseContextTelemetryRepository;
  close: () => void;
}

function fresh(): Harness {
  const opened = openMemoryDb({ dbPath: ':memory:' });
  return {
    repo: new ChooseContextTelemetryRepository(opened.db),
    close: () => opened.db.close(),
  };
}

function decision(
  overrides: Partial<RecordChooseContextDecisionInput> = {},
): RecordChooseContextDecisionInput {
  return {
    decisionId: 'dc-1',
    intentSignature: 'open issues',
    pageRole: 'repo_home',
    siteFamily: 'github',
    strategy: 'experience_reuse',
    fallbackStrategy: 'read_page_required',
    createdAt: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

function outcome(
  overrides: Partial<RecordChooseContextOutcomeInput> = {},
): RecordChooseContextOutcomeInput {
  return {
    decisionId: 'dc-1',
    outcome: 'reuse',
    recordedAt: '2026-04-22T11:00:00.000Z',
    ...overrides,
  };
}

describe('ChooseContextTelemetryRepository', () => {
  it('appends a decision row and reads it back', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-1' }));
      const row = repo.findDecision('dc-1');
      expect(row).toEqual({
        decisionId: 'dc-1',
        intentSignature: 'open issues',
        pageRole: 'repo_home',
        siteFamily: 'github',
        strategy: 'experience_reuse',
        fallbackStrategy: 'read_page_required',
        createdAt: '2026-04-22T10:00:00.000Z',
      });
    } finally {
      close();
    }
  });

  it('rejects duplicate decisionId (PK collision)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-dup' }));
      expect(() => repo.recordDecision(decision({ decisionId: 'dc-dup' }))).toThrow();
    } finally {
      close();
    }
  });

  it('preserves null pageRole / siteFamily / fallbackStrategy', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-null',
          pageRole: null,
          siteFamily: null,
          strategy: 'read_page_required',
          fallbackStrategy: null,
        }),
      );
      const row = repo.findDecision('dc-null');
      expect(row).toMatchObject({
        decisionId: 'dc-null',
        pageRole: null,
        siteFamily: null,
        strategy: 'read_page_required',
        fallbackStrategy: null,
      });
    } finally {
      close();
    }
  });

  it('returns unknown_decision when outcome targets a missing decisionId', () => {
    const { repo, close } = fresh();
    try {
      const result = repo.recordOutcome(outcome({ decisionId: 'dc-missing' }));
      expect(result).toEqual({ status: 'unknown_decision' });
    } finally {
      close();
    }
  });

  it('appends an outcome row when the decisionId exists', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-2' }));
      const result = repo.recordOutcome(outcome({ decisionId: 'dc-2', outcome: 'reuse' }));
      expect(result.status).toBe('ok');
      const aggregates = repo.aggregateStrategies();
      const exp = aggregates.find((a) => a.strategy === 'experience_reuse');
      expect(exp).toBeDefined();
      expect(exp!.decisions).toBe(1);
      expect(exp!.outcomes.reuse).toBe(1);
    } finally {
      close();
    }
  });

  it('aggregates multiple outcomes per decision (e.g. retried then completed)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-3', strategy: 'read_page_markdown' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-3', outcome: 'retried' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-3', outcome: 'completed' }));
      const aggregates = repo.aggregateStrategies();
      const md = aggregates.find((a) => a.strategy === 'read_page_markdown');
      expect(md!.decisions).toBe(1);
      expect(md!.outcomes.retried).toBe(1);
      expect(md!.outcomes.completed).toBe(1);
      expect(md!.outcomes.reuse).toBe(0);
    } finally {
      close();
    }
  });

  it('respects the optional `since` filter on aggregateStrategies', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-old',
          strategy: 'experience_reuse',
          createdAt: '2026-04-01T00:00:00.000Z',
        }),
      );
      repo.recordDecision(
        decision({
          decisionId: 'dc-new',
          strategy: 'knowledge_light',
          createdAt: '2026-04-22T00:00:00.000Z',
        }),
      );
      const recent = repo.aggregateStrategies('2026-04-15T00:00:00.000Z');
      const strategies = recent.map((a) => a.strategy).sort();
      expect(strategies).toEqual(['knowledge_light']);
    } finally {
      close();
    }
  });

  it('clear() empties both tables (test convenience)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-c' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-c' }));
      repo.clear();
      expect(repo.findDecision('dc-c')).toBeNull();
      expect(repo.aggregateStrategies()).toEqual([]);
    } finally {
      close();
    }
  });
});
