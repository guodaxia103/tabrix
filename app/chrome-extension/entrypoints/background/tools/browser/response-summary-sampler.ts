const MESSAGE_TYPE = 'tabrix:v27-response-summary';
const DEFAULT_TTL_MS = 30_000;
const MAX_ROWS = 10;
const MAX_KEYS_PER_ROW = 12;
const MAX_STRING_VALUE_LENGTH = 240;
const SENSITIVE_FIELD_RE =
  /(authorization|cookie|password|passwd|token|secret|session|csrf|xsrf|api[_-]?key)/i;

export type ResponseSummarySource = 'browser_context_summary';
export type ResponseSummaryBridgePath = 'main_world_to_content_to_native';

export interface BrowserContextSafeResponseSummary {
  responseSummarySource: ResponseSummarySource;
  bridgePath: ResponseSummaryBridgePath;
  capturedAfterArm: boolean;
  rawBodyPersisted: false;
  privacyCheck: 'passed' | 'failed';
  rejectedReason: string | null;
  method: string;
  url: string;
  status: number | null;
  contentType: string | null;
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  emptyResult: boolean;
  emptyResultEvidence: 'empty_array' | null;
  fieldShapeSummaryAvailable: boolean;
  fieldNames: string[];
  taskQueryValueMatched: boolean | null;
  samplerArmedAt: number;
  capturedAt: number;
}

export interface ResponseSummarySamplerLifecycle {
  samplerArmedAt: number | null;
  samplerDisarmedAt: number | null;
  samplerDisarmReason: string;
  responseSummarySource: ResponseSummarySource | 'not_available';
  responseSummaryRejectedReason: string | null;
  capturedAfterArm: boolean | null;
  bridgePath: ResponseSummaryBridgePath | 'not_available';
  rawBodyPersisted: false;
}

export interface ResponseSummarySamplerArmResult {
  ok: boolean;
  samplerId: string;
  samplerArmedAt: number | null;
  fallbackCause: string | null;
  bridgePath: ResponseSummaryBridgePath | 'not_available';
}

interface SamplerState {
  samplerId: string;
  tabId: number;
  armedAt: number;
  expiresAt: number;
  summaries: BrowserContextSafeResponseSummary[];
  lastRejectedReason: string | null;
  disarmedAt: number | null;
  disarmReason: string | null;
}

interface RawSummaryMessage {
  type?: unknown;
  samplerId?: unknown;
  summary?: unknown;
}

function nowMs(): number {
  return Date.now();
}

function normalizeMethod(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : 'GET';
}

function normalizeContentType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function redactUrlForMetadata(url: string): string {
  try {
    const parsed = new URL(url);
    const keys = Array.from(new Set(Array.from(parsed.searchParams.keys())));
    parsed.search = '';
    for (const key of keys.sort()) parsed.searchParams.append(key, '');
    return parsed.toString();
  } catch {
    return '';
  }
}

