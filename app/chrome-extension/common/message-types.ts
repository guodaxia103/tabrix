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
  SWITCH_SEMANTIC_MODEL: 'switch_semantic_model',
  GET_MODEL_STATUS: 'get_model_status',
  UPDATE_MODEL_STATUS: 'update_model_status',
  GET_STORAGE_STATS: 'get_storage_stats',
  CLEAR_ALL_DATA: 'clear_all_data',
  GET_SERVER_STATUS: 'get_server_status',
  REFRESH_SERVER_STATUS: 'refresh_server_status',
  SERVER_STATUS_CHANGED: 'server_status_changed',
  INITIALIZE_SEMANTIC_ENGINE: 'initialize_semantic_engine',
  // Record & Replay background control and queries
  RR_START_RECORDING: 'rr_start_recording',
  RR_STOP_RECORDING: 'rr_stop_recording',
  RR_PAUSE_RECORDING: 'rr_pause_recording',
  RR_RESUME_RECORDING: 'rr_resume_recording',
  RR_GET_RECORDING_STATUS: 'rr_get_recording_status',
  RR_LIST_FLOWS: 'rr_list_flows',
  RR_FLOWS_CHANGED: 'rr_flows_changed',
  RR_GET_FLOW: 'rr_get_flow',
  RR_DELETE_FLOW: 'rr_delete_flow',
  RR_PUBLISH_FLOW: 'rr_publish_flow',
  RR_UNPUBLISH_FLOW: 'rr_unpublish_flow',
  RR_RUN_FLOW: 'rr_run_flow',
  RR_SAVE_FLOW: 'rr_save_flow',
  RR_EXPORT_FLOW: 'rr_export_flow',
  RR_EXPORT_ALL: 'rr_export_all',
  RR_IMPORT_FLOW: 'rr_import_flow',
  RR_LIST_RUNS: 'rr_list_runs',
  // Triggers
  RR_LIST_TRIGGERS: 'rr_list_triggers',
  RR_SAVE_TRIGGER: 'rr_save_trigger',
  RR_DELETE_TRIGGER: 'rr_delete_trigger',
  RR_REFRESH_TRIGGERS: 'rr_refresh_triggers',
  // Scheduling
  RR_SCHEDULE_FLOW: 'rr_schedule_flow',
  RR_UNSCHEDULE_FLOW: 'rr_unschedule_flow',
  RR_LIST_SCHEDULES: 'rr_list_schedules',
} as const;

// Offscreen message types
export const OFFSCREEN_MESSAGE_TYPES = {
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE: 'similarityEngineCompute',
  SIMILARITY_ENGINE_BATCH_COMPUTE: 'similarityEngineBatchCompute',
  SIMILARITY_ENGINE_STATUS: 'similarityEngineStatus',
  // GIF encoding
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

  // Semantic similarity engine
  SIMILARITY_ENGINE_INIT: 'similarityEngineInit',
  SIMILARITY_ENGINE_COMPUTE_BATCH: 'similarityEngineComputeBatch',
  // Record & Replay content script bridge
  RR_RECORDER_CONTROL: 'rr_recorder_control',
  RR_RECORDER_EVENT: 'rr_recorder_event',
  // Record & Replay timeline feed (background -> content overlay)
  RR_TIMELINE_UPDATE: 'rr_timeline_update',
  // DOM observer trigger bridge
  SET_DOM_TRIGGERS: 'set_dom_triggers',
  DOM_TRIGGER_FIRED: 'dom_trigger_fired',
  // Record & Replay overlay: variable collection
  COLLECT_VARIABLES: 'collectVariables',
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

  // Semantic similarity engine related message types
  SimilarityEngineInit = 'similarityEngineInit',
  SimilarityEngineComputeBatch = 'similarityEngineComputeBatch',
}

// ============================================================
// Quick Panel / AgentChat message contracts were removed as part of the
// MKEP pruning (see docs/PRODUCT_PRUNING_PLAN.md §P2). The file keeps
// only the cross-surface message enums that non-agent features still
// use (extension <-> native host, element marker, record-replay etc.).
// ============================================================
