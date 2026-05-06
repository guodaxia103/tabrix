/**
 * Stable targetRef to per-snapshot ref registry.
 *
 * Why this exists:
 *   - HVO `targetRef` is a stable identity that survives reloads.
 *   - The actual click bridge still talks to the content-script accessibility
 *     tree via per-snapshot `ref_*` handles.
 *   - Without this registry, the click bridge would have no way to translate
 *     a stable `tgt_*` back into the live `ref_*` of the most recent snapshot
 *     for the same tab.
 *
 * Design choices (intentionally tiny; this is not a generic UI-state store):
 *   - In-memory Map keyed by tabId. No persistence: if the service worker is
 *     evicted, lookups return `undefined` and the click bridge fails closed
 *     with a clear "re-read the page" message — which is the safe behavior.
 *   - Each `record(tabId, …)` call replaces the entire snapshot for that tab,
 *     because a fresh `read_page` invalidates whatever ref handles existed
 *     before.
 *   - `clearTab(tabId)` is exposed so background lifecycle hooks can drop
 *     entries when a tab closes (caller responsibility).
 */

export interface StableTargetRefEntry {
  targetRef: string;
  ref: string;
}

export interface StableTargetRefRegistrySnapshot {
  /** Tabs currently tracked (for diagnostics / tests). */
  tabIds: number[];
  /** Per-tab entry counts (for diagnostics / tests). */
  entryCounts: Record<number, number>;
}

/**
 * Pure interface so the click bridge can depend on a thin contract instead
 * of importing the singleton directly. Makes unit-testing the bridge trivial.
 */
export interface StableTargetRefLookup {
  lookup(tabId: number, targetRef: string): string | undefined;
}

class StableTargetRefRegistry implements StableTargetRefLookup {
  private byTab = new Map<number, Map<string, string>>();

  record(tabId: number | undefined | null, entries: readonly StableTargetRefEntry[]): void {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      this.byTab.delete(tabId);
      return;
    }
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!entry || typeof entry.targetRef !== 'string' || typeof entry.ref !== 'string') continue;
      if (!entry.targetRef || !entry.ref) continue;
      // First write wins so the highest-ranked HVO for a given identity tuple
      // (which `read-page-task-protocol` placed first) is the one a click
      // resolves to. Visual duplicates with different ordinals already get
      // distinct targetRefs and so do not collide here.
      if (!map.has(entry.targetRef)) {
        map.set(entry.targetRef, entry.ref);
      }
    }
    if (map.size === 0) {
      this.byTab.delete(tabId);
      return;
    }
    this.byTab.set(tabId, map);
  }

  lookup(tabId: number | undefined | null, targetRef: string): string | undefined {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return undefined;
    if (typeof targetRef !== 'string' || !targetRef) return undefined;
    const map = this.byTab.get(tabId);
    if (!map) return undefined;
    return map.get(targetRef);
  }

  clearTab(tabId: number | undefined | null): void {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
    this.byTab.delete(tabId);
  }

  /** For diagnostics + unit tests; not part of the production hot path. */
  snapshot(): StableTargetRefRegistrySnapshot {
    const tabIds: number[] = [];
    const entryCounts: Record<number, number> = {};
    for (const [tabId, map] of this.byTab.entries()) {
      tabIds.push(tabId);
      entryCounts[tabId] = map.size;
    }
    tabIds.sort((a, b) => a - b);
    return { tabIds, entryCounts };
  }

  /** Test-only: drop everything. Not exported on the singleton path. */
  __resetForTests(): void {
    this.byTab.clear();
  }
}

const singleton = new StableTargetRefRegistry();

export function recordStableTargetRefSnapshot(
  tabId: number | undefined | null,
  entries: readonly StableTargetRefEntry[],
): void {
  singleton.record(tabId, entries);
}

export function lookupStableTargetRef(
  tabId: number | undefined | null,
  targetRef: string,
): string | undefined {
  return singleton.lookup(tabId, targetRef);
}

export function clearStableTargetRefTab(tabId: number | undefined | null): void {
  singleton.clearTab(tabId);
}

export function getStableTargetRefRegistrySnapshot(): StableTargetRefRegistrySnapshot {
  return singleton.snapshot();
}

/** Test-only export. Not part of the public surface. */
export function __resetStableTargetRefRegistryForTests(): void {
  singleton.__resetForTests();
}