function isSafeRowValue(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function sanitizeSummary(
  input: unknown,
  state: SamplerState,
): BrowserContextSafeResponseSummary | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const source =
    obj.responseSummarySource === 'browser_context_summary' ? 'browser_context_summary' : null;
  const bridgePath =
    obj.bridgePath === 'main_world_to_content_to_native' ? 'main_world_to_content_to_native' : null;
  if (!source || !bridgePath) return null;

  const url = typeof obj.url === 'string' ? redactUrlForMetadata(obj.url) : '';
  if (!url) return null;
  const rowsInput = Array.isArray(obj.rows) ? obj.rows : [];
  const rows: BrowserContextSafeResponseSummary['rows'] = [];
  let privacyFailed = obj.privacyCheck === 'failed';
  for (const rawRow of rowsInput.slice(0, MAX_ROWS)) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) continue;
    const row: Record<string, string | number | boolean | null> = {};
    for (const key of Object.keys(rawRow as Record<string, unknown>).slice(0, MAX_KEYS_PER_ROW)) {
      if (SENSITIVE_FIELD_RE.test(key)) {
        privacyFailed = true;
        continue;
      }
      const value = (rawRow as Record<string, unknown>)[key];
      if (!isSafeRowValue(value)) continue;
      row[key] =
        typeof value === 'string' && value.length > MAX_STRING_VALUE_LENGTH
          ? value.slice(0, MAX_STRING_VALUE_LENGTH)
          : value;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  const fieldNames = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort();
  const capturedAt = typeof obj.capturedAt === 'number' ? obj.capturedAt : nowMs();
  const emptyResultEvidence = obj.emptyResultEvidence === 'empty_array' ? 'empty_array' : null;
  const emptyResult =
    rows.length === 0 && obj.emptyResult === true && emptyResultEvidence === 'empty_array';
  const compactUnavailable = !privacyFailed && rows.length === 0 && !emptyResult;
  const rejectedReason =
    typeof obj.rejectedReason === 'string' && obj.rejectedReason.length > 0
      ? obj.rejectedReason
      : privacyFailed
        ? 'sensitive_field'
        : compactUnavailable
          ? 'compact_rows_unavailable'
          : null;
  if (rejectedReason) state.lastRejectedReason = rejectedReason;
  return {
    responseSummarySource: source,
    bridgePath,
    capturedAfterArm: obj.capturedAfterArm === true && capturedAt >= state.armedAt,
    rawBodyPersisted: false,
    privacyCheck: privacyFailed ? 'failed' : 'passed',
    rejectedReason,
    method: normalizeMethod(obj.method),
    url,
    status: typeof obj.status === 'number' ? obj.status : null,
    contentType: normalizeContentType(obj.contentType),
    rows: privacyFailed ? [] : rows,
    rowCount: privacyFailed ? 0 : rows.length,
    emptyResult: privacyFailed ? false : emptyResult,
    emptyResultEvidence: privacyFailed ? null : emptyResultEvidence,
    fieldShapeSummaryAvailable: !privacyFailed && fieldNames.length > 0,
    fieldNames,
    taskQueryValueMatched:
      typeof obj.taskQueryValueMatched === 'boolean' ? obj.taskQueryValueMatched : null,
    samplerArmedAt: state.armedAt,
    capturedAt,
  };
}

function buildBridgeScript(args: { samplerId: string; expiresAt: number; messageType: string }) {
  const messageType = args.messageType;
  const samplerId = args.samplerId;
  const expiresAt = args.expiresAt;
  const bridgePath = 'main_world_to_content_to_native';
  const key = `__tabrixResponseSummaryBridge_${samplerId}`;
  const existing = (window as unknown as Record<string, unknown>)[key] as
    | { cleanup?: () => void }
    | undefined;
  if (existing?.cleanup) existing.cleanup();
  const listener = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (Date.now() > expiresAt) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const payload = data as Record<string, unknown>;
    if (payload.type !== messageType || payload.samplerId !== samplerId) return;
    void chrome.runtime.sendMessage({
      type: messageType,
      samplerId,
      bridgePath,
      summary: payload.summary,
    });
  };
  window.addEventListener('message', listener);
  (window as unknown as Record<string, unknown>)[key] = {
    cleanup() {
      window.removeEventListener('message', listener);
    },
  };
  return { ok: true, bridgePath };
}

