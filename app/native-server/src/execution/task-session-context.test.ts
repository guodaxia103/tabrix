/**
 * V26-05 (B-028) — TaskSessionContext unit tests.
 *
 * Covers the read-budget gate, layer suggestion, URL/pageRole
 * invalidation, env override, and defensive parsing — see
 * `docs/PRODUCT_BACKLOG.md` B-028 acceptance criteria.
 */

import {
  DEFAULT_READ_BUDGET_PER_TASK,
  TaskSessionContext,
  resolveReadBudgetFromEnv,
} from './task-session-context';

describe('resolveReadBudgetFromEnv', () => {
  it('returns the default when the env key is unset', () => {
    expect(resolveReadBudgetFromEnv({})).toBe(DEFAULT_READ_BUDGET_PER_TASK);
  });

  it('respects positive integer overrides', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '10' })).toBe(10);
  });

  it('caps absurd values at the hard cap (100)', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '5000' })).toBe(100);
  });

  it('falls back to the default for non-positive / non-integer / NaN inputs', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '0' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '-3' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '3.5' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: 'banana' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '   ' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
  });
});

describe('TaskSessionContext — first read on a virgin task', () => {
  it('allows the first read and suggests L0+L1 regardless of requestedLayer', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    // V4.1 §0.1 hard rule — first read must START at L0+L1, never
    // straight at L0+L1+L2 even if the caller asked for it.
    expect(decision.suggestedLayer).toBe('L0+L1');
    expect(decision.readPageCount).toBe(0);
    expect(decision.readBudget).toBe(6);
  });

  it('keeps suggestedLayer=L0+L1 even when caller requests bare L0', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0' });
    expect(decision.allowed).toBe(true);
    expect(decision.suggestedLayer).toBe('L0+L1');
  });
});

describe('TaskSessionContext — budget enforcement', () => {
  it('denies the read once readPageCount reaches readBudget', () => {
    const ctx = new TaskSessionContext({ readBudget: 2 });
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('read_budget_exceeded');
    expect(decision.readPageCount).toBe(2);
    expect(decision.readBudget).toBe(2);
  });

  it('failed reads (those that never call noteReadPage) do not consume budget', () => {
    const ctx = new TaskSessionContext({ readBudget: 2 });
    // Caller asked but the bridge said "no" — never invoked
    // noteReadPage. Budget must stay at 0.
    ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(true);
    expect(decision.readPageCount).toBe(0);
  });

  it('respects an explicit readBudget option override', () => {
    const ctx = new TaskSessionContext({ readBudget: 1 });
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    expect(ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' }).allowed).toBe(false);
  });

  it('throws on a non-positive explicit budget (programmer error)', () => {
    expect(() => new TaskSessionContext({ readBudget: 0 })).toThrow(/positive integer/);
    expect(() => new TaskSessionContext({ readBudget: -1 })).toThrow(/positive integer/);
    expect(() => new TaskSessionContext({ readBudget: 1.5 })).toThrow(/positive integer/);
  });

  it('caps explicit budget overrides at the hard cap (100)', () => {
    const ctx = new TaskSessionContext({ readBudget: 9999 });
    expect(ctx.readBudget).toBe(100);
  });

  it('reads the env override when no explicit budget is supplied', () => {
    const ctx = new TaskSessionContext({ env: { TABRIX_READ_BUDGET_PER_TASK: '4' } });
    expect(ctx.readBudget).toBe(4);
  });
});

describe('TaskSessionContext — redundancy + layer demotion', () => {
  it('flags a same-layer same-page repeat as read_redundant (still allowed)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello/issues', 'github_issues_list');
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('read_redundant');
    expect(decision.suggestedLayer).toBe('L0+L1');
  });

  it('flags L0+L1+L2 → L0+L1 as layer_demotion (still allowed)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello/issues', 'github_issues_list');
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('layer_demotion');
  });

  it('escalation L0+L1 → L0+L1+L2 is allowed without flag', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello', null);
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
  });
});

describe('TaskSessionContext — URL / pageRole invalidation', () => {
  it('URL change resets lastReadLayer + targetRefsSeen so a follow-up read is "first" again', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a.example/x', 'role_a');
    ctx.noteReadPage({
      layer: 'L0+L1+L2',
      source: 'dom_json',
      targetRefs: ['tgt_aaaa1111aa'],
    });
    expect(ctx.targetRefsSeen.has('tgt_aaaa1111aa')).toBe(true);
    ctx.noteUrlChange('https://b.example/y', 'role_a');
    expect(ctx.lastReadLayer).toBeNull();
    expect(ctx.targetRefsSeen.size).toBe(0);
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    expect(decision.suggestedLayer).toBe('L0+L1');
  });

  it('pageRole change on the same URL also invalidates lastReadLayer', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example/dashboard', 'role_one');
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    ctx.noteUrlChange('https://example/dashboard', 'role_two');
    expect(ctx.lastReadLayer).toBeNull();
  });

  it('idempotent same-URL same-pageRole call is a no-op', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example/x', 'role_a');
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    ctx.noteUrlChange('https://example/x', 'role_a');
    expect(ctx.lastReadLayer).toBe('L0+L1');
  });

  it('apiEndpointFamiliesSeen survives URL changes (Knowledge is URL-agnostic)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a/x', 'role_a');
    ctx.noteReadPage({
      layer: 'L0+L1',
      source: 'knowledge_api',
      apiFamilies: ['github_issues'],
    });
    ctx.noteUrlChange('https://b/y', 'role_b');
    expect(ctx.apiEndpointFamiliesSeen.has('github_issues')).toBe(true);
  });

  it('coerces empty / whitespace URLs and pageRoles to null', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('', '');
    expect(ctx.currentUrl).toBeNull();
    expect(ctx.pageRole).toBeNull();
  });
});

describe('TaskSessionContext — noteReadPage hygiene', () => {
  it('accumulates targetRefs and rejects empty/non-string entries defensively', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteReadPage({
      layer: 'L0+L1',
      source: 'dom_json',
      targetRefs: ['tgt_one', '', 'tgt_two', null as unknown as string, 'tgt_one'],
    });
    expect(Array.from(ctx.targetRefsSeen).sort()).toEqual(['tgt_one', 'tgt_two']);
  });

  it('handles null/undefined ref + family arrays without throwing', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    expect(() =>
      ctx.noteReadPage({ layer: 'L0', source: 'dom_json', targetRefs: null, apiFamilies: null }),
    ).not.toThrow();
    expect(ctx.readPageCount).toBe(1);
  });
});
