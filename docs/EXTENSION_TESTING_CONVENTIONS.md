# Extension testing conventions

Single-source reference for how extension (sidepanel / popup / background) unit tests mock the shaky parts of the Chrome environment in Vitest. Grew out of the real footguns hit during Sprint 1 (B-002 / B-003) and Sprint 2 (B-005 / B-006); each section below is linked to the commit that first ran into the issue so you can diff it.

> Applies to `app/chrome-extension/tests/**` under Vitest. Does **not** apply to the Jest-based `app/native-server` test suite — its conventions are documented inline in `app/native-server/src/memory/**/*.test.ts`.

## 1. `fetch` + `AbortController`: always reject on abort

The composable under test (for example `useMemoryTimeline`) wires a new `AbortController` per in-flight request, aborts the previous one on re-entry, and counts on the global `fetch` to reject with an `AbortError` when the signal fires. If the mocked `fetch` just leaves the promise pending, the test hangs and times out. The fix is to mirror the real browser contract inside the mock.

```ts
import { afterEach, beforeEach, vi } from 'vitest';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Per-test: make fetch reject when the signal aborts.
fetchMock.mockImplementationOnce(
  (_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }),
);
```

**Why not `vi.fn().mockRejectedValue(new Error('AbortError'))`?** Because that rejects immediately, before the production code has a chance to bind its abort listener. The test then no longer exercises the abort path — it just tests that a rejected promise propagates.

Original bug: `tests/use-memory-timeline.test.ts — aborts an in-flight request when a new load is kicked off` (fixed in B-003).

## 2. `chrome.storage.local.get`: callback-style only, even when polyfills return promises

Chrome's real Manifest V3 `chrome.storage.local.get(keys, callback)` is callback-style. Some polyfills (e.g. webextension-polyfill) wrap it to return a promise as well. Test-side, we always use the callback shape because it is the lowest common denominator and it is what the extension code defensively supports via an `isThenable` runtime check.

```ts
beforeEach(() => {
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
    _keys: unknown,
    cb: (items: Record<string, unknown>) => void,
  ) => {
    cb({ nativeServerPort: 12306 });
  }) as never);
});
```

Two rules:

1. Never return a promise **and** invoke the callback — the consumer will double-read.
2. `as never` on the implementation is intentional: Chrome's type definitions are overloaded and TypeScript can't narrow them in the mock; the runtime behaviour is what matters.

Original bug: `tests/memory-api-client.test.ts` / `TS1345` on `isThenable` (B-002).

## 3. The Memory API envelope shape: `{ status: 'ok', data: {...} }`

The native-server's `/memory/*` routes (see `app/native-server/src/server/memory-routes.ts`) wrap successful responses in an envelope whose discriminator is `status: 'ok'`, **not** `ok: true`. The client strictly validates this shape and rejects anything else as `MemoryApiError({ kind: 'shape' })`.

```ts
function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

fetchMock.mockResolvedValueOnce(
  okJson({
    status: 'ok',
    data: {
      sessions: [
        /* MemorySessionSummary[] */
      ],
      total: 42,
      offset: 0,
      limit: 20,
      persistenceMode: 'disk',
    },
  }),
);
```

If your composable test asserts "no sessions loaded" and the real code path does populate them, double-check this envelope. This trap ate ~5 minutes during B-006 (`tests/memory-filter.test.ts`).

## 4. Vitest `vi.mock` vs `vi.spyOn`: pick the smaller hammer

- `vi.spyOn(object, 'method').mockImplementation(...)` — use for a single method on a real object that is available at module load time (e.g. `chrome.storage.local.get`, `navigator.clipboard.writeText`). Keeps the rest of the object intact; restored automatically by Vitest between tests.
- `vi.stubGlobal('fetch', fn)` — use for globals that the production code reads via bare `fetch(...)`. Paired with `vi.unstubAllGlobals()` in `afterEach`.
- `vi.mock('./path', () => ({...}))` — use **only** when replacing an entire module (rare; prefer dependency injection or composable arguments instead).

Anti-pattern: `vi.mock('node:fs')` for a file the extension never actually imports. Usually means the test is reaching into the wrong environment.

## 5. Pseudo-async: await `nextTick` after reactive mutations

If an assertion reads `api.filteredSessions.value` right after writing to `api.searchQuery.value`, Vue's computed is synchronous and the assertion is safe. **However**, if the assertion reads DOM state (e.g. `listEl.querySelector(...)`) after a reactive mutation, you need `await nextTick()` first so Vue re-renders. See `handleJumpToLastFailure` in `MemoryTab.vue` for the real code using this; mirror the pattern in tests that exercise the DOM.

## 6. `describe.skip` / `it.todo`: Vitest-compatible by default

Both Jest and Vitest expose `describe.skip` and `it.todo` as globals through the same test-globals channel. In this repo the extension uses Vitest, the native server uses Jest, and both sides can use the same shape. You do **not** need to import these — relying on globals is the convention.

## 7. Minimal template

Copy-paste starter for a new extension test file:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
    _keys: unknown,
    cb: (items: Record<string, unknown>) => void,
  ) => {
    cb({ nativeServerPort: 12306 });
  }) as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<subject-under-test>', () => {
  it('<behaviour>', async () => {
    // arrange — mock one API response
    // act     — invoke the composable / pure function
    // assert  — check reactive state or return value
  });
});
```

## 8. When to reach for an integration test

Anything that spans the extension ↔ native-server boundary should live in the native-server's Jest suite (see `app/native-server/src/server/memory-routes.test.ts` for the working template with `supertest`). Cross-process tests in the extension's Vitest suite are almost always a sign of an under-sized mock and should be pushed one layer up (to the native server) or one layer down (to the shared package under `packages/shared/tests/`).