function buildMainWorldSampler(args: {
  samplerId: string;
  armedAt: number;
  expiresAt: number;
  messageType: string;
}) {
  const messageType = args.messageType;
  const samplerId = args.samplerId;
  const armedAt = args.armedAt;
  const expiresAt = args.expiresAt;
  const stateKey = '__tabrixResponseSummarySampler';
  const globalState = window as unknown as Record<string, any>;
  const oldState = globalState[stateKey];
  if (oldState?.restore) oldState.restore();

  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  const sensitiveRe =
    /(authorization|cookie|password|passwd|token|secret|session|csrf|xsrf|api[_-]?key)/i;
  const searchKeys = new Set(['q', 'query', 'search', 'keyword', 'keywords', 'term']);

  function normalizeMethodLocal(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : 'GET';
  }

  function resolveUrl(value: unknown): string {
    try {
      if (typeof Request !== 'undefined' && value instanceof Request) return value.url;
      if (value instanceof URL) return value.href;
      if (typeof value === 'string') return new URL(value, window.location.href).href;
    } catch {
      return '';
    }
    return '';
  }

  function normalizeQueryValue(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function comparableSearchValues(url: string): string[] {
    try {
      const parsed = new URL(url, window.location.href);
      const values: string[] = [];
      parsed.searchParams.forEach((value, key) => {
        if (!searchKeys.has(key.toLowerCase())) return;
        const normalized = normalizeQueryValue(value);
        if (normalized) values.push(normalized);
      });
      return Array.from(new Set(values)).sort();
    } catch {
      return [];
    }
  }

  function taskQueryValueMatched(url: string): boolean | null {
    const current = comparableSearchValues(window.location.href);
    const request = comparableSearchValues(url);
    if (current.length === 0 || request.length === 0) return null;
    return request.some((value) => current.includes(value));
  }

  function compactPrimitive(value: unknown): string | number | boolean | null | undefined {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 240 ? value.slice(0, 240) : value;
    return undefined;
  }

  function pickRows(parsed: unknown): {
    rows: Array<Record<string, string | number | boolean | null>>;
    listLength: number | null;
  } {
    const arrayKeys = [
      'items',
      'data',
      'results',
      'objects',
      'hits',
      'records',
      'list',
      'pages',
      'edges',
    ];
    let list: unknown[] | null = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      for (const key of arrayKeys) {
        const candidate = obj[key];
        if (Array.isArray(candidate)) {
          list = candidate;
          break;
        }
      }
    }
    if (!list) return { rows: [], listLength: null };
    const rows: Array<Record<string, string | number | boolean | null>> = [];
    for (const raw of list.slice(0, 10)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row: Record<string, string | number | boolean | null> = {};
      for (const key of Object.keys(raw as Record<string, unknown>).slice(0, 12)) {
        if (sensitiveRe.test(key)) continue;
        const compact = compactPrimitive((raw as Record<string, unknown>)[key]);
        if (compact !== undefined) row[key] = compact;
      }
      if (Object.keys(row).length > 0) rows.push(row);
    }
    return { rows, listLength: list.length };
  }

  function hasSensitiveField(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    const stack: unknown[] = [parsed];
    let inspected = 0;
    while (stack.length > 0 && inspected < 80) {
      inspected += 1;
      const next = stack.pop();
      if (!next || typeof next !== 'object') continue;
      if (Array.isArray(next)) {
        for (const item of next.slice(0, 5)) stack.push(item);
        continue;
      }
      for (const key of Object.keys(next as Record<string, unknown>).slice(0, 20)) {
        if (sensitiveRe.test(key)) return true;
        stack.push((next as Record<string, unknown>)[key]);
      }
    }
    return false;
  }

  function postSummary(input: {
    url: string;
    method: string;
    status: number | null;
    contentType: string | null;
    parsed: unknown;
    rejectedReason: string | null;
  }) {
    if (Date.now() > expiresAt) return;
    const privacyFailed = input.rejectedReason !== null || hasSensitiveField(input.parsed);
    const compact = privacyFailed ? { rows: [], listLength: null } : pickRows(input.parsed);
    const rows = compact.rows;
    const compactUnavailable =
      !privacyFailed &&
      (compact.listLength === null || (compact.listLength > 0 && rows.length === 0));
    window.postMessage(
      {
        type: messageType,
        samplerId,
        summary: {
          responseSummarySource: 'browser_context_summary',
          bridgePath: 'main_world_to_content_to_native',
          capturedAfterArm: true,
          rawBodyPersisted: false,
          privacyCheck: privacyFailed ? 'failed' : 'passed',
          rejectedReason: privacyFailed
            ? input.rejectedReason || 'sensitive_field'
            : compactUnavailable
              ? 'compact_rows_unavailable'
              : null,
          method: input.method,
          url: input.url,
          status: input.status,
          contentType: input.contentType,
          rows,
          rowCount: rows.length,
          emptyResult: compact.listLength === 0 && !privacyFailed,
          emptyResultEvidence: compact.listLength === 0 && !privacyFailed ? 'empty_array' : null,
          taskQueryValueMatched: taskQueryValueMatched(input.url),
          samplerArmedAt: armedAt,
          capturedAt: Date.now(),
        },
      },
      '*',
    );
  }

  async function summarizeFetchResponse(url: string, method: string, response: Response) {
    const contentType = response.headers.get('content-type');
    if (
      !contentType ||
      !/\b(application\/json|application\/.*\+json|text\/json)\b/i.test(contentType)
    ) {
      return;
    }
    try {
      const parsed = await response.clone().json();
      postSummary({
        url,
        method,
        status: response.status,
        contentType,
        parsed,
        rejectedReason: null,
      });
    } catch {
      postSummary({
        url,
        method,
        status: response.status,
        contentType,
        parsed: null,
        rejectedReason: 'compact_rows_unavailable',
      });
    }
  }

  window.fetch = function tabrixFetch(this: typeof window, ...fetchArgs: Parameters<typeof fetch>) {
    const [input, init] = fetchArgs;
    const url = resolveUrl(input);
    const method = normalizeMethodLocal(
      init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'),
    );
    const promise = originalFetch.apply(this, fetchArgs);
    void promise
      .then((response) => summarizeFetchResponse(url, method, response))
      .catch(() => undefined);
    return promise;
  } as typeof fetch;

  XMLHttpRequest.prototype.open = function tabrixOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...openArgs: Array<boolean | string | null | undefined>
  ) {
    (
      this as XMLHttpRequest & { __tabrixSummary?: { method: string; url: string } }
    ).__tabrixSummary = {
      method: normalizeMethodLocal(method),
      url: resolveUrl(url),
    };
    return originalOpen.apply(this, [method, url.toString(), ...openArgs] as Parameters<
      XMLHttpRequest['open']
    >);
  };

  XMLHttpRequest.prototype.send = function tabrixSend(
    this: XMLHttpRequest,
    ...sendArgs: Parameters<XMLHttpRequest['send']>
  ) {
    const xhr = this as XMLHttpRequest & { __tabrixSummary?: { method: string; url: string } };
    xhr.addEventListener('loadend', () => {
      const meta = xhr.__tabrixSummary;
      if (!meta) return;
      const contentType = xhr.getResponseHeader('content-type');
      if (
        !contentType ||
        !/\b(application\/json|application\/.*\+json|text\/json)\b/i.test(contentType)
      )
        return;
      try {
        const parsed = JSON.parse(String(xhr.responseText || 'null'));
        postSummary({
          url: meta.url,
          method: meta.method,
          status: xhr.status,
          contentType,
          parsed,
          rejectedReason: null,
        });
      } catch {
        postSummary({
          url: meta.url,
          method: meta.method,
          status: xhr.status,
          contentType,
          parsed: null,
          rejectedReason: 'compact_rows_unavailable',
        });
      }
    });
    return originalSend.apply(this, sendArgs);
  };

  globalState[stateKey] = {
    samplerId,
    restore() {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
    },
  };
  return {
    ok: true,
    samplerId,
    samplerArmedAt: armedAt,
    bridgePath: 'main_world_to_content_to_native',
  };
}

