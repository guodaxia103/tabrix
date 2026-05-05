/**
 * V27-01 — unit + integration tests for the v2.7 lifecycle state
 * machine. Every test feeds typed `LifecycleEventPayload` records;
 * none of them touches the bridge or `chrome.*`.
 */
import { LIFECYCLE_STATES, type LifecycleEventPayload, type LifecycleState } from '@tabrix/shared';
import {
  createLifecycleStateMachine,
  getDefaultLifecycleStateMachine,
} from './lifecycle-state-machine';

function makeEvent(overrides: Partial<LifecycleEventPayload>): LifecycleEventPayload {
  return {
    eventKind: overrides.eventKind ?? 'before_navigate',
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? null,
    navigationIntent: overrides.navigationIntent ?? 'unknown',
    observedAtMs: overrides.observedAtMs ?? 1_700_000_000_000,
  };
}

describe('V27-01 lifecycle state machine — closed-enum invariants', () => {
  it('returns "unknown" snapshot for an unseen tab', () => {
    const m = createLifecycleStateMachine();
    const snap = m.getSnapshot(42);
    expect(snap.lifecycleState).toBe<LifecycleState>('unknown');
    expect(snap.lifecycleFlag).toBe('unknown');
    expect(snap.lifecycleConfidence).toBe(0);
  });

  it("every LifecycleState value (incl. 'unknown') is reachable from a typed event stream", () => {
    const m = createLifecycleStateMachine();
    const reached = new Set<LifecycleState>();
    reached.add(m.getSnapshot(1).lifecycleState);
    reached.add(m.ingest(makeEvent({ tabId: 1, eventKind: 'before_navigate' })).lifecycleState);
    reached.add(m.ingest(makeEvent({ tabId: 1, eventKind: 'committed' })).lifecycleState);
    reached.add(m.ingest(makeEvent({ tabId: 1, eventKind: 'dom_content_loaded' })).lifecycleState);
    reached.add(m.ingest(makeEvent({ tabId: 1, eventKind: 'document_complete' })).lifecycleState);
    reached.add(m.ingest(makeEvent({ tabId: 1, eventKind: 'tab_removed' })).lifecycleState);
    reached.add(
      m.ingest(
        makeEvent({ tabId: 2, eventKind: 'before_navigate', navigationIntent: 'forward_back' }),
      ).lifecycleState,
    );
    expect(reached.has('unknown')).toBe(true);
    expect(reached.has('navigating')).toBe(true);
    expect(reached.has('document_loading')).toBe(true);
    expect(reached.has('document_ready')).toBe(true);
    expect(reached.has('route_stable')).toBe(true);
    expect(reached.has('closed')).toBe(true);
    for (const s of LIFECYCLE_STATES) {
      expect(typeof s).toBe('string');
    }
  });
});

describe('V27-01 lifecycle state machine — cold load', () => {
  it('walks before_navigate -> committed -> DOMContentLoaded -> documentComplete', () => {
    const m = createLifecycleStateMachine();
    const a = m.ingest(
      makeEvent({
        tabId: 7,
        eventKind: 'before_navigate',
        urlPattern: 'github.com/owner/repo',
        navigationIntent: 'user_initiated',
      }),
    );
    expect(a.lifecycleState).toBe('navigating');
    expect(a.lifecycleFlag).toBe('cold_load');
    expect(a.navigationIntent).toBe('user_initiated');
    expect(a.urlPattern).toBe('github.com/owner/repo');
    expect(a.lifecycleConfidence).toBe(0.5);

    const b = m.ingest(makeEvent({ tabId: 7, eventKind: 'committed' }));
    expect(b.lifecycleState).toBe('document_loading');
    expect(b.lifecycleConfidence).toBe(0.7);

    const c = m.ingest(makeEvent({ tabId: 7, eventKind: 'dom_content_loaded' }));
    expect(c.lifecycleState).toBe('document_ready');
    expect(c.lifecycleConfidence).toBe(0.85);

    const d = m.ingest(makeEvent({ tabId: 7, eventKind: 'document_complete' }));
    expect(d.lifecycleState).toBe('route_stable');
    expect(d.lifecycleConfidence).toBe(0.95);
    expect(d.urlPattern).toBe('github.com/owner/repo');
  });
});

