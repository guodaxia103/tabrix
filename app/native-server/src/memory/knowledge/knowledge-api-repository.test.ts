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
  scoreEndpointKnowledge,
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

  it('scores endpoint knowledge from existing metadata without a schema migration', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    const search = repo.upsert(
      makeInput({
        endpointSignature: 'GET api.github.com/search/repositories',
        urlPattern: 'api.github.com/search/repositories',
        semanticTag: 'github.search_repositories',
        statusClass: '2xx',
        observedAt: '2026-04-22T12:00:00.000Z',
      }),
    );
    repo.upsert(
      makeInput({
        endpointSignature: 'POST api.github.com/repos/:owner/:repo/issues',
        method: 'POST',
        urlPattern: 'api.github.com/repos/:owner/:repo/issues',
        semanticTag: 'github.issues_list',
        statusClass: '2xx',
        observedAt: '2026-04-22T13:00:00.000Z',
      }),
    );

    const scored = scoreEndpointKnowledge(search);
    expect(scored).toMatchObject({
      semanticType: 'search',
      usableForTask: true,
      fallbackReason: null,
    });
    expect(scored.confidence).toBeGreaterThan(0.7);

    const candidates = repo.listScoredBySite('api.github.com');
    expect(candidates[0].semanticType).toBe('search');
    expect(candidates[0].usableForTask).toBe(true);
    const postCandidate = candidates.find((candidate) => candidate.method === 'POST');
    expect(postCandidate).toMatchObject({
      usableForTask: false,
      fallbackReason: 'non_read_method',
    });
    db.close();
  });

  it('raises sampleCount and lastSeen on repeated observations for candidate ranking', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new KnowledgeApiRepository(db);
    repo.upsert(makeInput({ observedAt: '2026-04-22T10:00:00.000Z' }));
    repo.upsert(makeInput({ observedAt: '2026-04-22T11:00:00.000Z' }));
    repo.upsert(makeInput({ observedAt: '2026-04-22T12:00:00.000Z' }));

    const [candidate] = repo.listScoredBySite('api.github.com');
    expect(candidate.sampleCount).toBe(3);
    expect(candidate.lastSeenAt).toBe('2026-04-22T12:00:00.000Z');
    expect(candidate.confidence).toBeGreaterThan(0.7);
    db.close();
  });

  // ---------------------------------------------------------------
  // V27-08 Endpoint Knowledge v2 lineage tests.
  //
  // What these defend (regression hardening):
  //  - Additive lineage columns persist round-trip through SQLite.
  //  - Legacy rows (rows written with no V27-08 fields) still
  //    deserialise: `endpointSource` is back-derived from `family`,
  //    and `schemaVersion` collapses NULL → 1.
  //  - Re-observing a V27-08-aware row from a V26-FIX-03 capture path
  //    (which does set `endpointSource` for `family='observed'`) does
  //    not silently downgrade lineage to NULL.
  //  - The repository validates the closed enum so a typo in a future
  //    writer cannot poison the table.
  //  - Persisted lineage never includes raw user values — only the
  //    closed-enum breadcrumb defined by `EndpointSourceLineage`.
  // ---------------------------------------------------------------
  describe('V27-08 Endpoint Knowledge v2 lineage', () => {
    it('back-derives endpointSource from family for legacy rows (no v2 fields supplied)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      // Pre-V27-08 input: no `endpointSource`, no `sourceLineage`.
      const githubRow = repo.upsert(makeInput({ family: 'github' }));
      const observedRow = repo.upsert(
        makeInput({
          family: 'observed',
          site: 'en.wikipedia.org',
          urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
          endpointSignature: 'GET en.wikipedia.org/w/rest.php/v1/search/page',
        }),
      );
      const npmRow = repo.upsert(
        makeInput({
          family: 'npmjs',
          site: 'registry.npmjs.org',
          urlPattern: 'registry.npmjs.org/-/v1/search',
          endpointSignature: 'GET registry.npmjs.org/-/v1/search',
        }),
      );
      const otherRow = repo.upsert(
        makeInput({
          family: 'unknown_future_family',
          site: 'unknown.example.com',
          urlPattern: 'unknown.example.com/x',
          endpointSignature: 'GET unknown.example.com/x',
        }),
      );

      expect(githubRow.endpointSource).toBe('seed_adapter');
      expect(observedRow.endpointSource).toBe('observed');
      expect(npmRow.endpointSource).toBe('seed_adapter');
      expect(otherRow.endpointSource).toBe('unknown');

      // Legacy rows (no v2 input fields) report schemaVersion=1.
      expect(githubRow.schemaVersion).toBe(1);
      expect(githubRow.sourceLineage).toBeNull();
      expect(githubRow.correlationConfidence).toBeNull();
      expect(githubRow.correlatedRegionId).toBeNull();
      expect(githubRow.confidenceReason).toBeNull();
      expect(githubRow.retirementCandidate).toBe(false);
      db.close();
    });

    it('persists v2 lineage round-trip and bumps schemaVersion to 2', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const row = repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          correlationConfidence: 'low_confidence',
          correlatedRegionId: 'main_list',
          confidenceReason: 'click_partial_update_low_confidence',
          retirementCandidate: false,
          sourceLineage: {
            semanticSource: 'correlator_v2',
            observationCount: 3,
            correlationReason: 'click_partial_update',
          },
        }),
      );

      expect(row.schemaVersion).toBe(2);
      expect(row.endpointSource).toBe('observed');
      expect(row.correlationConfidence).toBe('low_confidence');
      expect(row.correlatedRegionId).toBe('main_list');
      expect(row.confidenceReason).toBe('click_partial_update_low_confidence');
      expect(row.retirementCandidate).toBe(false);
      expect(row.sourceLineage).toEqual({
        semanticSource: 'correlator_v2',
        observationCount: 3,
        correlationReason: 'click_partial_update',
      });

      // Re-read via findBySignature to confirm SQLite round-trip.
      const fetched = repo.findBySignature(row.site, row.endpointSignature);
      expect(fetched).not.toBeNull();
      expect(fetched!.endpointSource).toBe('observed');
      expect(fetched!.sourceLineage).toEqual({
        semanticSource: 'correlator_v2',
        observationCount: 3,
        correlationReason: 'click_partial_update',
      });
      db.close();
    });

    it('preserves prior v2 lineage on re-observation when the new write omits it', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      // First write: v2-aware (e.g. correlator path).
      const first = repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          correlationConfidence: 'low_confidence',
          correlatedRegionId: 'main_list',
          sourceLineage: {
            semanticSource: 'correlator_v2',
            observationCount: 1,
            correlationReason: 'click_partial_update',
          },
          observedAt: '2026-04-22T10:00:00.000Z',
        }),
      );
      // Second write: legacy (no v2 fields supplied, e.g. an older
      // capture path or a fixture). Sample count must increment but
      // the prior lineage must NOT be reset to NULL.
      const second = repo.upsert(
        makeInput({
          family: 'observed',
          observedAt: '2026-04-22T11:00:00.000Z',
        }),
      );

      expect(second.endpointId).toBe(first.endpointId);
      expect(second.sampleCount).toBe(2);
      expect(second.endpointSource).toBe('observed');
      expect(second.correlationConfidence).toBe('low_confidence');
      expect(second.correlatedRegionId).toBe('main_list');
      expect(second.sourceLineage).toEqual({
        semanticSource: 'correlator_v2',
        observationCount: 1,
        correlationReason: 'click_partial_update',
      });
      expect(second.schemaVersion).toBe(2);
      db.close();
    });

    it('lets a fresh classifier verdict overwrite a stale lineage breadcrumb', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          sourceLineage: {
            semanticSource: 'capture',
            observationCount: 1,
            correlationReason: 'metadata_only',
          },
          observedAt: '2026-04-22T10:00:00.000Z',
        }),
      );
      const updated = repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          correlationConfidence: 'low_confidence',
          correlatedRegionId: 'main_list',
          sourceLineage: {
            semanticSource: 'correlator_v2',
            observationCount: 2,
            correlationReason: 'click_partial_update',
          },
          observedAt: '2026-04-22T11:00:00.000Z',
        }),
      );

      expect(updated.sampleCount).toBe(2);
      expect(updated.sourceLineage).toEqual({
        semanticSource: 'correlator_v2',
        observationCount: 2,
        correlationReason: 'click_partial_update',
      });
      expect(updated.correlationConfidence).toBe('low_confidence');
      db.close();
    });

    it('rejects an invalid endpointSource at the writer (closed-enum guard)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      expect(() =>
        repo.upsert(
          makeInput({
            // Cast through unknown so a future schema change does not silently
            // collapse this assertion. The writer must throw on the literal.
            endpointSource: 'totally_made_up' as unknown as 'observed',
          }),
        ),
      ).toThrow(/invalid endpointSource/);
      db.close();
    });

    it('rejects an invalid correlationConfidence at the writer (closed-enum guard)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      expect(() =>
        repo.upsert(
          makeInput({
            correlationConfidence: 'super_high' as unknown as 'low_confidence',
          }),
        ),
      ).toThrow(/invalid correlationConfidence/);
      db.close();
    });

    // ---------------------------------------------------------------
    // Closeout — Batch B Review Closeout, SoT V3 evidence-contract
    // alignment. Coverage matrix:
    //   - `deprecated_seed` is now an accepted endpointSource value.
    //   - `lastFailureReason` round-trips and is closed-enum guarded.
    //   - `seedAdapterRetirementState` is derived correctly for the
    //     four legal states.
    //   - `upsertWithEvidence` returns the SoT V3 evidence-contract
    //     fields the row alone cannot express
    //     (`confidenceBefore`/`confidenceAfter`/`migrationMode`).
    //   - Pre-closeout DB (no `last_failure_reason` column) does not
    //     migration-crash.
    // ---------------------------------------------------------------
    it('accepts deprecated_seed as a valid endpointSource (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const row = repo.upsert(
        makeInput({
          family: 'github',
          endpointSource: 'deprecated_seed',
        }),
      );
      expect(row.endpointSource).toBe('deprecated_seed');
      expect(row.seedAdapterRetirementState).toBe('deprecated');
      db.close();
    });

    it('derives seedAdapterRetirementState from endpointSource + retirementCandidate (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const active = repo.upsert(
        makeInput({
          family: 'github',
          endpointSource: 'seed_adapter',
          retirementCandidate: false,
          urlPattern: 'api.github.com/active',
          endpointSignature: 'GET api.github.com/active',
        }),
      );
      const flagged = repo.upsert(
        makeInput({
          family: 'github',
          endpointSource: 'seed_adapter',
          retirementCandidate: true,
          urlPattern: 'api.github.com/flagged',
          endpointSignature: 'GET api.github.com/flagged',
        }),
      );
      const observed = repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          urlPattern: 'api.github.com/observed',
          endpointSignature: 'GET api.github.com/observed',
        }),
      );
      const deprecated = repo.upsert(
        makeInput({
          family: 'github',
          endpointSource: 'deprecated_seed',
          urlPattern: 'api.github.com/deprecated',
          endpointSignature: 'GET api.github.com/deprecated',
        }),
      );

      expect(active.seedAdapterRetirementState).toBe('active');
      expect(flagged.seedAdapterRetirementState).toBe('retirement_candidate');
      expect(observed.seedAdapterRetirementState).toBe('not_applicable');
      expect(deprecated.seedAdapterRetirementState).toBe('deprecated');
      db.close();
    });

    it('round-trips lastFailureReason through SQLite (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const row = repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          lastFailureReason: 'shape_drift',
        }),
      );
      expect(row.lastFailureReason).toBe('shape_drift');
      expect(row.schemaVersion).toBe(2);
      const fetched = repo.findBySignature(row.site, row.endpointSignature);
      expect(fetched!.lastFailureReason).toBe('shape_drift');
      db.close();
    });

    it('rejects an invalid lastFailureReason at the writer (closeout closed-enum guard)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      expect(() =>
        repo.upsert(
          makeInput({
            family: 'observed',
            lastFailureReason: 'not_a_known_reason' as unknown as 'timeout',
          }),
        ),
      ).toThrow(/invalid lastFailureReason/);
      db.close();
    });

    it('lastFailureReason is null on legacy rows (no failure evidence on file)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const row = repo.upsert(makeInput({ family: 'github' }));
      expect(row.lastFailureReason).toBeNull();
      db.close();
    });

    it('upsertWithEvidence reports virgin_v2_write for a brand-new V27-08 row (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const { endpoint, evidence } = repo.upsertWithEvidence(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
        }),
      );
      expect(evidence.migrationMode).toBe('virgin_v2_write');
      expect(evidence.confidenceBefore).toBeNull();
      expect(evidence.confidenceAfter).toBeGreaterThan(0);
      expect(evidence.confidenceChanged).toBe(true);
      expect(evidence.endpointSource).toBe('observed');
      expect(evidence.seedAdapterRetirementState).toBe('not_applicable');
      expect(evidence.schemaVersion).toBe(2);
      expect(evidence.lastFailureReason).toBeNull();
      expect(evidence.usableForTask).toBe(true);
      expect(endpoint.endpointSource).toBe('observed');
    });

    it('upsertWithEvidence reports legacy_no_op for a brand-new pre-V27-08 row (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      const { evidence } = repo.upsertWithEvidence(makeInput({ family: 'github' }));
      expect(evidence.migrationMode).toBe('legacy_no_op');
      expect(evidence.schemaVersion).toBe(1);
      expect(evidence.endpointSource).toBe('seed_adapter');
      expect(evidence.confidenceBefore).toBeNull();
      expect(evidence.confidenceAfter).toBeGreaterThan(0);
    });

    it('upsertWithEvidence reports additive_upgrade when a legacy row gains v2 fields (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      repo.upsert(
        makeInput({
          family: 'observed',
          observedAt: '2026-04-22T10:00:00.000Z',
        }),
      );
      const { evidence } = repo.upsertWithEvidence(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          correlationConfidence: 'low_confidence',
          observedAt: '2026-04-22T11:00:00.000Z',
        }),
      );
      expect(evidence.migrationMode).toBe('additive_upgrade');
      expect(evidence.schemaVersion).toBe(2);
      expect(evidence.confidenceBefore).toBeGreaterThan(0);
      expect(evidence.confidenceAfter).toBeGreaterThan(0);
    });

    it('upsertWithEvidence reports v2_refresh when a v2 row is re-observed (closeout)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          correlationConfidence: 'low_confidence',
          observedAt: '2026-04-22T10:00:00.000Z',
        }),
      );
      const { evidence } = repo.upsertWithEvidence(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          observedAt: '2026-04-22T11:00:00.000Z',
        }),
      );
      expect(evidence.migrationMode).toBe('v2_refresh');
      expect(evidence.schemaVersion).toBe(2);
      expect(evidence.confidenceBefore).toBeGreaterThan(0);
      expect(evidence.confidenceAfter).toBeGreaterThan(0);
    });

    it('persisted lineage payload contains only closed-enum fields (no raw values)', () => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const repo = new KnowledgeApiRepository(db);
      repo.upsert(
        makeInput({
          family: 'observed',
          endpointSource: 'observed',
          sourceLineage: {
            semanticSource: 'classifier_v2',
            observationCount: 1,
            correlationReason: null,
          },
        }),
      );
      // Re-read raw DB row to confirm we never serialise anything else
      // into source_lineage_blob (e.g. raw query params, response body).
      const rawRow = db
        .prepare(`SELECT source_lineage_blob FROM knowledge_api_endpoints LIMIT 1`)
        .get() as { source_lineage_blob: string };
      const parsed = JSON.parse(rawRow.source_lineage_blob);
      expect(Object.keys(parsed).sort()).toEqual(
        ['correlationReason', 'observationCount', 'semanticSource'].sort(),
      );
      expect(parsed.semanticSource).toBe('classifier_v2');
      // No URL, query string, header value, etc. should be in the blob.
      expect(rawRow.source_lineage_blob).not.toMatch(/Authorization|Cookie|Bearer|@/);
      db.close();
    });
  });
});
