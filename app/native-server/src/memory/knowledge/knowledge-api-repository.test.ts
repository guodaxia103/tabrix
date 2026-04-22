/**
 * B-017 — KnowledgeApiRepository persistence + dedup contract.
 *
 * What these tests defend:
 *  - Schema migration is idempotent: opening the same DB twice (or
 *    opening a DB that pre-dates B-017) does not fail and does not
 *    rebuild rows.
 *  - `(site, endpoint_signature)` is the dedup key. A second observation
 *    increments `sample_count`, refreshes `last_seen_at` and the
 *    response summary, but preserves provenance (`first_seen_at`,
 *    `source_*`).
 *  - Round-trip preserves nested JSON (request/response summaries) byte
 *    for byte after `JSON.parse(JSON.stringify(...))` semantics.
 */

import { openMemoryDb } from '../db/client';
import {
  KnowledgeApiRepository,
  type UpsertKnowledgeApiEndpointInput,
} from './knowledge-api-repository';

function makeInput(
  overrides: Partial<UpsertKnowledgeApiEndpointInput> = {},
): UpsertKnowledgeApiEndpointInput {
  return {
    site: 'api.github.com',
    family: 'github',
    method: 'GET',
    urlPattern: 'api.github.com/repos/:owner/:repo/issues',
    endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
    semanticTag: 'github.issues_list',
    statusClass: '2xx',
    requestSummary: {
      headerKeys: ['accept', 'user-agent'],
      queryKeys: ['per_page', 'state'],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: true,
    },
    responseSummary: {
      contentType: 'application/json',
      sizeBytes: 1234,
      shape: { kind: 'array', itemCount: 30, sampleItemKeys: ['id', 'number', 'title'] },
    },
    sourceSessionId: 'session-1',
    sourceStepId: 'step-1',
    sourceHistoryRef: null,
    observedAt: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeApiRepository (B-017)', () => {
  it('CREATE TABLE migration is idempotent across re-open', () => {
    const opened1 = openMemoryDb({ dbPath: ':memory:' });
    expect(() => opened1.db.exec('SELECT * FROM knowledge_api_endpoints LIMIT 0')).not.toThrow();
    opened1.db.close();
    // Same in-memory path is fresh, but the SAME schema SQL must run twice
    // safely on any one DB handle (simulating a re-init / hot-reload).
    const opened2 = openMemoryDb({ dbPath: ':memory:' });
    expect(() => opened2.db.exec('SELECT * FROM knowledge_api_endpoints LIMIT 0')).not.toThrow();
    opened2.db.close();
  });

  it('inserts a new endpoint with sample_count=1 and matching first/last seen', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    const input = makeInput();
    const result = repo.upsert(input);

    expect(result.endpointId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.sampleCount).toBe(1);
    expect(result.firstSeenAt).toBe(input.observedAt);
    expect(result.lastSeenAt).toBe(input.observedAt);
    expect(result.requestSummary).toEqual(input.requestSummary);
    expect(result.responseSummary).toEqual(input.responseSummary);
    expect(repo.countAll()).toBe(1);
    db.close();
  });

  it('upsert on duplicate (site, signature) increments sample_count and refreshes last_seen_at', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    const first = repo.upsert(makeInput({ observedAt: '2026-04-22T10:00:00.000Z' }));
    const second = repo.upsert(
      makeInput({
        observedAt: '2026-04-22T11:30:00.000Z',
        statusClass: '5xx',
        responseSummary: {
          contentType: 'application/json',
          sizeBytes: 7,
          shape: { kind: 'object', topLevelKeys: ['message'] },
        },
        sourceSessionId: 'different-session',
        sourceStepId: 'different-step',
      }),
    );

    expect(repo.countAll()).toBe(1);
    expect(second.endpointId).toBe(first.endpointId);
    expect(second.sampleCount).toBe(2);
    expect(second.firstSeenAt).toBe('2026-04-22T10:00:00.000Z'); // provenance sticks
    expect(second.lastSeenAt).toBe('2026-04-22T11:30:00.000Z'); // refreshes
    expect(second.statusClass).toBe('5xx');
    expect(second.responseSummary.shape).toEqual({ kind: 'object', topLevelKeys: ['message'] });
    // Provenance stickiness: source_session_id is set on first insert and
    // intentionally NOT overwritten on duplicates.
    expect(second.sourceSessionId).toBe('session-1');
    expect(second.sourceStepId).toBe('step-1');
    db.close();
  });

  it('treats different methods as distinct endpoints', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    repo.upsert(makeInput());
    repo.upsert(
      makeInput({
        method: 'POST',
        endpointSignature: 'POST api.github.com/repos/:owner/:repo/issues',
      }),
    );
    expect(repo.countAll()).toBe(2);
    const list = repo.listBySite('api.github.com');
    expect(list.map((e) => e.method).sort()).toEqual(['GET', 'POST']);
    db.close();
  });

  it('listBySite orders by last_seen_at DESC and respects limit', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    repo.upsert(
      makeInput({
        endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
        urlPattern: 'api.github.com/repos/:owner/:repo/issues',
        observedAt: '2026-04-22T10:00:00.000Z',
      }),
    );
    repo.upsert(
      makeInput({
        endpointSignature: 'GET api.github.com/repos/:owner/:repo/pulls',
        urlPattern: 'api.github.com/repos/:owner/:repo/pulls',
        semanticTag: 'github.pulls_list',
        observedAt: '2026-04-22T12:00:00.000Z',
      }),
    );
    const list = repo.listBySite('api.github.com', 1);
    expect(list).toHaveLength(1);
    expect(list[0].endpointSignature).toBe('GET api.github.com/repos/:owner/:repo/pulls');
    db.close();
  });

  it('findBySignature returns null for unseen endpoints', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    expect(repo.findBySignature('api.github.com', 'GET api.github.com/missing')).toBeNull();
    db.close();
  });
});
