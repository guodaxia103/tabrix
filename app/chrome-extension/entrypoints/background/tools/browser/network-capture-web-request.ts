import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { LIMITS, NETWORK_FILTERS } from '@/common/constants';
import {
  responseSummarySampler,
  type BrowserContextSafeResponseSummary,
  type ResponseSummarySamplerArmResult,
} from './response-summary-sampler';

// Static resource file extensions
const STATIC_RESOURCE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp', // Images
  '.css',
  '.scss',
  '.less', // Styles
  '.js',
  '.jsx',
  '.ts',
  '.tsx', // Scripts
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf', // Fonts
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.ogg',
  '.wav', // Media
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx', // Documents
];

// Ad and analytics domain list
const AD_ANALYTICS_DOMAINS = NETWORK_FILTERS.EXCLUDED_DOMAINS;
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-xsrf-token',
  'x-api-key',
]);

/**
 * V26-FIX-02 — closed-enum mode the chooser advisory drives. The
 * extension-side capture tool consumes a runtime override so a
 * mis-routed `chrome_network_capture_start` from a stale upstream
 * caller cannot bypass the advisory and force a foreground capture.
 *
 * Defaults to `'foreground'` (legacy v2.5 behaviour) so callers that
 * never set the override stay bit-identical.
 */
export type NetworkCaptureObserveMode = 'foreground' | 'background' | 'disabled';

const NETWORK_CAPTURE_OBSERVE_MODES: ReadonlySet<NetworkCaptureObserveMode> =
  new Set<NetworkCaptureObserveMode>(['foreground', 'background', 'disabled']);

/**
 * V26-FIX-02 — pure decision: should `chrome_network_capture_start`
 * actually install webRequest listeners for this call?
 *
 *   - `'proceed'` — legacy v2.5 behaviour (foreground capture).
 *   - `'skip'`    — short-circuit: do NOT install listeners. Returned
 *                   when the chooser said `disabled`. The caller MAY
 *                   still respond `success: true` with a structured
 *                   payload so MCP clients see a clean "not needed"
 *                   result (one tool call ↔ one tool result).
 *
 * `'background'` is treated as `'skip'` for the foreground-driving
 * caller: passive listeners installed elsewhere in the extension may
 * still observe traffic, but the foreground round-trip itself is
 * suppressed.
 */
export function evaluateNetworkCaptureObserveModeGate(mode: NetworkCaptureObserveMode | null): {
  action: 'proceed' | 'skip';
  reason: 'no_override' | 'foreground_requested' | 'background_passive' | 'disabled_advisory';
} {
  if (mode === null) return { action: 'proceed', reason: 'no_override' };
  if (mode === 'foreground') return { action: 'proceed', reason: 'foreground_requested' };
  if (mode === 'background') return { action: 'skip', reason: 'background_passive' };
  return { action: 'skip', reason: 'disabled_advisory' };
}

export function isNetworkCaptureObserveMode(value: unknown): value is NetworkCaptureObserveMode {
  return typeof value === 'string' && NETWORK_CAPTURE_OBSERVE_MODES.has(value as never);
}

/**
 * V26-FIX-02 — process-wide override that the upstream MCP loop sets
 * after consuming a chooser advisory. The default `null` preserves
 * legacy `foreground` behaviour. Setter is intentionally minimal: a
 * full per-tab map is overkill for v2.6 (the chooser writes one
 * advisory per task, and tasks don't span multiple tabs in v2.6).
 */
let networkCaptureObserveModeOverride: NetworkCaptureObserveMode | null = null;

export function setNetworkCaptureObserveModeOverride(mode: NetworkCaptureObserveMode | null): void {
  networkCaptureObserveModeOverride = mode;
}

export function getNetworkCaptureObserveModeOverride(): NetworkCaptureObserveMode | null {
  return networkCaptureObserveModeOverride;
}

export type EndpointNoiseClass =
  | 'asset'
  | 'analytics'
  | 'auth'
  | 'private'
  | 'telemetry'
  | 'usable'
  | 'unknown';

export function redactNetworkCaptureUrlForMetadata(url: string): string {
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

export function sanitizeNetworkCaptureHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const safe: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    const normalized = name.toLowerCase();
    if (!normalized || SENSITIVE_HEADER_NAMES.has(normalized)) continue;
    safe[normalized] = '';
  }
  return safe;
}

export function classifyNetworkCaptureEndpoint(input: {
  url: string;
  method?: string;
  type?: string;
  mimeType?: string;
}): EndpointNoiseClass {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return 'unknown';
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const normalizedUrl = input.url.toLowerCase();
  const method = (input.method || 'GET').toUpperCase();
  const type = (input.type || '').toLowerCase();
  const mimeType = (input.mimeType || '').toLowerCase();

  if (AD_ANALYTICS_DOMAINS.some((pattern) => normalizedUrl.includes(pattern))) return 'analytics';
  if (path.includes('/_private/') || path.includes('/private/')) return 'private';
  if (/\b(login|logout|session|oauth|token|authorize|auth)\b/.test(path)) return 'auth';
  if (/\b(stats|telemetry|metrics|collect|beacon|events?)\b/.test(path)) return 'telemetry';
  if (
    type === 'image' ||
    type === 'stylesheet' ||
    type === 'font' ||
    STATIC_RESOURCE_EXTENSIONS.some((ext) => path.endsWith(ext)) ||
    /^(image|font|audio|video)\//.test(mimeType)
  ) {
    return 'asset';
  }
  if ((method === 'GET' || method === 'HEAD') && (type === 'xmlhttprequest' || type === 'fetch')) {
    return 'usable';
  }
  if (host === 'api.github.com' && (method === 'GET' || method === 'HEAD')) return 'usable';
  if (mimeType.includes('json') && (method === 'GET' || method === 'HEAD')) return 'usable';
  return 'unknown';
}