describe('V27-01 lifecycle state machine — SPA route change', () => {
  it('does not downgrade route_stable on history_state_updated; flag flips to spa_route_change', () => {
    const m = createLifecycleStateMachine();
    m.ingest(
      makeEvent({ tabId: 9, eventKind: 'before_navigate', navigationIntent: 'user_initiated' }),
    );
    m.ingest(makeEvent({ tabId: 9, eventKind: 'committed' }));
    m.ingest(makeEvent({ tabId: 9, eventKind: 'dom_content_loaded' }));
    m.ingest(makeEvent({ tabId: 9, eventKind: 'document_complete' }));
    const snap = m.ingest(
      makeEvent({
        tabId: 9,
        eventKind: 'history_state_updated',
        urlPattern: 'github.com/owner/repo/issues',
      }),
    );
    expect(snap.lifecycleState).toBe('route_stable');
    expect(snap.lifecycleFlag).toBe('spa_route_change');
    expect(snap.lifecycleConfidence).toBe(0.7);
    expect(snap.urlPattern).toBe('github.com/owner/repo/issues');
  });

  it('promotes "unknown" tab to "document_ready" when only history_state_updated arrives', () => {
    const m = createLifecycleStateMachine();
    const snap = m.ingest(
      makeEvent({
        tabId: 11,
        eventKind: 'history_state_updated',
        urlPattern: 'github.com/explore',
      }),
    );
    expect(snap.lifecycleState).toBe('document_ready');
    expect(snap.lifecycleFlag).toBe('spa_route_change');
    expect(snap.lifecycleConfidence).toBeLessThan(0.85);
  });
});

describe('V27-01 lifecycle state machine — back/forward + close', () => {
  it('flags forward_back navigation', () => {
    const m = createLifecycleStateMachine();
    const snap = m.ingest(
      makeEvent({ tabId: 5, eventKind: 'before_navigate', navigationIntent: 'forward_back' }),
    );
    expect(snap.lifecycleFlag).toBe('back_forward');
    expect(snap.navigationIntent).toBe('forward_back');
  });

  it('handles tab_removed from any state', () => {
    const m = createLifecycleStateMachine();
    m.ingest(makeEvent({ tabId: 13, eventKind: 'before_navigate' }));
    m.ingest(makeEvent({ tabId: 13, eventKind: 'committed' }));
    const snap = m.ingest(makeEvent({ tabId: 13, eventKind: 'tab_removed' }));
    expect(snap.lifecycleState).toBe('closed');
    expect(snap.lifecycleFlag).toBe('tab_closed');
    expect(snap.lifecycleConfidence).toBe(1);
  });
});

describe('V27-01 lifecycle state machine — multi-tab + reset', () => {
  it('keeps per-tab state isolated', () => {
    const m = createLifecycleStateMachine();
    m.ingest(makeEvent({ tabId: 1, eventKind: 'before_navigate' }));
    m.ingest(makeEvent({ tabId: 1, eventKind: 'committed' }));
    m.ingest(makeEvent({ tabId: 2, eventKind: 'before_navigate' }));
    expect(m.getSnapshot(1).lifecycleState).toBe('document_loading');
    expect(m.getSnapshot(2).lifecycleState).toBe('navigating');
  });

  it('reset() drops every tab record', () => {
    const m = createLifecycleStateMachine();
    m.ingest(makeEvent({ tabId: 1, eventKind: 'before_navigate' }));
    m.reset();
    expect(m.getSnapshot(1).lifecycleState).toBe('unknown');
  });

  it('default singleton is sticky across getDefaultLifecycleStateMachine() calls', () => {
    const a = getDefaultLifecycleStateMachine();
    a.reset();
    a.ingest(makeEvent({ tabId: 99, eventKind: 'before_navigate' }));
    const b = getDefaultLifecycleStateMachine();
    expect(b.getSnapshot(99).lifecycleState).toBe('navigating');
    a.reset();
  });
});
