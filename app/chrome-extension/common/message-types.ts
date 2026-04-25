/**
 * Consolidated message type constants for Chrome extension communication
 * Note: Native message types are imported from the shared package
 */

// Message targets for routing
export enum MessageTarget {
  Offscreen = 'offscreen',
  ContentScript = 'content_script',
  Background = 'background',
}

// Background script message types
export const BACKGROUND_MESSAGE_TYPES = {
  GET_SERVER_STATUS: 'get_server_status',
  REFRESH_SERVER_STATUS: 'refresh_server_status',
  SERVER_STATUS_CHANGED: 'server_status_changed',
} as const;

// Offscreen message types
export const OFFSCREEN_MESSAGE_TYPES = {
  // GIF encoding (other offscreen-hosted engines were removed as part of MKEP pruning).
  GIF_ADD_FRAME: 'gifAddFrame',
  GIF_FINISH: 'gifFinish',
  GIF_RESET: 'gifReset',
} as const;

// Content script message types
export const CONTENT_MESSAGE_TYPES = {
  WEB_FETCHER_GET_TEXT_CONTENT: 'webFetcherGetTextContent',
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  NETWORK_CAPTURE_PING: 'network_capture_ping',
  CLICK_HELPER_PING: 'click_helper_ping',
  FILL_HELPER_PING: 'fill_helper_ping',
  KEYBOARD_HELPER_PING: 'keyboard_helper_ping',
  SCREENSHOT_HELPER_PING: 'screenshot_helper_ping',
  INTERACTIVE_ELEMENTS_HELPER_PING: 'interactive_elements_helper_ping',
  ACCESSIBILITY_TREE_HELPER_PING: 'chrome_read_page_ping',
  WAIT_HELPER_PING: 'wait_helper_ping',
  DOM_OBSERVER_PING: 'dom_observer_ping',
} as const;

// Tool action message types (for chrome.runtime.sendMessage)
export const TOOL_MESSAGE_TYPES = {
  // Screenshot related
  SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE: 'preparePageForCapture',
  SCREENSHOT_GET_PAGE_DETAILS: 'getPageDetails',
  SCREENSHOT_GET_ELEMENT_DETAILS: 'getElementDetails',
  SCREENSHOT_SCROLL_PAGE: 'scrollPage',
  SCREENSHOT_RESET_PAGE_AFTER_CAPTURE: 'resetPageAfterCapture',

  // Web content fetching
  WEB_FETCHER_GET_HTML_CONTENT: 'getHtmlContent',
  WEB_FETCHER_GET_TEXT_CONTENT: 'getTextContent',

  // User interactions
  CLICK_ELEMENT: 'clickElement',
  FILL_ELEMENT: 'fillElement',
  SIMULATE_KEYBOARD: 'simulateKeyboard',

  // Interactive elements
  GET_INTERACTIVE_ELEMENTS: 'getInteractiveElements',

  // Accessibility tree
  GENERATE_ACCESSIBILITY_TREE: 'generateAccessibilityTree',
  RESOLVE_REF: 'resolveRef',
  ENSURE_REF_FOR_SELECTOR: 'ensureRefForSelector',
  VERIFY_FINGERPRINT: 'verifyFingerprint',
  DISPATCH_HOVER_FOR_REF: 'dispatchHoverForRef',

  // Network requests
  NETWORK_SEND_REQUEST: 'sendPureNetworkRequest',

  // Wait helper
  WAIT_FOR_TEXT: 'waitForText',
} as const;

// Type unions for type safety
export type BackgroundMessageType =
  (typeof BACKGROUND_MESSAGE_TYPES)[keyof typeof BACKGROUND_MESSAGE_TYPES];
export type OffscreenMessageType =
  (typeof OFFSCREEN_MESSAGE_TYPES)[keyof typeof OFFSCREEN_MESSAGE_TYPES];
export type ContentMessageType = (typeof CONTENT_MESSAGE_TYPES)[keyof typeof CONTENT_MESSAGE_TYPES];
export type ToolMessageType = (typeof TOOL_MESSAGE_TYPES)[keyof typeof TOOL_MESSAGE_TYPES];

// Legacy enum for backward compatibility (will be deprecated)
export enum SendMessageType {
  // Screenshot related message types
  ScreenshotPreparePageForCapture = 'preparePageForCapture',
  ScreenshotGetPageDetails = 'getPageDetails',
  ScreenshotGetElementDetails = 'getElementDetails',
  ScreenshotScrollPage = 'scrollPage',
  ScreenshotResetPageAfterCapture = 'resetPageAfterCapture',

  // Web content fetching related message types
  WebFetcherGetHtmlContent = 'getHtmlContent',
  WebFetcherGetTextContent = 'getTextContent',

  // Click related message types
  ClickElement = 'clickElement',

  // Input filling related message types
  FillElement = 'fillElement',

  // Interactive elements related message types
  GetInteractiveElements = 'getInteractiveElements',

  // Network request capture related message types
  NetworkSendRequest = 'sendPureNetworkRequest',

  // Keyboard event related message types
  SimulateKeyboard = 'simulateKeyboard',
}

// ============================================================
// Quick Panel / AgentChat message contracts were removed as part of the
// MKEP pruning removed the legacy element marker surface. The file keeps
// only the cross-surface message enums that non-agent features still
// use (extension <-> native host, MKEP viewers etc.).
// ============================================================