function buildMainWorldDisarm(args: { samplerId: string }) {
  const stateKey = '__tabrixResponseSummarySampler';
  const globalState = window as unknown as Record<string, any>;
  const state = globalState[stateKey];
  if (state?.samplerId === args.samplerId && state.restore) {
    state.restore();
    delete globalState[stateKey];
  }
  return { ok: true };
}

export class ResponseSummarySamplerManager {
  private readonly states = new Map<number, SamplerState>();
  private listenerInstalled = false;

  async armForTab(
    tabId: number,
    options?: { ttlMs?: number },
  ): Promise<ResponseSummarySamplerArmResult> {
    const armedAt = nowMs();
    const ttlMs = Math.max(1000, Math.min(options?.ttlMs ?? DEFAULT_TTL_MS, 180_000));
    const samplerId = `v27_${tabId}_${armedAt}_${Math.random().toString(36).slice(2)}`;
    const state: SamplerState = {
      samplerId,
      tabId,
      armedAt,
      expiresAt: armedAt + ttlMs,
      summaries: [],
      lastRejectedReason: null,
      disarmedAt: null,
      disarmReason: null,
    };
    try {
      this.ensureMessageListener();
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: 'ISOLATED' as chrome.scripting.ExecutionWorld,
        func: buildBridgeScript,
        args: [{ samplerId, expiresAt: state.expiresAt, messageType: MESSAGE_TYPE }],
      });
      const [mainAck] = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        func: buildMainWorldSampler,
        args: [{ samplerId, armedAt, expiresAt: state.expiresAt, messageType: MESSAGE_TYPE }],
      });
      const result = mainAck?.result as { ok?: unknown; bridgePath?: unknown } | undefined;
      if (!result?.ok) {
        return {
          ok: false,
          samplerId,
          samplerArmedAt: null,
          fallbackCause: 'sampler_arm_ack_missing',
          bridgePath: 'not_available',
        };
      }
      this.states.set(tabId, state);
      return {
        ok: true,
        samplerId,
        samplerArmedAt: armedAt,
        fallbackCause: null,
        bridgePath: 'main_world_to_content_to_native',
      };
    } catch {
      this.states.delete(tabId);
      return {
        ok: false,
        samplerId,
        samplerArmedAt: null,
        fallbackCause: 'sampler_injection_failed',
        bridgePath: 'not_available',
      };
    }
  }

  async disarmForTab(
    tabId: number,
    reason: string,
  ): Promise<{
    summaries: BrowserContextSafeResponseSummary[];
    lifecycle: ResponseSummarySamplerLifecycle;
  }> {
    const state = this.states.get(tabId);
    if (!state) {
      return {
        summaries: [],
        lifecycle: {
          samplerArmedAt: null,
          samplerDisarmedAt: nowMs(),
          samplerDisarmReason: 'not_armed',
          responseSummarySource: 'not_available',
          responseSummaryRejectedReason: 'response_summary_unavailable',
          capturedAfterArm: null,
          bridgePath: 'not_available',
          rawBodyPersisted: false,
        },
      };
    }
    state.disarmedAt = nowMs();
    state.disarmReason = reason;
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
        func: buildMainWorldDisarm,
        args: [{ samplerId: state.samplerId }],
      });
    } catch {
      state.lastRejectedReason = state.lastRejectedReason ?? 'sampler_disarm_failed';
    }
    this.states.delete(tabId);
    const first = state.summaries[0] ?? null;
    return {
      summaries: state.summaries.map((summary) => ({
        ...summary,
        rows: summary.rows.map((row) => ({ ...row })),
      })),
      lifecycle: {
        samplerArmedAt: state.armedAt,
        samplerDisarmedAt: state.disarmedAt,
        samplerDisarmReason: reason,
        responseSummarySource: first ? 'browser_context_summary' : 'not_available',
        responseSummaryRejectedReason:
          state.lastRejectedReason ?? (first ? null : 'response_summary_unavailable'),
        capturedAfterArm: first ? first.capturedAfterArm : null,
        bridgePath: first ? 'main_world_to_content_to_native' : 'not_available',
        rawBodyPersisted: false,
      },
    };
  }

  private ensureMessageListener(): void {
    if (this.listenerInstalled) return;
    chrome.runtime.onMessage.addListener((message: RawSummaryMessage, sender) => {
      if (!message || message.type !== MESSAGE_TYPE) return false;
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return false;
      const state = this.states.get(tabId);
      if (!state || message.samplerId !== state.samplerId) return false;
      if (nowMs() > state.expiresAt) {
        state.lastRejectedReason = 'sampler_ttl_expired';
        return false;
      }
      const summary = sanitizeSummary(message.summary, state);
      if (summary) state.summaries.push(summary);
      return false;
    });
    this.listenerInstalled = true;
  }
}

export const responseSummarySampler = new ResponseSummarySamplerManager();