interface NetworkCaptureStartToolParams {
  url?: string; // URL to navigate to or focus. If not provided, uses active tab.
  maxCaptureTime?: number; // Maximum capture time (milliseconds)
  inactivityTimeout?: number; // Inactivity timeout (milliseconds)
  includeStatic?: boolean; // Whether to include static resources
  tabId?: number;
  windowId?: number;
}

interface NetworkCaptureStopToolParams {
  tabId?: number;
  windowId?: number;
}

interface NetworkRequestInfo {
  requestId: string;
  url: string;
  method: string;
  type: string;
  requestTime: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseTime?: number;
  status?: number;
  statusText?: string;
  encodedDataLength?: number;
  responseSize?: number;
  responseType?: string;
  responseBody?: string;
  errorText?: string;
  specificRequestHeaders?: Record<string, string>;
  specificResponseHeaders?: Record<string, string>;
  mimeType?: string; // Response MIME type
  safeResponseSummary?: BrowserContextSafeResponseSummary;
}

interface CaptureInfo {
  tabId: number;
  tabUrl: string;
  tabTitle: string;
  startTime: number;
  endTime?: number;
  requests: Record<string, NetworkRequestInfo>;
  maxCaptureTime: number;
  inactivityTimeout: number;
  includeStatic: boolean;
  limitReached?: boolean; // Whether request count limit is reached
  responseSummarySampler?: ResponseSummarySamplerArmResult;
}

/**
 * Network Capture Start Tool V2 - Uses Chrome webRequest API to start capturing network requests
 */
class NetworkCaptureStartTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_CAPTURE_START;
  public static instance: NetworkCaptureStartTool | null = null;
  public captureData: Map<number, CaptureInfo> = new Map(); // tabId -> capture data
  private captureTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> max capture timer
  private inactivityTimers: Map<number, NodeJS.Timeout> = new Map(); // tabId -> inactivity timer
  private lastActivityTime: Map<number, number> = new Map(); // tabId -> timestamp of last activity
  private requestCounters: Map<number, number> = new Map(); // tabId -> count of captured requests
  public static MAX_REQUESTS_PER_CAPTURE = LIMITS.MAX_NETWORK_REQUESTS; // Maximum capture request count
  private listeners: { [key: string]: (details: any) => void } = {};
  private webRequestListenersInstalled = false;

  // Static resource MIME types list (for filtering)
  private static STATIC_MIME_TYPES_TO_FILTER = [
    'image/', // All image types
    'font/', // All font types
    'audio/', // All audio types
    'video/', // All video types
    'text/css',
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'application/pdf',
    'application/zip',
    'application/octet-stream', // Usually for downloads or generic binary data
  ];

  // API response MIME types list (these types are usually not filtered)
  private static API_MIME_TYPES = [
    'application/json',
    'application/xml',
    'text/xml',
    'application/x-www-form-urlencoded',
    'application/graphql',
    'application/grpc',
    'application/protobuf',
    'application/x-protobuf',
    'application/x-json',
    'application/ld+json',
    'application/problem+json',
    'application/problem+xml',
    'application/soap+xml',
    'application/vnd.api+json',
  ];

  constructor() {
    super();
    if (NetworkCaptureStartTool.instance) {
      return NetworkCaptureStartTool.instance;
    }
    NetworkCaptureStartTool.instance = this;

    // Listen for tab close events
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
    // Listen for tab creation events
    chrome.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
  }

  /**
   * Handle tab close events
   */
  private handleTabRemoved(tabId: number) {
    if (this.captureData.has(tabId)) {
      console.log(`NetworkCaptureV2: Tab ${tabId} was closed, cleaning up resources.`);
      this.cleanupCapture(tabId);
    }
  }

  /**
   * Handle tab creation events
   * If a new tab is opened from a tab being captured, automatically start capturing the new tab's requests
   */
  private async handleTabCreated(tab: chrome.tabs.Tab) {
    try {
      // Check if there are any tabs currently capturing
      if (this.captureData.size === 0) return;

      // Get the openerTabId of the new tab (ID of the tab that opened this tab)
      const openerTabId = tab.openerTabId;
      if (!openerTabId) return;

      // Check if the opener tab is currently capturing
      if (!this.captureData.has(openerTabId)) return;

      // Get the new tab's ID
      const newTabId = tab.id;
      if (!newTabId) return;

      console.log(
        `NetworkCaptureV2: New tab ${newTabId} created from capturing tab ${openerTabId}, will extend capture to it.`,
      );

      // Get the opener tab's capture settings
      const openerCaptureInfo = this.captureData.get(openerTabId);
      if (!openerCaptureInfo) return;

      // Wait a short time to ensure the tab is ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Start capturing requests for the new tab
      await this.startCaptureForTab(newTabId, {
        maxCaptureTime: openerCaptureInfo.maxCaptureTime,
        inactivityTimeout: openerCaptureInfo.inactivityTimeout,
        includeStatic: openerCaptureInfo.includeStatic,
      });

      console.log(`NetworkCaptureV2: Successfully extended capture to new tab ${newTabId}`);
    } catch (error) {
      console.error(`NetworkCaptureV2: Error extending capture to new tab:`, error);
    }
  }

  /**
   * Determine whether a request should be filtered (based on URL)
   * Uses full URL substring match to support patterns like 'facebook.com/tr'
   */
  private shouldFilterRequest(url: string, includeStatic: boolean): boolean {
    const normalizedUrl = String(url || '').toLowerCase();
    if (!normalizedUrl) return false;

    // Check if it's an ad or analytics domain (full URL substring match)
    if (AD_ANALYTICS_DOMAINS.some((pattern) => normalizedUrl.includes(pattern))) {
      return true;
    }

    // If not including static resources, check extensions
    if (!includeStatic) {
      try {
        const urlObj = new URL(url);
        const path = urlObj.pathname.toLowerCase();
        if (STATIC_RESOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
          return true;
        }
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Filter based on MIME type
   */
  private shouldFilterByMimeType(mimeType: string, includeStatic: boolean): boolean {
    if (!mimeType) return false;
    const normalizedMime = mimeType.toLowerCase().split(';')[0]?.trim() || '';
    if (!normalizedMime) return false;

    // Always keep API response types
    if (NetworkCaptureStartTool.API_MIME_TYPES.some((type) => normalizedMime.startsWith(type))) {
      return false;
    }

    // If not including static resources, filter out static resource MIME types
    if (!includeStatic) {
      // Filter static resource MIME types
      if (
        NetworkCaptureStartTool.STATIC_MIME_TYPES_TO_FILTER.some((type) =>
          normalizedMime.startsWith(type),
        )
      ) {
        console.log(`NetworkCaptureV2: Filtering static resource by MIME type: ${normalizedMime}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Update last activity time and reset inactivity timer
   */
  private updateLastActivityTime(tabId: number): void {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    this.lastActivityTime.set(tabId, Date.now());

    // Reset inactivity timer
    if (this.inactivityTimers.has(tabId)) {
      clearTimeout(this.inactivityTimers.get(tabId)!);
    }

    if (captureInfo.inactivityTimeout > 0) {
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), captureInfo.inactivityTimeout),
      );
    }
  }

  /**
   * Check for inactivity
   */
  private checkInactivity(tabId: number): void {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    const lastActivity = this.lastActivityTime.get(tabId) || captureInfo.startTime;
    const now = Date.now();
    const inactiveTime = now - lastActivity;

    if (inactiveTime >= captureInfo.inactivityTimeout) {
      console.log(
        `NetworkCaptureV2: No activity for ${inactiveTime}ms, stopping capture for tab ${tabId}`,
      );
      this.stopCaptureByInactivity(tabId);
    } else {
      // If inactivity time hasn't been reached yet, continue checking
      const remainingTime = captureInfo.inactivityTimeout - inactiveTime;
      this.inactivityTimers.set(
        tabId,
        setTimeout(() => this.checkInactivity(tabId), remainingTime),
      );
    }
  }

  /**
   * Stop capture due to inactivity
   */
  private async stopCaptureByInactivity(tabId: number): Promise<void> {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) return;

    console.log(`NetworkCaptureV2: Stopping capture due to inactivity for tab ${tabId}`);
    await this.stopCapture(tabId);
  }

  /**
   * Clean up capture resources
   */
  private cleanupCapture(tabId: number): void {
    // Clear timers
    if (this.captureTimers.has(tabId)) {
      clearTimeout(this.captureTimers.get(tabId)!);
      this.captureTimers.delete(tabId);
    }

    if (this.inactivityTimers.has(tabId)) {
      clearTimeout(this.inactivityTimers.get(tabId)!);
      this.inactivityTimers.delete(tabId);
    }

    // Remove data
    this.lastActivityTime.delete(tabId);
    this.captureData.delete(tabId);
    this.requestCounters.delete(tabId);

    console.log(`NetworkCaptureV2: Cleaned up all resources for tab ${tabId}`);
  }

  /**
   * Set up request listeners (idempotent - won't add duplicate listeners)
   */
  private setupListeners(): void {
    // Skip if listeners are already set up
    if (this.webRequestListenersInstalled) {
      return;
    }

    // Before request is sent
    this.listeners.onBeforeRequest = (details: chrome.webRequest.WebRequestBodyDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo) return;

      if (this.shouldFilterRequest(details.url, captureInfo.includeStatic)) {
        return;
      }

      const currentCount = this.requestCounters.get(details.tabId) || 0;
      if (currentCount >= NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE) {
        console.log(
          `NetworkCaptureV2: Request limit (${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE}) reached for tab ${details.tabId}, ignoring new request: ${details.url}`,
        );
        captureInfo.limitReached = true;
        return;
      }

      this.requestCounters.set(details.tabId, currentCount + 1);
      this.updateLastActivityTime(details.tabId);

      if (!captureInfo.requests[details.requestId]) {
        captureInfo.requests[details.requestId] = {
          requestId: details.requestId,
          url: details.url,
          method: details.method,
          type: details.type,
          requestTime: details.timeStamp,
        };

        console.log(
          `NetworkCaptureV2: Captured request ${currentCount + 1}/${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE} for tab ${details.tabId}: ${details.method} ${details.url}`,
        );
      }
    };

    // Send request headers
    this.listeners.onSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      if (details.requestHeaders) {
        const headers: Record<string, string> = {};
        details.requestHeaders.forEach((header) => {
          headers[header.name] = header.value || '';
        });
        captureInfo.requests[details.requestId].requestHeaders = headers;
      }
    };

    // Receive response headers
    this.listeners.onHeadersReceived = (details: chrome.webRequest.WebResponseHeadersDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];

      requestInfo.status = details.statusCode;
      requestInfo.statusText = details.statusLine;
      requestInfo.responseTime = details.timeStamp;
      requestInfo.mimeType = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === 'content-type',
      )?.value;

      // Secondary filtering based on MIME type
      if (
        requestInfo.mimeType &&
        this.shouldFilterByMimeType(requestInfo.mimeType, captureInfo.includeStatic)
      ) {
        delete captureInfo.requests[details.requestId];

        const currentCount = this.requestCounters.get(details.tabId) || 0;
        if (currentCount > 0) {
          this.requestCounters.set(details.tabId, currentCount - 1);
        }

        console.log(
          `NetworkCaptureV2: Filtered request by MIME type (${requestInfo.mimeType}): ${requestInfo.url}`,
        );
        return;
      }

      if (details.responseHeaders) {
        const headers: Record<string, string> = {};
        details.responseHeaders.forEach((header) => {
          headers[header.name] = header.value || '';
        });
        requestInfo.responseHeaders = headers;
      }

      this.updateLastActivityTime(details.tabId);
    };

    // Request completed
    this.listeners.onCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];
      const completionDetails = details as chrome.webRequest.WebResponseCacheDetails & {
        responseSize?: number;
        encodedDataLength?: number;
      };
      const responseSize =
        typeof completionDetails.responseSize === 'number' ? completionDetails.responseSize : null;
      const encodedDataLength =
        typeof completionDetails.encodedDataLength === 'number'
          ? completionDetails.encodedDataLength
          : responseSize;

      if (responseSize !== null) {
        requestInfo.responseSize = details.fromCache ? 0 : responseSize;
      }
      requestInfo.encodedDataLength = details.fromCache ? 0 : (encodedDataLength ?? 0);

      this.updateLastActivityTime(details.tabId);
    };

    // Request failed
    this.listeners.onErrorOccurred = (details: chrome.webRequest.WebResponseErrorDetails) => {
      const captureInfo = this.captureData.get(details.tabId);
      if (!captureInfo || !captureInfo.requests[details.requestId]) return;

      const requestInfo = captureInfo.requests[details.requestId];
      requestInfo.errorText = details.error;

      this.updateLastActivityTime(details.tabId);
    };

    // Register all listeners
    chrome.webRequest.onBeforeRequest.addListener(
      this.listeners.onBeforeRequest,
      { urls: ['<all_urls>'] },
      ['requestBody'],
    );

    chrome.webRequest.onSendHeaders.addListener(
      this.listeners.onSendHeaders,
      { urls: ['<all_urls>'] },
      ['requestHeaders'],
    );

    chrome.webRequest.onHeadersReceived.addListener(
      this.listeners.onHeadersReceived,
      { urls: ['<all_urls>'] },
      ['responseHeaders'],
    );

    chrome.webRequest.onCompleted.addListener(this.listeners.onCompleted, { urls: ['<all_urls>'] });

    chrome.webRequest.onErrorOccurred.addListener(this.listeners.onErrorOccurred, {
      urls: ['<all_urls>'],
    });

    this.webRequestListenersInstalled = true;
  }

  /**
   * Remove all request listeners
   * Only remove listeners when all tab captures have stopped
   */
  private removeListeners(): void {
    // Don't remove listeners if there are still tabs being captured
    if (this.captureData.size > 0) {
      console.log(
        `NetworkCaptureV2: Still capturing on ${this.captureData.size} tabs, not removing listeners.`,
      );
      return;
    }

    console.log(`NetworkCaptureV2: No more active captures, removing all listeners.`);

    if (this.listeners.onBeforeRequest) {
      chrome.webRequest.onBeforeRequest.removeListener(this.listeners.onBeforeRequest);
    }

    if (this.listeners.onSendHeaders) {
      chrome.webRequest.onSendHeaders.removeListener(this.listeners.onSendHeaders);
    }

    if (this.listeners.onHeadersReceived) {
      chrome.webRequest.onHeadersReceived.removeListener(this.listeners.onHeadersReceived);
    }

    if (this.listeners.onCompleted) {
      chrome.webRequest.onCompleted.removeListener(this.listeners.onCompleted);
    }

    if (this.listeners.onErrorOccurred) {
      chrome.webRequest.onErrorOccurred.removeListener(this.listeners.onErrorOccurred);
    }

    // Clear listener object
    this.listeners = {};
    this.webRequestListenersInstalled = false;
  }

  private buildEndpointDiagnostics(requests: NetworkRequestInfo[]) {
    const filteredCounts: Record<EndpointNoiseClass, number> = {
      asset: 0,
      analytics: 0,
      auth: 0,
      private: 0,
      telemetry: 0,
      usable: 0,
      unknown: 0,
    };
    for (const req of requests) {
      filteredCounts[
        classifyNetworkCaptureEndpoint({
          url: req.url,
          method: req.method,
          type: req.type,
          mimeType: req.mimeType,
        })
      ] += 1;
    }
    return {
      filteredCounts,
      usableCandidateCount: filteredCounts.usable,
      reason: filteredCounts.usable > 0 ? 'usable_endpoint_found' : 'no_usable_endpoint_found',
    };
  }

  private buildEndpointCandidates(requests: NetworkRequestInfo[]) {
    return requests.map((req) => {
      let parsed: URL | null = null;
      try {
        parsed = new URL(req.url);
      } catch {
        parsed = null;
      }
      const requestHeaderNames = Object.keys(req.specificRequestHeaders ?? {}).sort();
      const responseHeaderNames = Object.keys(req.specificResponseHeaders ?? {}).sort();
      return {
        method: req.method,
        host: parsed?.hostname.toLowerCase() ?? null,
        pathPattern: parsed?.pathname ?? null,
        queryKeys: parsed ? Array.from(parsed.searchParams.keys()).sort() : [],
        resourceType: req.type,
        status: req.status ?? null,
        timingMs:
          typeof req.responseTime === 'number' && typeof req.requestTime === 'number'
            ? Math.max(0, Math.round(req.responseTime - req.requestTime))
            : null,
        sizeClass: this.sizeClass(req.responseSize),
        contentType: req.mimeType ? req.mimeType.split(';')[0]?.trim() || null : null,
        headerNames: Array.from(new Set([...requestHeaderNames, ...responseHeaderNames])).sort(),
        noiseClass: classifyNetworkCaptureEndpoint({
          url: req.url,
          method: req.method,
          type: req.type,
          mimeType: req.mimeType,
        }),
      };
    });
  }

  private sizeClass(size: number | undefined): 'empty' | 'small' | 'medium' | 'large' | 'unknown' {
    if (typeof size !== 'number' || !Number.isFinite(size)) return 'unknown';
    if (size <= 0) return 'empty';
    if (size <= 10_000) return 'small';
    if (size <= 250_000) return 'medium';
    return 'large';
  }

  private attachSafeResponseSummaries(
    requests: NetworkRequestInfo[],
    summaries: BrowserContextSafeResponseSummary[],
  ): void {
    const byKey = new Map<string, BrowserContextSafeResponseSummary[]>();
    for (const summary of summaries) {
      const key = `${summary.method} ${summary.url}`;
      const bucket = byKey.get(key) ?? [];
      bucket.push(summary);
      byKey.set(key, bucket);
    }
    for (const req of requests) {
      const redactedUrl = redactNetworkCaptureUrlForMetadata(req.url);
      const key = `${String(req.method || 'GET').toUpperCase()} ${redactedUrl}`;
      const bucket = byKey.get(key);
      if (!bucket || bucket.length === 0) continue;
      req.safeResponseSummary = bucket.shift();
    }
  }

  /**
   * Start network request capture for specified tab
   * @param tabId Tab ID
   * @param options Capture options
   */
  private async startCaptureForTab(
    tabId: number,
    options: {
      maxCaptureTime: number;
      inactivityTimeout: number;
      includeStatic: boolean;
    },
  ): Promise<ResponseSummarySamplerArmResult> {
    const { maxCaptureTime, inactivityTimeout, includeStatic } = options;

    // If already capturing, stop first
    if (this.captureData.has(tabId)) {
      console.log(
        `NetworkCaptureV2: Already capturing on tab ${tabId}. Stopping previous session.`,
      );
      await this.stopCapture(tabId);
    }

    try {
      // Get tab information
      const tab = await chrome.tabs.get(tabId);

      // Initialize capture data
      this.captureData.set(tabId, {
        tabId: tabId,
        tabUrl: tab.url ? redactNetworkCaptureUrlForMetadata(tab.url) : '',
        tabTitle: tab.title || '',
        startTime: Date.now(),
        requests: {},
        maxCaptureTime,
        inactivityTimeout,
        includeStatic,
        limitReached: false,
      });

      // Initialize request counter
      this.requestCounters.set(tabId, 0);

      // Set up listeners
      this.setupListeners();

      const captureInfo = this.captureData.get(tabId);
      if (!captureInfo) {
        throw new Error('capture_info_missing_after_listener_setup');
      }
      const samplerArm = await responseSummarySampler.armForTab(tabId, {
        ttlMs: maxCaptureTime > 0 ? maxCaptureTime : undefined,
      });
      captureInfo.responseSummarySampler = samplerArm;
      if (!samplerArm.ok) {
        this.cleanupCapture(tabId);
        throw new Error(
          JSON.stringify({
            success: false,
            fallbackCause: samplerArm.fallbackCause ?? 'sampler_arm_failed',
            responseSummarySource: 'not_available',
            bridgePath: samplerArm.bridgePath,
            rawBodyPersisted: false,
          }),
        );
      }

      // Update last activity time
      this.updateLastActivityTime(tabId);

      console.log(
        `NetworkCaptureV2: Started capture for tab ${tabId} (${tab.url}). Max requests: ${NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE}, Max time: ${maxCaptureTime}ms, Inactivity: ${inactivityTimeout}ms. Response sampler armed: ${samplerArm.samplerId}.`,
      );

      // Set maximum capture time
      if (maxCaptureTime > 0) {
        this.captureTimers.set(
          tabId,
          setTimeout(async () => {
            console.log(
              `NetworkCaptureV2: Max capture time (${maxCaptureTime}ms) reached for tab ${tabId}.`,
            );
            await this.stopCapture(tabId);
          }, maxCaptureTime),
        );
      }
      return samplerArm;
    } catch (error: any) {
      console.error(`NetworkCaptureV2: Error starting capture for tab ${tabId}:`, error);

      // Clean up resources
      if (this.captureData.has(tabId)) {
        this.cleanupCapture(tabId);
        this.removeListeners();
      }

      throw error;
    }
  }

  /**
   * Stop capture
   * @param tabId Tab ID
   */
  public async stopCapture(
    tabId: number,
  ): Promise<{ success: boolean; message?: string; data?: any }> {
    const captureInfo = this.captureData.get(tabId);
    if (!captureInfo) {
      console.log(`NetworkCaptureV2: No capture in progress for tab ${tabId}`);
      return { success: false, message: `No capture in progress for tab ${tabId}` };
    }

    try {
      // Record end time
      captureInfo.endTime = Date.now();

      // Extract common request and response headers
      const requestsArray = Object.values(captureInfo.requests);
      const samplerFlush = await responseSummarySampler.disarmForTab(tabId, 'capture_stop');
      this.attachSafeResponseSummaries(requestsArray, samplerFlush.summaries);
      const commonRequestHeaders = this.analyzeCommonHeaders(requestsArray, 'requestHeaders');
      const commonResponseHeaders = this.analyzeCommonHeaders(requestsArray, 'responseHeaders');

      // Process request data, remove common headers
      const processedRequests = requestsArray.map((req) => {
        const finalReq: NetworkRequestInfo = { ...req };
        finalReq.url = redactNetworkCaptureUrlForMetadata(finalReq.url);
        delete finalReq.requestBody;
        delete finalReq.responseBody;

        if (finalReq.requestHeaders) {
          finalReq.specificRequestHeaders = this.filterOutCommonHeaders(
            finalReq.requestHeaders,
            commonRequestHeaders,
          );
          finalReq.specificRequestHeaders = sanitizeNetworkCaptureHeaders(
            finalReq.specificRequestHeaders,
          );
          delete finalReq.requestHeaders;
        } else {
          finalReq.specificRequestHeaders = {};
        }

        if (finalReq.responseHeaders) {
          finalReq.specificResponseHeaders = this.filterOutCommonHeaders(
            finalReq.responseHeaders,
            commonResponseHeaders,
          );
          finalReq.specificResponseHeaders = sanitizeNetworkCaptureHeaders(
            finalReq.specificResponseHeaders,
          );
          delete finalReq.responseHeaders;
        } else {
          finalReq.specificResponseHeaders = {};
        }

        return finalReq;
      });

      // Sort by time
      processedRequests.sort((a, b) => (a.requestTime || 0) - (b.requestTime || 0));

      // Remove listeners
      this.removeListeners();

      // Prepare result data
      const resultData = {
        captureStartTime: captureInfo.startTime,
        captureEndTime: captureInfo.endTime,
        totalDurationMs: captureInfo.endTime - captureInfo.startTime,
        settingsUsed: {
          maxCaptureTime: captureInfo.maxCaptureTime,
          inactivityTimeout: captureInfo.inactivityTimeout,
          includeStatic: captureInfo.includeStatic,
          maxRequests: NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE,
        },
        commonRequestHeaders: sanitizeNetworkCaptureHeaders(commonRequestHeaders),
        commonResponseHeaders: sanitizeNetworkCaptureHeaders(commonResponseHeaders),
        requests: processedRequests,
        endpointCandidates: this.buildEndpointCandidates(processedRequests),
        endpointDiagnostics: this.buildEndpointDiagnostics(processedRequests),
        requestCount: processedRequests.length,
        totalRequestsReceived: this.requestCounters.get(tabId) || 0,
        requestLimitReached: captureInfo.limitReached || false,
        tabUrl: captureInfo.tabUrl,
        tabTitle: captureInfo.tabTitle,
        responseSummarySampler: captureInfo.responseSummarySampler ?? {
          ok: false,
          samplerId: '',
          samplerArmedAt: null,
          fallbackCause: 'sampler_not_armed',
          bridgePath: 'not_available',
        },
        responseSummaryLifecycle: samplerFlush.lifecycle,
      };

      // Clean up resources
      this.cleanupCapture(tabId);

      return {
        success: true,
        data: resultData,
      };
    } catch (error: any) {
      console.error(`NetworkCaptureV2: Error stopping capture for tab ${tabId}:`, error);

      // Ensure resources are cleaned up
      this.cleanupCapture(tabId);

      return {
        success: false,
        message: `Error stopping capture: ${error.message || String(error)}`,
      };
    }
  }

  /**
   * Analyze common request or response headers
   */
  private analyzeCommonHeaders(
    requests: NetworkRequestInfo[],
    headerType: 'requestHeaders' | 'responseHeaders',
  ): Record<string, string> {
    if (!requests || requests.length === 0) return {};

    // Find headers that are included in all requests
    const commonHeaders: Record<string, string> = {};
    const firstRequestWithHeaders = requests.find(
      (req) => req[headerType] && Object.keys(req[headerType] || {}).length > 0,
    );

    if (!firstRequestWithHeaders || !firstRequestWithHeaders[headerType]) {
      return {};
    }

    // Get all headers from the first request
    const headers = firstRequestWithHeaders[headerType] as Record<string, string>;
    const headerNames = Object.keys(headers);

    // Check if each header exists in all requests with the same value
    for (const name of headerNames) {
      const value = headers[name];
      const isCommon = requests.every((req) => {
        const reqHeaders = req[headerType] as Record<string, string>;
        return reqHeaders && reqHeaders[name] === value;
      });

      if (isCommon) {
        commonHeaders[name] = value;
      }
    }

    return commonHeaders;
  }

  /**
   * Filter out common headers
   */
  private filterOutCommonHeaders(
    headers: Record<string, string>,
    commonHeaders: Record<string, string>,
  ): Record<string, string> {
    if (!headers || typeof headers !== 'object') return {};

    const specificHeaders: Record<string, string> = {};
    // Use Object.keys to avoid ESLint no-prototype-builtins warning
    Object.keys(headers).forEach((name) => {
      if (!(name in commonHeaders) || headers[name] !== commonHeaders[name]) {
        specificHeaders[name] = headers[name];
      }
    });

    return specificHeaders;
  }

  async execute(args: NetworkCaptureStartToolParams): Promise<ToolResult> {
    const {
      url: targetUrl,
      maxCaptureTime = 3 * 60 * 1000, // Default 3 minutes
      inactivityTimeout = 60 * 1000, // Default 1 minute of inactivity before auto-stop
      includeStatic = false, // Default: don't include static resources
      tabId: requestedTabId,
      windowId,
    } = args;

    console.log(`NetworkCaptureStartTool: Executing with args:`, args);

    // V26-FIX-02 — observe-mode gate (defense in depth). The chooser
    // advisory primarily flows through the native-server side, but a
    // stale upstream caller could still issue `chrome_network_capture_start`
    // when the advisory said `disabled`/`background`. The gate
    // short-circuits with a structured success payload so MCP
    // clients see a clean tool result instead of a webRequest listener
    // install round-trip.
    const observeModeOverride = getNetworkCaptureObserveModeOverride();
    const gate = evaluateNetworkCaptureObserveModeGate(observeModeOverride);
    if (gate.action === 'skip') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              skipped: true,
              observeMode: observeModeOverride,
              skipReason: gate.reason,
              message:
                'Network capture suppressed by chooser advisory (V26-FIX-02). No listeners installed.',
            }),
          },
        ],
        isError: false,
      };
    }

    try {
      // Get current tab or create new tab
      let tabToOperateOn: chrome.tabs.Tab;

      if (targetUrl) {
        // Find tabs matching the URL
        const matchingTabs = await chrome.tabs.query({ url: targetUrl });

        if (matchingTabs.length > 0) {
          // Use existing tab
          tabToOperateOn = matchingTabs[0];
          console.log(`NetworkCaptureV2: Found existing tab with URL: ${targetUrl}`);
        } else {
          // Create new tab
          console.log(`NetworkCaptureV2: Creating new tab with URL: ${targetUrl}`);
          tabToOperateOn = await chrome.tabs.create({ url: targetUrl, active: true });

          // Wait for page to load
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        const explicit = await this.tryGetTab(requestedTabId);
        tabToOperateOn = explicit || (await this.getActiveTabOrThrowInWindow(windowId));
      }

      if (!tabToOperateOn?.id) {
        return createErrorResponse('Failed to identify or create a tab');
      }

      // Use startCaptureForTab method to start capture
      let samplerArm: ResponseSummarySamplerArmResult;
      try {
        samplerArm = await this.startCaptureForTab(tabToOperateOn.id, {
          maxCaptureTime,
          inactivityTimeout,
          includeStatic,
        });
      } catch (error: any) {
        const rawMessage = error.message || String(error);
        let fallbackPayload: unknown = null;
        try {
          fallbackPayload = JSON.parse(rawMessage);
        } catch {
          fallbackPayload = {
            success: false,
            fallbackCause: 'sampler_arm_failed',
            responseSummarySource: 'not_available',
            bridgePath: 'not_available',
            rawBodyPersisted: false,
            message: rawMessage,
          };
        }
        return createErrorResponse(JSON.stringify(fallbackPayload));
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Network capture V2 started successfully, waiting for stop command.',
              tabId: tabToOperateOn.id,
              url: tabToOperateOn.url ? redactNetworkCaptureUrlForMetadata(tabToOperateOn.url) : '',
              maxCaptureTime,
              inactivityTimeout,
              includeStatic,
              maxRequests: NetworkCaptureStartTool.MAX_REQUESTS_PER_CAPTURE,
              responseSummarySampler: samplerArm,
              responseSummarySource: 'browser_context_summary',
              bridgePath: samplerArm.bridgePath,
              rawBodyPersisted: false,
            }),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('NetworkCaptureStartTool: Critical error:', error);
      return createErrorResponse(
        `Error in NetworkCaptureStartTool: ${error.message || String(error)}`,
      );
    }
  }
}

/**
 * Network capture stop tool V2 - Stop webRequest API capture and return results
 */
class NetworkCaptureStopTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP;
  public static instance: NetworkCaptureStopTool | null = null;

  constructor() {
    super();
    if (NetworkCaptureStopTool.instance) {
      return NetworkCaptureStopTool.instance;
    }
    NetworkCaptureStopTool.instance = this;
  }

  async execute(args?: NetworkCaptureStopToolParams): Promise<ToolResult> {
    console.log(`NetworkCaptureStopTool: Executing`);

    // V26-FIX-02 — observe-mode gate. When the start tool was
    // suppressed by the chooser advisory, the matching stop call has
    // nothing to stop; emit a structured no-op rather than the legacy
    // "no captures" error so MCP clients see the suppression as
    // expected behaviour.
    const observeModeOverride = getNetworkCaptureObserveModeOverride();
    const gate = evaluateNetworkCaptureObserveModeGate(observeModeOverride);
    if (gate.action === 'skip') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              skipped: true,
              observeMode: observeModeOverride,
              skipReason: gate.reason,
              message:
                'Network capture stop suppressed by chooser advisory (V26-FIX-02). Nothing to stop.',
            }),
          },
        ],
        isError: false,
      };
    }

    try {
      const startTool = NetworkCaptureStartTool.instance;

      if (!startTool) {
        return createErrorResponse('Network capture V2 start tool instance not found');
      }

      // Get all tabs currently capturing
      const ongoingCaptures = Array.from(startTool.captureData.keys());
      console.log(
        `NetworkCaptureStopTool: Found ${ongoingCaptures.length} ongoing captures: ${ongoingCaptures.join(', ')}`,
      );

      if (ongoingCaptures.length === 0) {
        return createErrorResponse('No active network captures found in any tab.');
      }

      const requestedTabId = args?.tabId;
      const windowId = args?.windowId;

      let primaryTabId: number;

      if (typeof requestedTabId === 'number') {
        if (!startTool.captureData.has(requestedTabId)) {
          return createErrorResponse(
            `No active network capture on tab ${requestedTabId}. Capturing tabs: ${ongoingCaptures.join(', ')}`,
          );
        }
        primaryTabId = requestedTabId;
        console.log(`NetworkCaptureStopTool: Stopping explicitly requested tab ${primaryTabId}.`);
      } else {
        const activeTab = await this.getActiveTabInWindow(windowId);
        const activeTabId = activeTab?.id;

        if (activeTabId && startTool.captureData.has(activeTabId)) {
          primaryTabId = activeTabId;
          console.log(
            `NetworkCaptureStopTool: Active tab ${activeTabId} is capturing, will stop it first.`,
          );
        } else if (ongoingCaptures.length === 1) {
          primaryTabId = ongoingCaptures[0];
          console.log(
            `NetworkCaptureStopTool: Only one tab ${primaryTabId} is capturing, stopping it.`,
          );
        } else {
          primaryTabId = ongoingCaptures[0];
          console.log(
            `NetworkCaptureStopTool: Multiple tabs capturing, active tab not among them. Stopping tab ${primaryTabId} first.`,
          );
        }
      }

      const stopResult = await startTool.stopCapture(primaryTabId);

      if (!stopResult.success) {
        return createErrorResponse(
          stopResult.message || `Failed to stop network capture for tab ${primaryTabId}`,
        );
      }

      // If multiple tabs are capturing, stop other tabs
      if (ongoingCaptures.length > 1) {
        const otherTabIds = ongoingCaptures.filter((id) => id !== primaryTabId);
        console.log(
          `NetworkCaptureStopTool: Stopping ${otherTabIds.length} additional captures: ${otherTabIds.join(', ')}`,
        );

        for (const tabId of otherTabIds) {
          try {
            await startTool.stopCapture(tabId);
          } catch (error) {
            console.error(`NetworkCaptureStopTool: Error stopping capture on tab ${tabId}:`, error);
          }
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Capture complete. ${stopResult.data?.requestCount || 0} requests captured.`,
              tabId: primaryTabId,
              tabUrl: stopResult.data?.tabUrl || 'N/A',
              tabTitle: stopResult.data?.tabTitle || 'Unknown Tab',
              requestCount: stopResult.data?.requestCount || 0,
              commonRequestHeaders: stopResult.data?.commonRequestHeaders || {},
              commonResponseHeaders: stopResult.data?.commonResponseHeaders || {},
              requests: stopResult.data?.requests || [],
              responseSummarySampler: stopResult.data?.responseSummarySampler,
              responseSummaryLifecycle: stopResult.data?.responseSummaryLifecycle,
              captureStartTime: stopResult.data?.captureStartTime,
              captureEndTime: stopResult.data?.captureEndTime,
              totalDurationMs: stopResult.data?.totalDurationMs,
              settingsUsed: stopResult.data?.settingsUsed || {},
              totalRequestsReceived: stopResult.data?.totalRequestsReceived || 0,
              requestLimitReached: stopResult.data?.requestLimitReached || false,
              remainingCaptures: Array.from(startTool.captureData.keys()),
            }),
          },
        ],
        isError: false,
      };
    } catch (error: any) {
      console.error('NetworkCaptureStopTool: Critical error:', error);
      return createErrorResponse(
        `Error in NetworkCaptureStopTool: ${error.message || String(error)}`,
      );
    }
  }
}

export const networkCaptureStartTool = new NetworkCaptureStartTool();
export const networkCaptureStopTool = new NetworkCaptureStopTool();
