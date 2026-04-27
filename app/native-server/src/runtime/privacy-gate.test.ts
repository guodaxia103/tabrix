/**
 * V27-00 — golden tests for the Privacy Gate library.
 *
 * Every kind of sensitive surface gets:
 * 1. A `findSensitivePaths` test that pinpoints the leak path.
 * 2. A `redactForPersistence` test that proves the surface was
 *    stripped/replaced and the surrounding non-sensitive structure
 *    was preserved.
 * 3. An `assertNoSensitive` round-trip that proves the redacted output
 *    is now safe to persist.
 */
import {
  PRIVACY_REDACTED_SENTINEL,
  assertNoSensitive,
  findSensitivePaths,
  isSensitiveHeaderName,
  isSensitiveKeyName,
  isSensitiveValue,
  redactForPersistence,
} from './privacy-gate';

describe('V27-00 privacy-gate — header allowlist', () => {
  it.each([
    ['cookie', true],
    ['Cookie', true],
    ['authorization', true],
    ['Proxy-Authorization', true],
    ['set-cookie', true],
    ['x-auth-token', true],
    ['x-api-key', true],
    ['some-secret', true],
    ['my-token', true],
    ['user-agent', false],
    ['accept', false],
    ['content-type', false],
  ])('classifies %s as sensitive=%s', (name, expected) => {
    expect(isSensitiveHeaderName(name)).toBe(expected);
  });
});

describe('V27-00 privacy-gate — sensitive-key allowlist', () => {
  it.each([
    ['responseBody', true],
    ['requestBody', true],
    ['url', true],
    ['href', true],
    ['tabId', true],
    ['windowId', true],
    ['refId', true],
    ['urlPattern', false],
    ['method', false],
    ['status', false],
  ])('classifies %s as sensitive=%s', (name, expected) => {
    expect(isSensitiveKeyName(name)).toBe(expected);
  });
});

describe('V27-00 privacy-gate — value-shape detector', () => {
  it.each([
    ['user@example.com', true],
    ['+1 (415) 555-1212', true],
    ['4111 1111 1111 1111', true],
    ['ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true],
    ['short', false],
    ['hello world', false],
    ['', false],
    ['12', false],
  ])('isSensitiveValue(%j) === %s', (value, expected) => {
    expect(isSensitiveValue(value)).toBe(expected);
  });
});

describe('V27-00 privacy-gate — redactForPersistence', () => {
  it('drops cookie / authorization headers from a header bag', () => {
    const input = {
      method: 'GET',
      requestHeaders: {
        cookie: 'session=abc123',
        authorization: 'Bearer secret',
        'user-agent': 'Mozilla/5.0',
      },
    };
    const out = redactForPersistence(input, { kind: 'fact_snapshot' });
    expect(out).toEqual({
      method: 'GET',
      requestHeaders: { 'user-agent': 'Mozilla/5.0' },
    });
  });

  it('drops raw response/request bodies entirely', () => {
    const input = {
      ok: true,
      status: 200,
      responseBody: '{"secret":"value"}',
      requestBody: 'q=alice@example.com',
    };
    const out = redactForPersistence(input, { kind: 'fact_snapshot' });
    expect(out).toEqual({ ok: true, status: 200 });
  });

  it('drops raw url / href / search keys but keeps urlPattern', () => {
    const input = {
      urlPattern: 'github.com/repos/:owner/:repo/issues',
      url: 'https://github.com/owner/repo/issues?q=secret',
      href: 'https://github.com/owner/repo/issues#x',
      search: '?token=ABCDEF',
      method: 'GET',
    };
    const out = redactForPersistence(input, { kind: 'fact_snapshot' });
    expect(out).toEqual({
      urlPattern: 'github.com/repos/:owner/:repo/issues',
      method: 'GET',
    });
  });

  it('redacts value-shaped scalars in non-allowlisted free-form fields', () => {
    const input = {
      label: 'user@example.com',
      memo: 'short',
      apiKey: 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const out = redactForPersistence(input, { kind: 'generic' }) as Record<string, unknown>;
    expect(out.label).toBe(PRIVACY_REDACTED_SENTINEL);
    expect(out.memo).toBe('short');
    expect(out.apiKey).toBe(PRIVACY_REDACTED_SENTINEL);
  });

  it('drops browser-side ids (tabId / windowId / refId / nodeId)', () => {
    const input = {
      tabId: 42,
      windowId: 1,
      frameId: 0,
      refId: 'r-123',
      nodeId: 9,
      kept: 'value',
    };
    const out = redactForPersistence(input, { kind: 'tab_event' });
    expect(out).toEqual({ kept: 'value' });
  });

  it('walks arrays and nested objects', () => {
    const input = {
      events: [
        { type: 'request', requestBody: 'leak', urlPattern: 'a/b' },
        { type: 'response', responseBody: 'leak', status: 200 },
      ],
    };
    const out = redactForPersistence(input, { kind: 'fact_snapshot' });
    expect(out).toEqual({
      events: [
        { type: 'request', urlPattern: 'a/b' },
        { type: 'response', status: 200 },
      ],
    });
  });

  it('caps recursion at MAX_DEPTH so a cycle does not stack-overflow', () => {
    const node: Record<string, unknown> = { name: 'root' };
    let cur: Record<string, unknown> = node;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = { name: `n${i}` };
      cur.next = next;
      cur = next;
    }
    expect(() => redactForPersistence(node, { kind: 'generic' })).not.toThrow();
  });
});

describe('V27-00 privacy-gate — findSensitivePaths / assertNoSensitive', () => {
  it('reports the exact path that leaks', () => {
    const input = {
      meta: {
        requestHeaders: { cookie: 'x', accept: 'json' },
        responseBody: '{}',
      },
    };
    const leaks = findSensitivePaths(input);
    const paths = leaks.map((leak) => leak.path).sort();
    expect(paths).toEqual(['meta.requestHeaders.cookie', 'meta.responseBody']);
  });

  it('assertNoSensitive throws when the input has any leak', () => {
    expect(() => assertNoSensitive({ headers: { cookie: 'x' } })).toThrowError(/PrivacyGate/);
  });

  it('assertNoSensitive succeeds on a redacted output', () => {
    const input = { headers: { cookie: 'x', accept: 'json' }, urlPattern: 'a/b' };
    const out = redactForPersistence(input, { kind: 'fact_snapshot' });
    expect(() => assertNoSensitive(out)).not.toThrow();
  });
});
