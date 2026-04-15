/**
 * Chrome Extension i18n utility
 * Provides safe access to chrome.i18n.getMessage with fallbacks
 */

// Fallback messages for when Chrome APIs aren't available (English)
const fallbackMessages: Record<string, string> = {
  // Extension metadata
  extensionName: 'Tabrix',
  extensionDescription: 'Expose your own Chrome browser as an MCP service',

  // Section headers
  nativeServerConfigLabel: 'Native Server Configuration',
  semanticEngineLabel: 'Semantic Engine',
  embeddingModelLabel: 'Embedding Model',
  indexDataManagementLabel: 'Index Data Management',
  modelCacheManagementLabel: 'Model Cache Management',

  // Status labels
  statusLabel: 'Status',
  runningStatusLabel: 'Running Status',
  connectionStatusLabel: 'Connection Status',
  lastUpdatedLabel: 'Last Updated:',

  // Connection states
  connectButton: 'Connect',
  disconnectButton: 'Disconnect',
  connectingStatus: 'Connecting...',
  connectedStatus: 'Connected',
  disconnectedStatus: 'Disconnected',
  detectingStatus: 'Detecting...',

  // Server states
  serviceRunningStatus: 'Service Running (Port: {0})',
  serviceNotConnectedStatus: 'Service Not Connected',
  connectedServiceNotStartedStatus: 'Connected, Service Not Started',

  // Configuration labels
  mcpServerConfigLabel: 'MCP Configuration',
  connectionPortLabel: 'Connection Port',
  refreshStatusButton: 'Refresh Status',
  copyConfigButton: 'Copy Configuration',

  // Action buttons
  retryButton: 'Retry',
  cancelButton: 'Cancel',
  confirmButton: 'Confirm',
  saveButton: 'Save',
  closeButton: 'Close',
  resetButton: 'Reset',

  // Progress states
  initializingStatus: 'Initializing...',
  processingStatus: 'Processing...',
  loadingStatus: 'Loading...',
  clearingStatus: 'Clearing...',
  cleaningStatus: 'Cleaning...',
  downloadingStatus: 'Downloading...',

  // Semantic engine states
  semanticEngineReadyStatus: 'Semantic Engine Ready',
  semanticEngineInitializingStatus: 'Semantic Engine Initializing...',
  semanticEngineInitFailedStatus: 'Semantic Engine Initialization Failed',
  semanticEngineNotInitStatus: 'Semantic Engine Not Initialized',
  initSemanticEngineButton: 'Initialize Semantic Engine',
  reinitializeButton: 'Reinitialize',

  // Model states
  downloadingModelStatus: 'Downloading Model... {0}%',
  switchingModelStatus: 'Switching Model...',
  modelLoadedStatus: 'Model Loaded',
  modelFailedStatus: 'Model Failed to Load',

  // Model descriptions
  lightweightModelDescription: 'Lightweight Multilingual Model',
  betterThanSmallDescription: 'Slightly larger than e5-small, but better performance',
  multilingualModelDescription: 'Multilingual Semantic Model',

  // Performance levels
  fastPerformance: 'Fast',
  balancedPerformance: 'Balanced',
  accuratePerformance: 'Accurate',

  // Error messages
  networkErrorMessage: 'Network connection error, please check network and retry',
  modelCorruptedErrorMessage: 'Model file corrupted or incomplete, please retry download',
  unknownErrorMessage: 'Unknown error, please check if your network can access HuggingFace',
  permissionDeniedErrorMessage: 'Permission denied',
  timeoutErrorMessage: 'Operation timed out',

  // Data statistics
  indexedPagesLabel: 'Indexed Pages',
  indexSizeLabel: 'Index Size',
  activeTabsLabel: 'Active Tabs',
  vectorDocumentsLabel: 'Vector Documents',
  cacheSizeLabel: 'Cache Size',
  cacheEntriesLabel: 'Cache Entries',

  // Data management
  clearAllDataButton: 'Clear All Data',
  clearAllCacheButton: 'Clear All Cache',
  cleanExpiredCacheButton: 'Clean Expired Cache',
  exportDataButton: 'Export Data',
  importDataButton: 'Import Data',

  // Dialog titles
  confirmClearDataTitle: 'Confirm Clear Data',
  settingsTitle: 'Settings',
  aboutTitle: 'About',
  helpTitle: 'Help',

  // Dialog messages
  clearDataWarningMessage:
    'This operation will clear all indexed webpage content and vector data, including:',
  clearDataList1: 'All webpage text content index',
  clearDataList2: 'Vector embedding data',
  clearDataList3: 'Search history and cache',
  clearDataIrreversibleWarning:
    'This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.',
  confirmClearButton: 'Confirm Clear',

  // Cache states
  cacheDetailsLabel: 'Cache Details',
  noCacheDataMessage: 'No cache data',
  loadingCacheInfoStatus: 'Loading cache information...',
  processingCacheStatus: 'Processing cache...',
  expiredLabel: 'Expired',

  // Browser integration
  bookmarksBarLabel: 'Bookmarks Bar',
  newTabLabel: 'New Tab',
  currentPageLabel: 'Current Page',

  // Accessibility
  menuLabel: 'Menu',
  navigationLabel: 'Navigation',
  mainContentLabel: 'Main Content',

  // Future features
  languageSelectorLabel: 'Language',
  themeLabel: 'Theme',
  lightTheme: 'Light',
  darkTheme: 'Dark',
  autoTheme: 'Auto',
  advancedSettingsLabel: 'Advanced Settings',
  debugModeLabel: 'Debug Mode',
  verboseLoggingLabel: 'Verbose Logging',

  // Notifications
  successNotification: 'Operation completed successfully',
  warningNotification: 'Warning: Please review before proceeding',
  infoNotification: 'Information',
  configCopiedNotification: 'Configuration copied to clipboard',
  dataClearedNotification: 'Data cleared successfully',

  // Popup page
  popupOpenTroubleshootingGuide: 'Open Troubleshooting Guide',
  popupActiveClientsLabel: 'Active clients ({0})',
  popupConnectedClientsLabel: 'Connected clients ({0})',
  popupClientLastSeenLabel: '{0}',
  popupClientSessionsLabel: '{0} session(s)',
  popupClientLocalHttpLabel: 'Local · HTTP (no token)',
  popupClientRemoteHttpLabel: 'Remote · HTTP · {0}',
  popupClientLocalSseLabel: 'Local · SSE',
  popupClientRemoteSseLabel: 'Remote · SSE · {0}',
  popupRefreshClientsTitle: 'Refresh client list',
  popupUnknownClient: 'Unknown client',
  popupGenericMcpClient: 'MCP client',
  popupDisconnectClientTitle: 'Disconnect this client',
  popupNoActiveClients: 'No active clients',
  popupNoConnectedClients: 'No MCP client connected',
  popupMcpConfigLabel: 'MCP Configuration',
  popupRemoteAccessTitle: 'Remote Access',
  popupNetworkLocalLabel: 'Local:',
  popupNetworkLanLabel: 'LAN:',
  popupRemoteConfigHint: 'Enable Remote Access to view MCP configuration for remote clients.',
  popupQuickToolsTitle: 'Quick Tools',
  popupRecordComingSoon: 'Recording feature is under development',
  popupEnableWebEditor: 'Enable Web Editor mode',
  popupEnableElementMarker: 'Enable element marker',
  popupManagementEntrancesTitle: 'Management',
  popupAgentAssistantTitle: 'AI Assistant',
  popupAgentAssistantDesc: 'AI Agent chat and tasks',
  popupWorkflowManagementTitle: 'Workflow Management',
  popupWorkflowManagementDesc: 'Record/replay automation flows',
  popupElementMarkerManagementTitle: 'Element Marker Management',
  popupElementMarkerManagementDesc: 'Manage page element markers',
  popupLocalModelTitle: 'Local Models',
  popupLocalModelDesc: 'Semantic engine and model management',
  popupTokenManagementTitle: 'Token Management',
  popupTokenManagementDesc: 'Remote auth, refresh and validity',
  popupTroubleshootingGuideTitle: 'Troubleshooting Guide',
  popupTroubleshootingGuideDesc:
    'Run commands in order. Then restart Chrome and reload the extension in chrome://extensions/.',
  popupCopyCommand: 'Copy',
  popupCopiedShort: 'Copied',
  popupCopiedFullScript: 'Copied full script',
  popupCopyFullTroubleshootScript: 'Copy all',
  popupOpenDocs: 'Docs',
  popupComingSoonSuffix: 'is under development, stay tuned',
  popupRecordReplayFeature: 'Record & Replay',
  popupJustNow: 'Just now',
  popupMinutesAgo: '{0} minute(s) ago',
  popupHoursAgo: '{0} hour(s) ago',
  popupCopyRepairCommand: 'Copy repair command',
  popupCopyFailed: 'Copy failed',
  popupRemoteSummaryNeedRunning:
    'Connect and start the local service before toggling Remote Access.',
  popupRemoteSummaryLocalOnly:
    'Currently local-only (127.0.0.1). Enable Remote Access to allow LAN clients to connect.',
  popupRemoteSummaryEnabledSecure:
    'Remote access is enabled (0.0.0.0). LAN clients can connect securely with Token.',
  popupRemoteSummaryAutoCreating:
    'Remote access is enabled. A default token is being created automatically.',
  popupRemoteSecurityWarning:
    'Remote mode requires Bearer Token. A default token is being created automatically, or generate one manually in Token Management.',
  popupRemoteTab: 'Remote',
  popupTabHintLocal: 'For local clients like Cursor / Claude Desktop / CherryStudio / Windsurf',
  popupTabHintStdio: 'For CLI clients like Claude Code CLI (npm i -g tabrix@latest first)',
  popupTabHintRemote: 'For remote hosts or Docker via LAN IP',
  popupLanIpPlaceholder: '<LAN_IP>',
  popupStatusDetailErrorDefault:
    'Last connection error: {0}. Try `tabrix doctor --fix`, then `tabrix register --force`, then fully restart Chrome and reload extension in chrome://extensions/.',
  popupStatusDetailDisconnectedWhileDaemon:
    'Local service is running, but browser channel is not connected. Click Connect to enable automation.',
  popupStatusDetailConnectedNoService:
    'Native host is connected, but local MCP service is not ready. Click Refresh first; if it still fails, run `tabrix doctor` and reload extension.',
  popupStatusDetailDisconnected:
    'If Connect still fails, run `tabrix doctor --fix` and `tabrix register --force`, then fully restart Chrome.',
  popupNativeGuidanceLastErrorPrefix: 'Last connection error: {0}',
  popupNativeGuidanceForbiddenDiagnosis:
    'Diagnosis: current extension ID is not in Native Messaging manifest.allowed_origins, or registry still points to an old manifest.',
  popupNativeGuidanceForbiddenSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if it still fails, run `tabrix register --force`, then fully restart Chrome and reload extension in chrome://extensions/.',
  popupNativeGuidanceHostMissingDiagnosis:
    'Diagnosis: Native host is not registered, path is invalid, or host startup failed.',
  popupNativeGuidanceHostMissingSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if needed, run `tabrix register --force`.',
  popupNativeGuidanceAuthDiagnosis:
    'Diagnosis: remote access token is missing, expired, or mismatched.',
  popupNativeGuidanceAuthSuggestion:
    'Suggestion: refresh/copy token in Popup > Remote, and configure Authorization header in your MCP client.',
  popupNativeGuidanceUnknownSuggestion:
    'Suggestion: run `tabrix doctor --fix`; if it still fails, run `tabrix register --force`, then fully restart Chrome.',
  popupTroubleshootQuickFixTitle: 'Current error fix',
  popupTroubleshootDoctorFixTitle: 'Auto-fix common issues',
  popupTroubleshootDaemonStartTitle: 'Start daemon (optional)',
  popupTroubleshootDaemonAutostartTitle: 'Install daemon auto-start on boot',
  popupTroubleshootRegisterForceTitle: 'Re-register Native Host',
  popupTroubleshootRemotePersistTitle: 'Persist remote mode (daemon/env)',
  popupTroubleshootRemotePersistNote:
    'Use the Remote tab toggle by default. This command is only for daemon-based persistent remote mode.',
  popupEnablingRemote: 'Enabling remote access...',
  popupDisablingRemote: 'Disabling remote access...',
  popupToggleFailedPrefix: 'Toggle failed:',
  popupRemoteRestoredLocalOnly: 'Restored to local-only access',
  popupRemoteEnabledWithToken: 'Remote access enabled; default token generated',
  popupRemoteEnabled: 'Remote access enabled',

  // Token management page
  tokenPageBackHomeTitle: 'Back to home',
  tokenPageBackLabel: 'Back',
  tokenPageCurrentTokenTitle: 'Current Token',
  tokenPageCopyTokenTitle: 'Copy token',
  tokenPageEnvTokenBadge:
    'Provided by MCP_AUTH_TOKEN environment variable (cannot be refreshed here)',
  tokenPageExpiryTimeLabel: 'Expires At',
  tokenPageTtlDaysLabel: 'TTL days when generated',
  tokenPageNeverExpire: 'Never expires',
  tokenPageDays: '{0} day(s)',
  tokenPageRegenerateTokenButton: 'Regenerate Token',
  tokenPageGenerateDefaultTokenButton: 'Generate default token',
  tokenPageNotesTitle: 'Notes',
  tokenPageNotesText:
    'You can set token validity days in the regenerate dialog. MCP_AUTH_TOKEN_TTL still controls default days on first auto-generation (default 7; 0 means never expire). Restart service after changing env vars.',
  tokenPageRemoteConfigTitle: 'Remote MCP Configuration (with Token)',
  tokenPageCopyFullConfigButton: 'Copy full configuration',
  tokenPageRegenerateConfirmTitle: 'Regenerate Token?',
  tokenPageRegenerateConfirmItem: 'Saved new token or confirmed all clients can be updated now',
  tokenPageRegenerateConfirmWarning: 'This action cannot be undone.',
  tokenPageRegenerateConfirmButton: 'Confirm regenerate',
  tokenPageNewTokenTtlLabel: 'New token validity days',
  tokenPageTtlHint: '0 = never expires, max 3650',
  tokenPageEmptyRemoteEnabled:
    'No available token detected. Click "Generate default token" (default 7 days) before copying remote config.',
  tokenPageEmptyLocalOnly:
    'Local-only mode is active. Remote token is optional. Enable remote access to generate one here.',
  tokenPageRefreshConfirmMessage:
    'The old token will expire immediately. MCP clients on other devices must update Authorization. Set validity days for the new token below.',
  tokenPageExpired: 'Expired',
  tokenPageRemainingDaysHours: 'About {0} day(s) {1} hour(s) left',
  tokenPageRemainingHoursMinutes: 'About {0} hour(s) {1} minute(s) left',
  tokenPageRemainingMinutes: 'About {0} minute(s) left',
  tokenPageRefreshFailed: 'Refresh failed: {0}',
  tokenPageRefreshRequestFailed: 'Refresh request failed',
  tokenPageReadTokenFailedHttp: 'Failed to read token (HTTP {0})',
  tokenPageLocalServiceUnavailable: 'Token service is temporarily unavailable. Please retry.',
  webEditorNoAgentProjectSelected:
    'No Agent project selected. Open Side Panel -> AI Assistant and select/create a project first.',
  agentProjectConfirmCreateMissingDir: 'Directory "{0}" does not exist. Create it?',
  agentProjectConfirmSwitchExisting:
    'A project already exists for "{0}": {1}. Switch to that project?',

  // Sidepanel navigator
  sidepanelNavigatorTriggerTitle: 'Switch pages (drag to move, double-click to reset position)',
  sidepanelNavigatorTitle: 'Switch Pages',
  sidepanelMarkerSearchPlaceholder: 'Search marker name or selector...',
  sidepanelMarkerAddTitle: 'Add Marker',
  sidepanelMarkerEditTitle: 'Edit Marker',
  sidepanelMarkerNameLabel: 'Name',
  sidepanelMarkerSelectorTypeLabel: 'Selector Type',
  sidepanelMarkerMatchTypeLabel: 'Match Type',
  sidepanelMarkerSelectorLabel: 'Selector',
  sidepanelMarkerSelectorPlaceholder: 'CSS selector or XPath',
  sidepanelMarkerUpdateButton: 'Update',
  sidepanelMarkerStatsFiltered: 'Filtered {0} markers (total {1}, {2} domains)',
  sidepanelMarkerStatsTotal: 'Total {0} markers, {1} domains',
  sidepanelMarkerDomainCount: '{0} markers',
  sidepanelMarkerNoMatch: 'No matching markers found',
  sidepanelMarkerClearSearch: 'Clear search',
  sidepanelMarkerEmpty: 'No markers yet',
  sidepanelMarkerLocalFile: '(Local file)',
  sidepanelMarkerUnknownUrl: '(Unknown URL)',
  sidepanelTriggerCreateNotImplemented:
    'V3 Trigger management is not implemented yet, cannot create trigger for now.',
  sidepanelTriggerEditNotImplemented:
    'V3 Trigger management is not implemented yet, cannot edit trigger for now.',
  sidepanelWorkflowEditNotImplemented:
    'V3 Builder is not implemented yet, cannot edit workflow for now.',
  sidepanelWorkflowCreateNotImplemented:
    'V3 Builder is not implemented yet, cannot create workflow for now.',
  sidepanelWorkflowDeleteConfirm: 'Delete this workflow? This action cannot be undone.',
  sidepanelMarkerDeleteConfirm: 'Delete marker "{0}"?',

  // Element marker management
  markerCurrentPageLabel: 'Current Page',
  markerTotalLabel: 'Marked Elements',
  markerAddLabel: 'Add Marker',
  markerNamePlaceholder: 'Name, e.g. Login button',
  markerMatchPrefix: 'Path Prefix',
  markerMatchExact: 'Exact Match',
  markerMatchHost: 'Host',
  markerSelectorPlaceholder: 'CSS selector',
  markerValidateButton: 'Validate',
  markerEditButton: 'Edit',
  markerDeleteButton: 'Delete',

  // Schedule dialog
  scheduleTitle: 'Scheduled Execution',
  scheduleEnabledLabel: 'Enabled',
  scheduleEnabledToggle: 'Enable scheduling',
  scheduleTypeLabel: 'Type',
  scheduleTypeInterval: 'Every N minutes',
  scheduleTypeDaily: 'Daily at fixed time',
  scheduleTypeOnce: 'Run once',
  scheduleIntervalMinutesLabel: 'Interval (minutes)',
  scheduleDailyTimeLabel: 'Time (HH:mm)',
  scheduleDailyTimePlaceholder: 'e.g. 09:30',
  scheduleOnceTimeLabel: 'Time (ISO)',
  scheduleOnceTimePlaceholder: 'e.g. 2025-10-05T10:00:00',
  scheduleArgsLabel: 'Arguments (JSON)',
  scheduleExistingPlansTitle: 'Existing Plans',
  scheduleDeleteButton: 'Delete',
  scheduleDescribeInterval: 'Every {0} minute(s)',
  scheduleDescribeDaily: 'Every day at {0}',
  scheduleDescribeOnce: 'One-time at {0}',

  // Builder and trigger editor
  builderAutoLayoutTitle: 'Auto layout',
  builderDescriptionLabel: 'Description',
  builderDescriptionPlaceholder: 'Optional description',
  builderEditingPrefix: 'Editing: {0}',
  builderEditorTitle: 'Workflow Editor',
  builderExportButton: 'Export',
  builderExportFailed: 'Export failed: {0}',
  builderExportTitle: 'Export JSON',
  builderFallbackApplied: 'Fallback applied: promoted {0} priority',
  builderFitViewTitle: 'Fit view',
  builderFlowNotFound: 'Workflow "{0}" not found; created a new workflow',
  builderImportButton: 'Import',
  builderImportFailed: 'Import failed: {0}',
  builderImportNoFlow: 'Import failed: no workflow data found',
  builderImportTitle: 'Import JSON',
  builderLoadFailed: 'Failed to load workflow: {0}',
  builderManageTriggersTitle: 'Manage triggers',
  builderNameLabel: 'Name',
  builderNamePlaceholder: 'Workflow name',
  builderNewFlowName: 'New Workflow',
  builderNewFlowTitle: 'New Workflow',
  builderRedoTitle: 'Redo (Cmd/Ctrl+Shift+Z)',
  builderRenameButton: 'Rename',
  builderRenameDialogTitle: 'Rename Workflow',
  builderRenameFlowTitle: 'Rename workflow',
  builderRunAllTitle: 'Run full workflow',
  builderRunButton: 'Run',
  builderRunFailed: 'Run failed: {0}',
  builderRunFromSelectedButton: 'Run from selected',
  builderRunFromSelectedTitle: 'Replay from selected node',
  builderSaveFailed: 'Save failed: {0}',
  builderSavedStatus: 'Saved',
  builderSavingStatus: 'Saving...',
  builderScheduleConvertFailed:
    'Node {0} schedule #{1}: cannot convert to cron (type={2}), skipped',
  builderScheduleOnceUnsupported:
    'Node {0} schedule #{1}: one-time schedule (once) is not supported in V3, skipped',
  builderTip: 'Visual workflow orchestration',
  builderTriggersButton: 'Triggers',
  builderUndo: 'Undo',
  builderUndoTitle: 'Undo (Cmd/Ctrl+Z)',
  propertyPanelCommonSettingsTitle: 'Common Settings',
  propertyPanelConfigErrorTitle: 'Configuration Errors',
  propertyPanelDeleteNodeTitle: 'Delete node',
  propertyPanelEmptyLine1: 'Select a node',
  propertyPanelEmptyLine2: 'to view and edit properties',
  propertyPanelExtractNeedSaveVar: 'Save variable name is required',
  propertyPanelExtractNeedSelectorOrJs: 'Provide selector or js',
  propertyPanelNodeNameLabel: 'Node Name',
  propertyPanelNodeNamePlaceholder: 'Enter node name',
  propertyPanelNodePropertiesTitle: 'Node Properties',
  propertyPanelPromptNewSubflowId: 'Enter new subflow ID',
  propertyPanelScreenshotOnFailLabel: 'Capture screenshot on failure',
  propertyPanelTimeoutLabel: 'Timeout (ms)',
  propertyPanelTimeoutPlaceholder: 'Use global timeout by default',
  triggerAddSchedule: '+ Add schedule',
  triggerAddUrlRule: '+ Add rule',
  triggerCommandHint:
    'Tip: Chrome extension shortcuts must be declared in manifest and cannot be added dynamically at runtime.',
  triggerCommandLabel: 'Command key (must be declared in manifest commands)',
  triggerCommandPlaceholder: 'e.g. run_quick_trigger_1',
  triggerCommandTitle: 'Shortcut',
  triggerContextMenuDefaultTitle: 'Run Workflow',
  triggerContextMenuLabel: 'Title',
  triggerContextMenuPlaceholder: 'Menu title',
  triggerContextMenuTitle: 'Context Menu',
  triggerContextScopeLabel: 'Scope',
  triggerDescriptionOptional: 'Description (Optional)',
  triggerDescriptionPlaceholder: 'Describe what this trigger is for',
  triggerDomAppear: 'Trigger when appears',
  triggerDomDebounceLabel: 'Debounce (ms)',
  triggerDomOnce: 'Trigger only once',
  triggerDomSelectorLabel: 'Selector',
  triggerDomTitle: 'DOM Changes',
  triggerEnabled: 'Enable trigger',
  triggerModeCommand: 'Shortcut',
  triggerModeContextMenu: 'Context menu',
  triggerModeDom: 'DOM changes',
  triggerModeManual: 'Manual',
  triggerModeSchedule: 'Schedule',
  triggerModeUrl: 'Visit URL',
  triggerModesTitle: 'Trigger Modes',
  triggerScheduleWhenPlaceholder: '5 or 09:00 or 2025-01-01T10:00:00',
  triggerSummaryNote:
    'Note: Triggers are synced to background trigger registry (URL/context menu/shortcut/DOM) and schedules (interval/daily/once) when saving workflow.',
  triggerUrlMatchTitle: 'URL Match Rules',
  triggerUrlRuleDomainContains: 'Domain contains',
  triggerUrlRulePathPrefix: 'Path prefix',
  triggerUrlRulePlaceholder: 'e.g. https://example.com/app',
  triggerUrlRuleUrlPrefix: 'URL prefix',

  // Builder property panels
  builderPropAddButton: 'Add',
  builderPropAddSelectorButton: '+ Add selector',
  builderPropAssertConditionLabel: 'Assert condition (JSON)',
  builderPropAssertFailStrategyLabel: 'Failure strategy',
  builderPropCloseTabIdsLabel: 'Tab IDs (JSON array, optional)',
  builderPropCloseTabUrlLabel: 'Close by URL (optional)',
  builderPropCloseTabUrlPlaceholder: 'Substring match URL',
  builderPropConfigSectionTitle: 'Configuration',
  builderPropCreateSubflowButton: 'Create subflow',
  builderPropCssSelectorPlaceholder: 'CSS selector',
  builderPropDefault60000Placeholder: 'Default 60000',
  builderPropDefaultDownloadPlaceholder: 'Default download',
  builderPropDefaultElementsPlaceholder: 'Default elements',
  builderPropDefaultItemPlaceholder: 'Default item',
  builderPropDelayMsLabel: 'Delay (ms)',
  builderPropDeleteButton: 'Delete',
  builderPropDeleteTitle: 'Delete',
  builderPropDownloadFilenameContainsLabel: 'Filename contains (optional)',
  builderPropDownloadWaitCompleteLabel: 'Wait for download completion',
  builderPropDragEndSelectorTitle: 'End selector',
  builderPropDragHint:
    'Tip: path is usually auto-generated during recording; you can leave it empty when creating manually.',
  builderPropDragStartSelectorTitle: 'Start selector',
  builderPropElementSelectorLabel: 'Element selector',
  builderPropExecuteFlowArgsLabel: 'Arguments (JSON)',
  builderPropExecuteFlowInlineLabel: 'Inline execution (share context variables)',
  builderPropExecuteFlowTargetLabel: 'Target workflow',
  builderPropExtractAttributeLabel: 'Attribute',
  builderPropExtractAttributePlaceholder: 'text/textContent or attribute name',
  builderPropExtractCustomJsLabel: 'Custom JS (return value)',
  builderPropExtractSelectorOptionalLabel: 'Element selector (optional)',
  builderPropFillValueLabel: 'Input value',
  builderPropFillValuePlaceholder: 'Supports {variable_name} format',
  builderPropForeachItemVarLabel: 'Loop item variable name',
  builderPropForeachListVarLabel: 'List variable',
  builderPropHttpFormDataHint:
    'Supports short array form: [["file","url:https://...","a.png"],["metadata","value"]]',
  builderPropHttpFormDataLabel: 'FormData (JSON, optional, overrides Body when provided)',
  builderPropHttpMethodLabel: 'HTTP method',
  builderPropIfBranchNamePlaceholder: 'Branch name (optional)',
  builderPropIfDescription:
    'Define branches using expressions, with variables and common comparison operators.',
  builderPropIfElseDescription:
    'Else branch (no expression; matches when all above conditions are false)',
  builderPropIfInsertVariable: 'Insert variable',
  builderPropIfOperator: 'Operator',
  builderPropInputJsonPlaceholder: 'Input JSON',
  builderPropJsonFormatError: 'Invalid JSON format',
  builderPropKeySequenceLabel: 'Key sequence',
  builderPropKeySequencePlaceholder: 'e.g. Backspace Enter or cmd+a',
  builderPropLoopElementsListVarLabel: 'List variable name',
  builderPropNumberPlaceholder: 'Number',
  builderPropOffsetXLabel: 'Offset X',
  builderPropOffsetYLabel: 'Offset Y',
  builderPropOpenTabNewWindowLabel: 'New window',
  builderPropPleaseSelect: 'Please select',
  builderPropRequiredSuffix: 'is required',
  builderPropSaveAsVariableLabel: 'Save as variable',
  builderPropSaveAsVariableOptionalLabel: 'Save as variable (optional)',
  builderPropSaveToVariableLabel: 'Save to variable',
  builderPropScreenshotFullPageLabel: 'Full page screenshot',
  builderPropScreenshotSaveAsPlaceholder: 'Variable name, e.g. shot',
  builderPropScreenshotSelectorOptionalLabel: 'Element selector (optional)',
  builderPropScreenshotSelectorPlaceholder: 'Leave empty to capture viewport or full page',
  builderPropScriptAssignLabel: 'Result field mapping',
  builderPropScriptCodeLabel: 'Code',
  builderPropScriptWhenLabel: 'Execution timing',
  builderPropScriptWorldLabel: 'Execution world',
  builderPropScrollContainerHint: 'Container must support scrollTo(top,left)',
  builderPropScrollContainerSelectorTitle: 'Container selector',
  builderPropScrollModeContainer: 'Container offset',
  builderPropScrollModeElement: 'Scroll to element',
  builderPropScrollModeLabel: 'Mode',
  builderPropScrollModeOffset: 'Window offset',
  builderPropScrollTargetElementTitle: 'Target element',
  builderPropSelectFromPageButton: 'Select from page',
  builderPropSelectorTitle: 'Selector',
  builderPropSelectorValuePlaceholder: 'Selector value',
  builderPropSetAttrNameLabel: 'Attribute name',
  builderPropSetAttrNamePlaceholder: 'e.g. value/src/disabled',
  builderPropSetAttrRemoveLabel: 'Remove attribute',
  builderPropSetAttrValueLabel: 'Attribute value (leave empty and check remove to delete)',
  builderPropSetAttrValuePlaceholder: 'Attribute value',
  builderPropSpecNotFoundHint:
    'No NodeSpec provided for this node yet; fallback default property panel is used.',
  builderPropSpecNotFoundTitle: 'Node spec not found',
  builderPropSubflowIdLabel: 'Subflow ID',
  builderPropSubflowPlaceholder: 'Select or create subflow',
  builderPropSubstringMatchPlaceholder: 'Substring match',
  builderPropSwitchFrameHint:
    'Available for same-origin/injectable frames; leave empty to return to top-level page',
  builderPropSwitchFrameIndexLabel: 'Match by index (from 0, sub-frames only)',
  builderPropSwitchFrameIndexPlaceholder: 'Index number',
  builderPropSwitchFrameUrlContainsLabel: 'Match by URL contains (preferred)',
  builderPropSwitchFrameUrlPlaceholder: 'Substring contained in frame URL',
  builderPropSwitchTabIdOptionalLabel: 'Tab ID (optional)',
  builderPropSwitchTabNeedOneHint: 'Provide tabId or URL/title contains',
  builderPropSwitchTabTitleContainsOptionalLabel: 'Title contains (optional)',
  builderPropSwitchTabUrlContainsOptionalLabel: 'URL contains (optional)',
  builderPropTimeoutMsCompactLabel: 'Timeout (ms)',
  builderPropTriggerEventBubblesLabel: 'Bubbles',
  builderPropTriggerEventCancelableLabel: 'Cancelable',
  builderPropTriggerEventTypeLabel: 'Event type',
  builderPropTriggerEventTypePlaceholder: 'e.g. input/change/mouseover',
  builderPropUrlAddressLabel: 'URL',
  builderPropUrlAddressOptionalLabel: 'URL (optional)',
  builderPropVariableNamePlaceholder: 'Variable name',
  builderPropWaitConditionLabel: 'Wait condition (JSON)',
  builderPropWhileConditionLabel: 'Condition (JSON)',
  builderPropWhileMaxIterationsOptionalLabel: 'Max iterations (optional)',
  builderValidationMissingTargetSelectorCandidate: 'Missing target selector candidate',
  builderValidationMissingInputValue: 'Missing input value',
  builderValidationMissingWaitCondition: 'Missing wait condition',
  builderValidationMissingAssertCondition: 'Missing assert condition',
  builderValidationMissingUrl: 'Missing URL',
  builderValidationHttpMissingUrl: 'HTTP: missing URL',
  builderValidationAssignInvalidPath: 'Assign: invalid path {0}',
  builderValidationExtractNeedSaveVar: 'Extract: save variable is required',
  builderValidationExtractNeedSelectorOrJs: 'Extract: selector or js is required',
  builderValidationSwitchTabNeedOne: 'SwitchTab: tabId or URL/title contains is required',
  builderValidationNeedEventType: 'Event type is required',
  builderValidationNeedAtLeastOneBranch: 'At least one condition branch is required',
  builderValidationBranchNeedExpression: 'Branch {0}: condition expression is required',
  builderValidationNeedAttributeName: 'Attribute name is required',
  builderValidationNeedElementSelector: 'Element selector is required',
  builderValidationNeedSubflowId: 'Subflow ID is required',
  builderValidationNeedExecuteFlowId: 'Target workflow is required',
  builderValidationScriptNeedCodeWhenAssign:
    'Script: code is required when save/assign is configured',
  builderToastCannotConnectSelf: 'Cannot connect node to itself',
  builderToastMaxIncomingEdges: 'This node allows up to {0} incoming edge(s)',
  builderToastMaxOutgoingEdges: 'This node allows up to {0} outgoing edge(s)',
  builderToastElkFallbackUsed: 'ELK auto-layout unavailable; fallback layout applied',
  builderIfCaseLabel: 'Condition {0}',
  builderSummaryUnconfiguredSelector: 'Selector not configured',
  builderSummaryIfElseBranchCount: 'if/else branches: {0}{1}',

  // Builder widgets
  builderFieldKeySequenceHelp: 'Example: Backspace Enter or cmd+a',
  builderFieldSelectorHelp:
    'You can enter a CSS selector, or click Pick to select an element on the page',
  builderFieldSelectorNoActiveTabError: 'No active tab found',
  builderFieldSelectorNoValidSelectorError: 'No valid selector generated, please input manually',
  builderFieldSelectorPickButton: 'Pick',
  builderFieldSelectorPickFailedError: 'Pick failed',
  builderFieldSelectorPickFromPageTitle: 'Pick from page',
  builderKveAddMappingButton: 'Add mapping',
  builderKveResultPathPlaceholder: 'Result path (e.g. data.items[0].id)',
  builderKveVarNamePlaceholder: 'Variable name',

  // Builder edges and widgets
  builderEdgeDeleteTitle: 'Delete edge',
  builderEdgeEmptyText: 'No edge selected',
  builderFieldExpressionParseError: 'Expression parse error',
  builderFieldExpressionPlaceholder: 'e.g. vars.a > 0 && vars.flag',
  rrNodeAssertNeedSelectorAndName: 'assert.attribute: selector and name are required',
  rrNodeMissingAssertCondition: 'Missing assert condition',
  rrNodeMissingTargetSelectorCandidate: 'Missing target selector candidate',
  rrNodeMissingConditionOrBranch: 'Missing condition or branches',
  rrNodeMissingTargetOrEventType: 'Target selector and event type are required',
  rrNodeNeedTargetAndAttributeName: 'Target selector and attribute name are required',
  rrNodeNeedSelectorAndSubflowId: 'selector and subflowId are required',
  rrNodeNeedFlowId: 'flowId is required',
  rrNodeMissingTargetOrInputValue: 'Missing target selector candidate or input value',
  rrNodeForeachNeedListVarAndSubflowId: 'foreach: listVar and subflowId are required',
  rrNodeWhileNeedConditionAndSubflowId: 'while: condition and subflowId are required',
  rrNodeMissingUrl: 'Missing URL',
  rrNodeMissingWaitCondition: 'Missing wait condition',

  // Sidepanel workflow status and builder node labels
  sidepanelWorkflowsStatusLabel: 'Status',
  sidepanelWorkflowsDurationLabel: 'Duration',
  sidepanelRunStatusQueued: 'Queued',
  sidepanelRunStatusRunning: 'Running',
  sidepanelRunStatusPaused: 'Paused',
  sidepanelRunStatusSucceeded: 'Succeeded',
  sidepanelRunStatusFailed: 'Failed',
  sidepanelRunStatusCanceled: 'Canceled',
  builderNodeTypeTrigger: 'Trigger',
  builderNodeTypeClick: 'Click',
  builderNodeTypeFill: 'Fill',
  builderNodeTypeNavigate: 'Navigate',
  builderNodeTypeWait: 'Wait',
  builderNodeTypeExtract: 'Extract',
  builderNodeTypeScript: 'Script',
  builderNodeTypeIf: 'Condition',
  builderNodeTypeForeach: 'Loop',
  builderNodeTypeAssert: 'Assert',
  builderNodeTypeKey: 'Keyboard',
  builderNodeTypeDrag: 'Drag',
  builderNodeTypeDblclick: 'Double click',
  builderNodeTypeOpenTab: 'Open tab',
  builderNodeTypeSwitchTab: 'Switch tab',
  builderNodeTypeCloseTab: 'Close tab',
  builderNodeTypeDelay: 'Delay',
  builderNodeTypeScroll: 'Scroll',
  builderNodeTypeWhile: 'Loop',

  // Units
  bytesUnit: 'bytes',
  kilobytesUnit: 'KB',
  megabytesUnit: 'MB',
  gigabytesUnit: 'GB',
  itemsUnit: 'items',
  pagesUnit: 'pages',

  // Legacy keys for backwards compatibility
  nativeServerConfig: 'Native Server Configuration',
  runningStatus: 'Running Status',
  refreshStatus: 'Refresh Status',
  lastUpdated: 'Last Updated:',
  mcpServerConfig: 'MCP Server Configuration',
  connectionPort: 'Connection Port',
  connecting: 'Connecting...',
  disconnect: 'Disconnect',
  connect: 'Connect',
  semanticEngine: 'Semantic Engine',
  embeddingModel: 'Embedding Model',
  retry: 'Retry',
  indexDataManagement: 'Index Data Management',
  clearing: 'Clearing...',
  clearAllData: 'Clear All Data',
  copyConfig: 'Copy Configuration',
  serviceRunning: 'Service Running (Port: {0})',
  connectedServiceNotStarted: 'Connected, Service Not Started',
  serviceNotConnected: 'Service Not Connected',
  detecting: 'Detecting...',
  lightweightModel: 'Lightweight Multilingual Model',
  betterThanSmall: 'Slightly larger than e5-small, but better performance',
  multilingualModel: 'Multilingual Semantic Model',
  fast: 'Fast',
  balanced: 'Balanced',
  accurate: 'Accurate',
  semanticEngineReady: 'Semantic Engine Ready',
  semanticEngineInitializing: 'Semantic Engine Initializing...',
  semanticEngineInitFailed: 'Semantic Engine Initialization Failed',
  semanticEngineNotInit: 'Semantic Engine Not Initialized',
  downloadingModel: 'Downloading Model... {0}%',
  switchingModel: 'Switching Model...',
  networkError: 'Network connection error, please check network and retry',
  modelCorrupted: 'Model file corrupted or incomplete, please retry download',
  unknownError: 'Unknown error, please check if your network can access HuggingFace',
  reinitialize: 'Reinitialize',
  initializing: 'Initializing...',
  initSemanticEngine: 'Initialize Semantic Engine',
  indexedPages: 'Indexed Pages',
  indexSize: 'Index Size',
  activeTabs: 'Active Tabs',
  vectorDocuments: 'Vector Documents',
  confirmClearData: 'Confirm Clear Data',
  clearDataWarning:
    'This operation will clear all indexed webpage content and vector data, including:',
  clearDataIrreversible:
    'This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.',
  confirmClear: 'Confirm Clear',
  cancel: 'Cancel',
  confirm: 'Confirm',
  processing: 'Processing...',
  modelCacheManagement: 'Model Cache Management',
  cacheSize: 'Cache Size',
  cacheEntries: 'Cache Entries',
  cacheDetails: 'Cache Details',
  noCacheData: 'No cache data',
  loadingCacheInfo: 'Loading cache information...',
  processingCache: 'Processing cache...',
  cleaning: 'Cleaning...',
  cleanExpiredCache: 'Clean Expired Cache',
  clearAllCache: 'Clear All Cache',
  expired: 'Expired',
  bookmarksBar: 'Bookmarks Bar',
};

/**
 * Safe i18n message getter with fallback support
 * @param key Message key
 * @param substitutions Optional substitution values
 * @returns Localized message or fallback
 */
export function getMessage(key: string, substitutions?: string[]): string {
  try {
    // Check if Chrome extension APIs are available
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) {
        return message;
      }
    }
  } catch (error) {
    console.warn(`Failed to get i18n message for key "${key}":`, error);
  }

  // Fallback to English messages
  let fallback = fallbackMessages[key] || key;

  // Handle substitutions in fallback messages
  if (substitutions && substitutions.length > 0) {
    substitutions.forEach((value, index) => {
      fallback = fallback.replace(`{${index}}`, value);
    });
  }

  return fallback;
}

/**
 * Check if Chrome extension i18n APIs are available
 */
export function isI18nAvailable(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function'
    );
  } catch {
    return false;
  }
}
