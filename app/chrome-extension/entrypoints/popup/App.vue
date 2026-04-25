<template>
  <div class="popup-container agent-theme" :data-agent-theme="agentTheme">
    <!-- 首页 -->
    <div v-show="currentView === 'home'" class="home-view">
      <div class="header">
        <div class="header-content">
          <div class="header-meta">
            <div class="header-mainline">
              <h1 class="header-title">Tabrix</h1>
              <span class="header-separator">·</span>
              <p class="header-context">{{ getMessage('nativeServerConfigLabel') }}</p>
            </div>
          </div>
          <div class="header-actions">
            <button
              :class="['header-theme-button', { active: isTechTheme }]"
              @click="togglePopupTheme"
              :title="themeToggleTitle"
              :aria-label="themeToggleTitle"
            >
              <svg class="header-theme-icon" viewBox="0 0 24 24" aria-hidden="true">
                <g class="header-theme-glyph header-theme-glyph-sun" fill="none">
                  <circle cx="12" cy="12" r="5" />
                  <path
                    d="M12 1v2M12 21v2M4.93 4.93l1.41 1.41M17.65 17.65l1.41 1.41M1 12h2M21 12h2M4.93 19.07l1.41-1.41M17.65 6.35l1.41-1.41"
                  />
                </g>
                <g class="header-theme-glyph header-theme-glyph-moon" fill="none">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </g>
              </svg>
            </button>
            <button
              class="header-refresh-button"
              @click="refreshOverview"
              :title="getMessage('refreshStatusButton')"
            >
              <RefreshIcon className="header-action-icon" />
            </button>
          </div>
        </div>
      </div>
      <div class="content">
        <!-- 服务配置卡片 -->
        <div class="section">
          <div class="config-card">
            <div class="status-section">
              <div :class="['status-inline', statusToneClass]">
                <div class="status-mainline">
                  <div class="status-left">
                    <span :class="['status-dot', getStatusClass()]"></span>
                    <span class="status-text">{{ statusHeadlineText }}</span>
                  </div>
                  <span v-if="statusUpdatedTimeText" class="status-updated">
                    {{ getMessage('lastUpdatedLabel') }} {{ statusUpdatedTimeText }}
                  </span>
                </div>
              </div>
              <div
                v-if="statusDetailText"
                :class="['status-detail', `status-detail-${statusDetailLevel}`]"
              >
                <div>{{ statusDetailText }}</div>
                <div
                  v-if="repairCommandText || showTroubleshootingEntry"
                  class="status-detail-actions"
                >
                  <button
                    v-if="repairCommandText"
                    class="repair-command-button"
                    @click="copyRepairCommand"
                  >
                    {{ repairCommandButtonText }}
                  </button>
                  <button
                    v-if="showTroubleshootingEntry"
                    class="repair-guide-button"
                    @click="showTroubleshootingDialog = true"
                  >
                    {{ getMessage('popupOpenTroubleshootingGuide') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Connected MCP clients -->
            <div
              v-if="showMcpConfig && connectedClients.length > 0"
              class="connected-clients-section"
            >
              <div class="connected-clients-header">
                <p class="connected-clients-label">{{
                  getMessage('popupActiveClientsLabel', [
                    connectedClientsSummary.activeClients.toString(),
                  ])
                }}</p>
                <button
                  class="refresh-status-button"
                  @click="fetchConnectedClients"
                  :title="getMessage('popupRefreshClientsTitle')"
                >
                  <RefreshIcon className="icon-small" />
                </button>
              </div>
              <div class="connected-clients-list">
                <div
                  v-for="client in connectedClients"
                  :key="client.clientId"
                  class="connected-client-item"
                >
                  <div class="client-info">
                    <span class="client-dot"></span>
                    <span class="client-name" :title="formatClientNameTitle(client)">{{
                      formatClientDisplayName(client)
                    }}</span>
                    <span class="client-meta" :title="formatClientMetaTitle(client)">{{
                      formatClientMeta(client)
                    }}</span>
                  </div>
                  <div class="client-actions">
                    <span class="client-time">{{ formatRelativeTime(client.lastSeenAt) }}</span>
                    <button
                      class="client-disconnect-btn"
                      @click="disconnectClient(client.clientId)"
                      :title="getMessage('popupDisconnectClientTitle')"
                      >✕</button
                    >
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else-if="showMcpConfig"
              class="connected-clients-section connected-clients-empty"
            >
              <p class="connected-clients-label">{{ getMessage('popupNoActiveClients') }}</p>
            </div>

            <div v-if="showMcpConfig" class="mcp-config-section">
              <div class="mcp-config-header">
                <p class="mcp-config-label">{{ getMessage('popupMcpConfigLabel') }}</p>
                <button
                  class="copy-config-button"
                  :disabled="!canCopyActiveConfig"
                  :title="
                    canCopyActiveConfig
                      ? getMessage('copyConfigButton')
                      : getMessage('popupConfigNeedsConnection')
                  "
                  @click="copyMcpConfig"
                >
                  {{ copyButtonText }}
                </button>
              </div>
              <div class="mcp-config-tabs">
                <button
                  v-for="tab in configTabs"
                  :key="tab.id"
                  :class="['mcp-tab', { active: activeConfigTab === tab.id }]"
                  @click="activeConfigTab = tab.id"
                  >{{ tab.label }}</button
                >
              </div>
              <div v-if="activeConfigTab === 'remote'" class="remote-toggle-card">
                <div class="remote-toggle-header">
                  <span class="remote-toggle-title">{{
                    getMessage('popupRemoteAccessTitle')
                  }}</span>
                  <label class="remote-switch" :class="{ disabled: remoteToggling }">
                    <input
                      type="checkbox"
                      :checked="remoteAccessEnabled"
                      :disabled="remoteToggling || connectionState !== ConnectionState.RUNNING"
                      @change="toggleRemoteAccess"
                    />
                    <span class="remote-switch-slider"></span>
                  </label>
                </div>
                <div class="remote-toggle-desc">
                  {{ remoteAccessSummary }}
                </div>
                <div v-if="remoteToggleCopiedText" class="remote-toggle-copied">
                  {{ remoteToggleCopiedText }}
                </div>
              </div>
              <div v-if="remoteSecurityWarning" class="mcp-security-warning">
                {{ remoteSecurityWarning }}
              </div>
              <template v-if="canShowActiveConfig">
                <div class="mcp-config-content">
                  <pre class="mcp-config-json">{{ activeConfigJson }}</pre>
                </div>
              </template>
              <div v-else class="remote-disabled-hint">
                {{ activeConfigUnavailableHint }}
              </div>
            </div>
            <div class="port-section">
              <label for="port" class="port-label">{{ getMessage('connectionPortLabel') }}</label>
              <input
                type="text"
                id="port"
                :value="nativeServerPort"
                :disabled="connectActionState.busy"
                @change="updatePort"
                @keydown.enter="($event.target as HTMLInputElement)?.blur()"
                class="port-input"
              />
              <span v-if="portReconnectHint" class="port-hint">{{ portReconnectHint }}</span>
            </div>

            <button
              :class="[
                'connect-button',
                {
                  'is-disconnect':
                    !connectActionState.busy && connectActionState.action === 'disconnect',
                },
              ]"
              :disabled="connectActionState.busy"
              @click="testNativeConnection"
            >
              <BoltIcon />
              <span>{{
                connectActionState.busy
                  ? getMessage('connectingStatus')
                  : connectActionState.action === 'disconnect'
                    ? getMessage('disconnectButton')
                    : getMessage('connectButton')
              }}</span>
            </button>
          </div>
        </div>

        <!-- 管理入口卡片 -->
        <div class="section">
          <h2 class="section-title">{{ getMessage('popupManagementEntrancesTitle') }}</h2>
          <div class="entry-card">
            <button class="entry-item" @click="currentView = 'token-management'">
              <div class="entry-icon token">
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                  />
                </svg>
              </div>
              <div class="entry-content">
                <span class="entry-title">{{ getMessage('popupTokenManagementTitle') }}</span>
                <span class="entry-desc">{{ getMessage('popupTokenManagementDesc') }}</span>
              </div>
              <svg
                class="entry-arrow"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div class="footer">
        <div class="footer-links">
          <button class="footer-link" @click="openWelcomePage" title="View installation guide">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Guide
          </button>
          <button class="footer-link" @click="openTroubleshooting" title="Troubleshooting">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            Docs
          </button>
          <button class="footer-link" @click="showTroubleshootingDialog = true" title="Quick Fix">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Fix
          </button>
        </div>
        <p class="footer-text">tabrix mcp browser service</p>
      </div>
    </div>

    <!-- Token management secondary page -->
    <TokenManagementPage
      v-show="currentView === 'token-management'"
      :base-url="serverBaseUrl"
      :lan-ip="lanIpAddress"
      @back="currentView = 'home'"
      @token-changed="fetchTokenInfo"
    />

    <div
      v-if="showTroubleshootingDialog"
      class="troubleshooting-dialog"
      @click.self="showTroubleshootingDialog = false"
    >
      <div class="troubleshooting-content" role="dialog" aria-modal="true">
        <div class="troubleshooting-header">
          <div class="troubleshooting-title-wrap">
            <h3>{{ getMessage('popupTroubleshootingGuideTitle') }}</h3>
            <p class="troubleshooting-desc">{{ getMessage('popupTroubleshootingGuideDesc') }}</p>
          </div>
          <button
            class="troubleshooting-close"
            :title="getMessage('closeButton')"
            @click="showTroubleshootingDialog = false"
            >✕</button
          >
        </div>
        <div class="troubleshooting-list">
          <div
            v-for="(item, index) in troubleshootingCommands"
            :key="item.id"
            class="troubleshooting-item"
          >
            <div class="troubleshooting-item-head">
              <div class="troubleshooting-item-title">
                <span class="troubleshooting-item-index">{{ index + 1 }}</span>
                <span>{{ item.title }}</span>
              </div>
              <button
                class="troubleshooting-copy"
                @click="copyTroubleshootingCommand(item.command)"
              >
                {{
                  copiedTroubleshootingCommand === item.command
                    ? getMessage('popupCopiedShort')
                    : getMessage('popupCopyCommand')
                }}
              </button>
            </div>
            <pre class="troubleshooting-item-command">{{ item.command }}</pre>
            <div v-if="item.note" class="troubleshooting-item-note">{{ item.note }}</div>
          </div>
        </div>
        <div class="troubleshooting-actions">
          <button class="troubleshooting-action-btn secondary" @click="copyTroubleshootingScript">
            {{
              copiedTroubleshootingScript
                ? getMessage('popupCopiedFullScript')
                : getMessage('popupCopyFullTroubleshootScript')
            }}
          </button>
          <button class="troubleshooting-action-btn secondary" @click="openTroubleshooting">{{
            getMessage('popupOpenDocs')
          }}</button>
          <button
            class="troubleshooting-action-btn primary"
            @click="showTroubleshootingDialog = false"
            >{{ getMessage('closeButton') }}</button
          >
        </div>
      </div>
    </div>

    <!-- 侧边栏承担工作流管理；编辑器在独立窗口中打开 -->

    <!-- Coming Soon Toast -->
    <Transition name="toast">
      <div v-if="comingSoonToast.show" class="coming-soon-toast">
        <svg
          class="toast-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ comingSoonToast.feature }} {{ getMessage('popupComingSoonSuffix') }}</span>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { LINKS } from '@/common/constants';
import { ConnectionState, stateToStatusClass, type ServerStatus } from '@/common/connection-state';
import { resolvePopupConnectAction } from '@/common/popup-connect-action';
import {
  describePopupClientOrigin,
  inferPopupClientProduct,
  isGenericPopupClientName,
  normalizePopupConnectedClients,
  shouldPopupAutoConnect,
  shouldApplyConnectedClientsResponse,
  summarizePopupConnectedClients,
  type PopupConnectedClient,
} from '@/common/popup-connected-clients';
import { createDisconnectedPopupSnapshot } from '@/common/popup-connection-state';
import { resolvePopupPortUpdate } from '@/common/popup-port-input';
import { shouldApplyPopupServerStatusMessage } from '@/common/popup-server-status-message';
import { resolvePopupConnectionState } from '@/common/popup-status-phase';
import { normalizeNativeLastError } from '@/common/normalize-native-last-error';
import { isNoServiceWorkerError } from '@/common/is-no-service-worker-error';
import {
  getPopupNativeErrorGuidance,
  getPopupRepairCommand,
} from '@/common/popup-native-error-guidance';
import { getMessage } from '@/utils/i18n';
import { useAgentTheme, type AgentThemeId } from '../shared/composables/usePopupTheme';

import TokenManagementPage from './components/TokenManagementPage.vue';
import { BoltIcon, RefreshIcon } from './components/icons';

// AgentChat theme - 从preload中获取，保持与sidepanel一致
const { theme: agentTheme, initTheme, setTheme } = useAgentTheme();

const QUICK_LIGHT_THEME: AgentThemeId = 'warm-editorial';
const QUICK_TECH_THEME: AgentThemeId = 'dark-console';
const isTechTheme = computed(() => agentTheme.value === QUICK_TECH_THEME);
const themeToggleTitle = computed(() =>
  isTechTheme.value ? getMessage('lightTheme') : getMessage('darkTheme'),
);

const togglePopupTheme = async () => {
  const next = isTechTheme.value ? QUICK_LIGHT_THEME : QUICK_TECH_THEME;
  await setTheme(next);
};

// 当前视图状态：首页 / Token 管理
const currentView = ref<'home' | 'token-management'>('home');

// Coming Soon Toast
const comingSoonToast = ref<{ show: boolean; feature: string }>({ show: false, feature: '' });

function showComingSoonToast(feature: string) {
  comingSoonToast.value = { show: true, feature };
  setTimeout(() => {
    comingSoonToast.value = { show: false, feature: '' };
  }, 2000);
}

// Record & Replay / workflow surfaces were removed as part of the MKEP
// pruning. No flow list, recorder
// control or workflow state lives in the popup anymore.

const nativeConnectionStatus = ref<'unknown' | 'connected' | 'disconnected'>('unknown');
const isConnecting = ref(false);
const isBootstrappingStatus = ref(true);
const nativeServerPort = ref<number>(12306);
const lastNativeError = ref<string | null>(null);
const daemonReachable = ref(false);

const serverStatus = ref<ServerStatus>({
  isRunning: false,
  lastUpdated: Date.now(),
});

const showMcpConfig = computed(() => {
  return (
    (nativeConnectionStatus.value === 'connected' && serverStatus.value.isRunning) ||
    (daemonReachable.value && serverStatus.value.isRunning)
  );
});

const connectionState = computed(() =>
  resolvePopupConnectionState({
    nativeStatus: nativeConnectionStatus.value,
    serverRunning: serverStatus.value.isRunning,
    isConnecting: isConnecting.value,
    lastError: lastNativeError.value,
    isBootstrapping: isBootstrappingStatus.value,
  }),
);
const connectActionState = computed(() =>
  resolvePopupConnectAction(connectionState.value, isConnecting.value, isBootstrappingStatus.value),
);

// ==================== Connected Clients ====================

const connectedClients = ref<PopupConnectedClient[]>([]);
const connectedClientsSummary = computed(() =>
  summarizePopupConnectedClients(connectedClients.value),
);

function formatClientOriginLabel(client: PopupConnectedClient): string {
  const origin = describePopupClientOrigin(client);
  if (origin.scope === 'local') {
    return getMessage(
      origin.transport === 'http' ? 'popupClientLocalHttpLabel' : 'popupClientLocalSseLabel',
    );
  }
  return getMessage(
    origin.transport === 'http' ? 'popupClientRemoteHttpLabel' : 'popupClientRemoteSseLabel',
    [origin.address],
  );
}

function formatClientMeta(client: PopupConnectedClient): string {
  return formatClientOriginLabel(client);
}

function formatClientDisplayName(client: PopupConnectedClient): string {
  const inferred = inferPopupClientProduct(client);
  if (inferred) return inferred;
  if (client.clientName && !isGenericPopupClientName(client.clientName)) {
    return client.clientName;
  }
  if (client.clientName) {
    return getMessage('popupGenericMcpClient');
  }
  return getMessage('popupUnknownClient');
}

function formatClientNameTitle(client: PopupConnectedClient): string | undefined {
  const details = [];
  if (client.clientName) details.push(client.clientName);
  if (client.clientVersion) details.push(client.clientVersion);
  if (client.userAgent) details.push(client.userAgent);
  return details.length > 0 ? details.join(' · ') : undefined;
}

function formatClientMetaTitle(client: PopupConnectedClient): string | undefined {
  const originLabel = formatClientOriginLabel(client);
  if ((client.sessionCount || 0) <= 1) return originLabel;
  return `${originLabel} · ${getMessage('popupClientSessionsLabel', [client.sessionCount.toString()])}`;
}

function applyDisconnectedPopupSnapshot() {
  const snapshot = createDisconnectedPopupSnapshot(serverStatus.value);
  nativeConnectionStatus.value = snapshot.nativeConnectionStatus;
  serverStatus.value = snapshot.serverStatus;
  connectedClients.value = [];
  lastNativeError.value = normalizeNativeLastError(snapshot.lastNativeError);
}

function getServerBaseUrl(): string {
  const port = serverStatus.value.port || nativeServerPort.value;
  return `http://127.0.0.1:${port}`;
}

const serverBaseUrl = computed(() => getServerBaseUrl());

async function refreshStandaloneDaemonStatus(): Promise<void> {
  const requestedBaseUrl = getServerBaseUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${requestedBaseUrl}/status`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      daemonReachable.value = false;
      return;
    }
    const json = await res.json();
    const snapshot = json?.data;
    if (snapshot && typeof snapshot === 'object') {
      serverStatus.value = {
        ...(serverStatus.value || {}),
        ...(snapshot as ServerStatus),
        lastUpdated: Date.now(),
      };
      if (!serverStatus.value.port) {
        serverStatus.value.port = nativeServerPort.value;
      }
      daemonReachable.value = Boolean(serverStatus.value.isRunning);
    } else {
      daemonReachable.value = false;
    }
  } catch {
    daemonReachable.value = false;
  }
}

async function fetchConnectedClients(): Promise<void> {
  if (!showMcpConfig.value) {
    connectedClients.value = [];
    return;
  }
  const requestedBaseUrl = getServerBaseUrl();
  try {
    const res = await fetch(`${requestedBaseUrl}/status`);
    if (!res.ok) {
      connectedClients.value = [];
      return;
    }
    const json = await res.json();
    if (
      !shouldApplyConnectedClientsResponse({
        requestedBaseUrl,
        currentBaseUrl: getServerBaseUrl(),
        showMcpConfig: showMcpConfig.value,
      })
    ) {
      connectedClients.value = [];
      return;
    }
    connectedClients.value = normalizePopupConnectedClients(json?.data?.transports?.clients);
  } catch {
    connectedClients.value = [];
  }
}

async function disconnectClient(clientId: string): Promise<void> {
  try {
    await fetch(`${getServerBaseUrl()}/status/clients/${clientId}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
  await fetchConnectedClients();
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return getMessage('popupJustNow');
  if (diff < 3_600_000) {
    return getMessage('popupMinutesAgo', [Math.floor(diff / 60_000).toString()]);
  }
  return getMessage('popupHoursAgo', [Math.floor(diff / 3_600_000).toString()]);
}

const copyButtonText = ref(getMessage('copyConfigButton'));
const repairCommandButtonText = ref(getMessage('popupCopyRepairCommand'));
const showTroubleshootingDialog = ref(false);
const copiedTroubleshootingCommand = ref<string | null>(null);
const copiedTroubleshootingScript = ref(false);
const remoteToggleCopiedText = ref('');

type ConfigTabId = 'stdio' | 'remote';

const activeConfigTab = ref<ConfigTabId>('remote');

const serverPort = computed(() => serverStatus.value.port || nativeServerPort.value);

const isWildcardHost = computed(() => {
  const host = serverStatus.value.host;
  return host === '0.0.0.0' || host === '::';
});
const remoteAccessEnabled = computed(() => isWildcardHost.value);
const remoteAccessSummary = computed(() => {
  if (connectionState.value !== ConnectionState.RUNNING) {
    return getMessage('popupRemoteSummaryNeedRunning');
  }
  if (!remoteAccessEnabled.value) {
    return getMessage('popupRemoteSummaryLocalOnly');
  }
  if (authEnabled.value || tokenInfo.value) {
    return getMessage('popupRemoteSummaryEnabledSecure');
  }
  return getMessage('popupRemoteSummaryAutoCreating');
});

const lanIpAddress = computed(() => {
  return isWildcardHost.value ? serverStatus.value.networkAddresses?.[0] || null : null;
});

const authEnabled = computed(() => serverStatus.value.authEnabled === true);

const remoteSecurityWarning = computed(() => {
  if (activeConfigTab.value !== 'remote') return '';
  if (isWildcardHost.value && !authEnabled.value && !tokenInfo.value) {
    return getMessage('popupRemoteSecurityWarning');
  }
  return '';
});

interface TokenInfo {
  token: string;
  createdAt: number;
  expiresAt: number | null;
  fromEnv: boolean;
  ttlDays?: number | null;
}

const tokenInfo = ref<TokenInfo | null>(null);

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendRuntimeMessageWithNoSwRetry<T = any>(
  message: Record<string, unknown>,
  attempts = 3,
  delayMs = 180,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return (await chrome.runtime.sendMessage(message)) as T;
    } catch (error) {
      lastError = error;
      if (!isNoServiceWorkerError(error) || attempt === attempts - 1) {
        throw error;
      }
      await waitMs(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function createDefaultRemoteToken(): Promise<boolean> {
  try {
    const res = await fetch(`${getServerBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return false;
    const json = await res.json();
    tokenInfo.value = json?.data ?? null;
    if (!tokenInfo.value) return false;
    await refreshServerStatus();
    return true;
  } catch {
    return false;
  }
}

async function fetchTokenInfo(options: { autoCreateWhenMissing?: boolean } = {}): Promise<void> {
  const { autoCreateWhenMissing = false } = options;
  try {
    const res = await fetch(`${getServerBaseUrl()}/auth/token`);
    if (!res.ok) {
      tokenInfo.value = null;
      return;
    }
    const json = await res.json();
    tokenInfo.value = json?.data ?? null;
  } catch {
    tokenInfo.value = null;
  }

  if (autoCreateWhenMissing && remoteAccessEnabled.value && !tokenInfo.value) {
    await createDefaultRemoteToken();
  }
}

async function ensureRemoteTokenReady(maxAttempts = 6): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    await fetchTokenInfo({ autoCreateWhenMissing: true });
    if (tokenInfo.value) {
      return true;
    }
    await refreshServerStatus();
    await waitMs(250);
  }
  return Boolean(tokenInfo.value);
}

async function waitForRemoteAccessState(
  expectedEnabled: boolean,
  maxAttempts = 8,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i += 1) {
    await refreshServerStatus();
    if (remoteAccessEnabled.value === expectedEnabled) {
      return true;
    }
    await waitMs(200);
  }
  return remoteAccessEnabled.value === expectedEnabled;
}

const configTabs: Array<{ id: ConfigTabId; label: string }> = [
  { id: 'remote', label: getMessage('popupRemoteTab') },
  { id: 'stdio', label: 'stdio' },
];

const remoteDefaultEnsured = ref(false);
const remoteDefaultInFlight = ref(false);

async function ensureRemoteDefaultReady(): Promise<void> {
  if (remoteDefaultEnsured.value || remoteDefaultInFlight.value) return;
  if (connectionState.value !== ConnectionState.RUNNING) return;

  remoteDefaultInFlight.value = true;
  try {
    if (!remoteAccessEnabled.value) {
      const response = await chrome.runtime.sendMessage({
        type: 'set_remote_access',
        enable: true,
      });
      if (!response?.success) return;
      await waitMs(400);
      const enabled = await waitForRemoteAccessState(true);
      if (!enabled) return;
    }

    const tokenReady = await ensureRemoteTokenReady();
    if (remoteAccessEnabled.value && tokenReady) {
      remoteDefaultEnsured.value = true;
      if (activeConfigTab.value === 'remote') {
        await fetchTokenInfo({ autoCreateWhenMissing: true });
      }
    }
  } catch (error) {
    console.warn('Failed to ensure remote default ready:', error);
  } finally {
    remoteDefaultInFlight.value = false;
  }
}

watch(activeConfigTab, (tab) => {
  if (tab === 'remote') fetchTokenInfo({ autoCreateWhenMissing: true });
});

watch(
  () => connectionState.value,
  () => {
    if (connectionState.value === ConnectionState.RUNNING) {
      void ensureRemoteDefaultReady();
    }
  },
);

const canExposeConfigJson = computed(() => connectionState.value === ConnectionState.RUNNING);
const canShowActiveConfig = computed(
  () =>
    canExposeConfigJson.value && (activeConfigTab.value !== 'remote' || remoteAccessEnabled.value),
);
const canCopyActiveConfig = computed(() => canShowActiveConfig.value);
const activeConfigUnavailableHint = computed(() => {
  if (!canExposeConfigJson.value) return getMessage('popupConfigNeedsConnection');
  return getMessage('popupRemoteConfigHint');
});

const activeConfigJson = computed(() => {
  const port = serverPort.value;
  const lanIp = lanIpAddress.value;

  switch (activeConfigTab.value) {
    case 'stdio':
      return JSON.stringify(
        {
          mcpServers: {
            tabrix: {
              command: 'tabrix-stdio',
            },
          },
        },
        null,
        2,
      );
    case 'remote': {
      const remoteHost = lanIp || getMessage('popupLanIpPlaceholder');
      const config: any = {
        mcpServers: {
          tabrix: {
            url: `http://${remoteHost}:${port}/mcp`,
          },
        },
      };
      const tok = tokenInfo.value?.token;
      if (tok) {
        config.mcpServers.tabrix.headers = {
          Authorization: `Bearer ${tok}`,
        };
      }
      return JSON.stringify(config, null, 2);
    }
    default:
      return '';
  }
});

const getStatusClass = () => stateToStatusClass(connectionState.value);
const statusToneClass = computed(() => {
  switch (connectionState.value) {
    case ConnectionState.RUNNING:
      return 'status-inline--running';
    case ConnectionState.CONNECTED:
      return 'status-inline--warning';
    case ConnectionState.ERROR:
    case ConnectionState.DISCONNECTED:
      return 'status-inline--error';
    case ConnectionState.CONNECTING:
    case ConnectionState.UNKNOWN:
    default:
      return 'status-inline--neutral';
  }
});
const statusUpdatedTimeText = computed(() => {
  if (!serverStatus.value.lastUpdated) return '';
  return new Date(serverStatus.value.lastUpdated).toLocaleTimeString();
});
const statusHeadlineText = computed(() => {
  switch (connectionState.value) {
    case ConnectionState.RUNNING:
      return getMessage('serviceRunningShort');
    case ConnectionState.CONNECTED:
      return getMessage('connectedServiceNotStartedShort');
    case ConnectionState.CONNECTING:
      return getMessage('detectingStatus');
    case ConnectionState.ERROR:
    case ConnectionState.DISCONNECTED:
      return getMessage('serviceNotConnectedShort');
    case ConnectionState.UNKNOWN:
    default:
      return getMessage('detectingStatus');
  }
});
const statusDetailLevel = computed(() =>
  connectionState.value === ConnectionState.ERROR ? 'error' : 'info',
);
const showTroubleshootingEntry = computed(() => connectionState.value === ConnectionState.ERROR);

// Open sidepanel and close popup
async function openSidepanelAndClose(tab: string) {
  try {
    const current = await chrome.windows.getCurrent();
    if ((chrome.sidePanel as any)?.setOptions) {
      await (chrome.sidePanel as any).setOptions({
        path: `sidepanel.html?tab=${tab}`,
        enabled: true,
      });
    }
    if (chrome.sidePanel && (chrome.sidePanel as any).open) {
      await (chrome.sidePanel as any).open({ windowId: current.id! });
    }
    // Close popup after opening sidepanel
    window.close();
  } catch (e) {
    console.warn(`Failed to open sidepanel (${tab}):`, e);
  }
}

async function openWelcomePage() {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } catch {
    // ignore
  }
}

async function openTroubleshooting() {
  try {
    await chrome.tabs.create({ url: LINKS.TROUBLESHOOTING });
  } catch {
    // ignore
  }
}

const statusDetailText = computed(() => {
  const state = connectionState.value;
  if (state === ConnectionState.ERROR && lastNativeError.value) {
    return (
      getPopupNativeErrorGuidance(lastNativeError.value) ||
      getMessage('popupStatusDetailErrorDefault', [lastNativeError.value])
    );
  }
  return '';
});

const repairCommandText = computed(() => {
  const state = connectionState.value;
  if (state === ConnectionState.ERROR && lastNativeError.value) {
    return getPopupRepairCommand(lastNativeError.value);
  }
  return null;
});

const troubleshootingCommands = computed(() => {
  const items: Array<{ id: string; title: string; command: string; note?: string }> = [];
  const seen = new Set<string>();
  const pushCommand = (id: string, title: string, command: string, note?: string) => {
    if (seen.has(command)) return;
    seen.add(command);
    items.push({ id, title, command, note });
  };

  pushCommand('doctor-fix', getMessage('popupTroubleshootDoctorFixTitle'), 'tabrix doctor --fix');

  pushCommand(
    'register-force',
    getMessage('popupTroubleshootRegisterForceTitle'),
    'tabrix register --force',
  );

  if (!daemonReachable.value) {
    pushCommand(
      'daemon-start',
      getMessage('popupTroubleshootDaemonStartTitle'),
      'tabrix daemon start',
    );
  }

  if (repairCommandText.value) {
    pushCommand('quick', getMessage('popupTroubleshootQuickFixTitle'), repairCommandText.value);
  }

  return items;
});

const troubleshootingScript = computed(() => {
  const lines = [
    '# Tabrix quick troubleshooting',
    '',
    '# 1) Auto-fix common issues',
    'tabrix doctor --fix',
    '',
    '# 2) Force re-register Native host',
    'tabrix register --force',
  ];

  let step = 3;
  if (!daemonReachable.value) {
    lines.push('', `# ${step}) Start daemon (optional)`, 'tabrix daemon start');
    step++;
  }

  if (repairCommandText.value) {
    lines.push('', `# ${step}) Current error targeted fix`, repairCommandText.value);
    step++;
  }

  lines.push('', `# ${step}) Fully restart Chrome, then reload extension in chrome://extensions/`);

  return lines.join('\n');
});

const portReconnectHint = ref('');
let portReconnectHintTimer: ReturnType<typeof setTimeout> | null = null;

function showPortHint(msg: string, durationMs = 3000) {
  portReconnectHint.value = msg;
  if (portReconnectHintTimer) clearTimeout(portReconnectHintTimer);
  portReconnectHintTimer = setTimeout(() => {
    portReconnectHint.value = '';
  }, durationMs);
}

const updatePort = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const newPort = resolvePopupPortUpdate({
    currentPort: nativeServerPort.value,
    nextValue: target.value,
    allowEdit: !connectActionState.value.busy,
  });
  if (newPort === nativeServerPort.value) {
    target.value = String(nativeServerPort.value);
    return;
  }
  if (newPort <= 0 || newPort > 65535 || !Number.isFinite(newPort)) {
    target.value = String(nativeServerPort.value);
    return;
  }

  const oldPort = nativeServerPort.value;
  nativeServerPort.value = newPort;
  await savePortPreference(newPort);

  const wasConnected = nativeConnectionStatus.value === 'connected' || serverStatus.value.isRunning;

  if (!wasConnected) {
    showPortHint(`Port saved as ${newPort}. It will apply on next Connect.`);
    return;
  }

  showPortHint(`Port ${oldPort} -> ${newPort}, reconnecting...`, 10000);
  isConnecting.value = true;
  try {
    await chrome.runtime.sendMessage({ type: 'disconnect_native' });
    await new Promise((r) => setTimeout(r, 300));

    const response = await chrome.runtime.sendMessage({
      type: 'connectNative',
      port: newPort,
    });

    if (response && response.lastError !== undefined) {
      lastNativeError.value = normalizeNativeLastError(response.lastError);
    }
    if (response?.success && response?.connected) {
      await refreshServerStatus();
      showPortHint(`Switched to port ${newPort}`);
    } else {
      nativeConnectionStatus.value = 'disconnected';
      await refreshServerStatus();
      showPortHint(`Failed to connect on port ${newPort}. Please check and retry.`, 5000);
    }
  } catch (error) {
    console.error('Failed to reconnect after port change:', error);
    applyDisconnectedPopupSnapshot();
    await refreshStandaloneDaemonStatus();
    showPortHint(
      `Port switch failed: ${error instanceof Error ? error.message : String(error)}`,
      5000,
    );
  } finally {
    isConnecting.value = false;
  }
};

const checkNativeConnection = async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ping_native' });
    nativeConnectionStatus.value = response?.connected ? 'connected' : 'disconnected';
    await refreshStandaloneDaemonStatus();
  } catch (error) {
    console.error('Failed to detect Native connection status:', error);
    applyDisconnectedPopupSnapshot();
    await refreshStandaloneDaemonStatus();
  }
};

const checkServerStatus = async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }
    if (response && response.lastError !== undefined) {
      lastNativeError.value = normalizeNativeLastError(response.lastError);
    }

    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }

    await refreshStandaloneDaemonStatus();
    await fetchConnectedClients();
  } catch (error) {
    console.error('Failed to detect server status:', error);
    applyDisconnectedPopupSnapshot();
    await refreshStandaloneDaemonStatus();
  }
};

const refreshServerStatus = async () => {
  try {
    const response = await sendRuntimeMessageWithNoSwRetry({
      type: BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS,
    });
    if (response?.success && response.serverStatus) {
      serverStatus.value = response.serverStatus;
    }
    if (response && response.lastError !== undefined) {
      lastNativeError.value = normalizeNativeLastError(response.lastError);
    }

    if (response?.connected !== undefined) {
      nativeConnectionStatus.value = response.connected ? 'connected' : 'disconnected';
    }

    await refreshStandaloneDaemonStatus();
    await fetchConnectedClients();
  } catch (error) {
    if (!isNoServiceWorkerError(error)) {
      console.error('Failed to refresh server status:', error);
    }
    applyDisconnectedPopupSnapshot();
    await refreshStandaloneDaemonStatus();
  }
};

const refreshOverview = async () => {
  await refreshServerStatus();
  if (activeConfigTab.value === 'remote') {
    await fetchTokenInfo({ autoCreateWhenMissing: true });
  }
};

const copyMcpConfig = async () => {
  if (!canCopyActiveConfig.value) {
    copyButtonText.value = getMessage('popupConfigNeedsConnection');
    setTimeout(() => {
      copyButtonText.value = getMessage('copyConfigButton');
    }, 1500);
    return;
  }
  try {
    await navigator.clipboard.writeText(activeConfigJson.value);
    copyButtonText.value = getMessage('configCopiedNotification');

    setTimeout(() => {
      copyButtonText.value = getMessage('copyConfigButton');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy config:', error);
    copyButtonText.value = getMessage('popupCopyFailed');

    setTimeout(() => {
      copyButtonText.value = getMessage('copyConfigButton');
    }, 2000);
  }
};

const copyRepairCommand = async () => {
  if (!repairCommandText.value) return;
  try {
    await navigator.clipboard.writeText(repairCommandText.value);
    repairCommandButtonText.value = getMessage('popupCopiedShort');
    setTimeout(() => {
      repairCommandButtonText.value = getMessage('popupCopyRepairCommand');
    }, 2000);
  } catch (error) {
    console.error('Failed to copy repair command:', error);
    repairCommandButtonText.value = getMessage('popupCopyFailed');
    setTimeout(() => {
      repairCommandButtonText.value = getMessage('popupCopyRepairCommand');
    }, 2000);
  }
};

const copyTroubleshootingCommand = async (command: string) => {
  try {
    await navigator.clipboard.writeText(command);
    copiedTroubleshootingCommand.value = command;
    setTimeout(() => {
      if (copiedTroubleshootingCommand.value === command) {
        copiedTroubleshootingCommand.value = null;
      }
    }, 2000);
  } catch (error) {
    console.error('Failed to copy troubleshooting command:', error);
  }
};

const copyTroubleshootingScript = async () => {
  try {
    await navigator.clipboard.writeText(troubleshootingScript.value);
    copiedTroubleshootingScript.value = true;
    setTimeout(() => {
      copiedTroubleshootingScript.value = false;
    }, 2200);
  } catch (error) {
    console.error('Failed to copy full troubleshooting script:', error);
    copiedTroubleshootingScript.value = false;
  }
};

const remoteToggling = ref(false);

const toggleRemoteAccess = async () => {
  if (remoteToggling.value) return;
  const enable = !remoteAccessEnabled.value;
  const hadTokenBefore = Boolean(tokenInfo.value);
  remoteToggling.value = true;
  remoteToggleCopiedText.value = enable
    ? getMessage('popupEnablingRemote')
    : getMessage('popupDisablingRemote');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'set_remote_access',
      enable,
    });
    if (!response?.success) {
      remoteToggleCopiedText.value = `❌ ${getMessage('popupToggleFailedPrefix')} ${response?.error || getMessage('unknownErrorMessage')}`;
      setTimeout(() => {
        remoteToggleCopiedText.value = '';
      }, 3000);
      return;
    }

    await waitMs(400);
    await waitForRemoteAccessState(enable);
    if (enable) {
      await ensureRemoteTokenReady();
    } else {
      tokenInfo.value = null;
    }

    if (!enable) {
      remoteToggleCopiedText.value = getMessage('popupRemoteRestoredLocalOnly');
    } else if (!hadTokenBefore && tokenInfo.value) {
      remoteToggleCopiedText.value = getMessage('popupRemoteEnabledWithToken');
    } else {
      remoteToggleCopiedText.value = getMessage('popupRemoteEnabled');
    }
    setTimeout(() => {
      remoteToggleCopiedText.value = '';
    }, 2500);
  } catch (error) {
    console.error('Failed to toggle remote access:', error);
    remoteToggleCopiedText.value = `❌ ${getMessage('popupToggleFailedPrefix')} ${error instanceof Error ? error.message : String(error)}`;
    setTimeout(() => {
      remoteToggleCopiedText.value = '';
    }, 3000);
  } finally {
    remoteToggling.value = false;
  }
};

const testNativeConnection = async () => {
  if (isConnecting.value) return;
  isConnecting.value = true;
  try {
    if (nativeConnectionStatus.value === 'connected') {
      await chrome.runtime.sendMessage({ type: 'disconnect_native' });
      await refreshServerStatus();
    } else {
      console.log(`Trying to connect to port: ${nativeServerPort.value}`);

      const response = await chrome.runtime.sendMessage({
        type: 'connectNative',
        port: nativeServerPort.value,
      });
      if (response && response.lastError !== undefined) {
        lastNativeError.value = normalizeNativeLastError(response.lastError);
      }
      if (response?.success && response?.connected) {
        await refreshServerStatus();
        const isStillConnected = String(nativeConnectionStatus.value) === 'connected';
        if (isStillConnected) {
          console.log('Connected:', response);
          await savePortPreference(nativeServerPort.value);
        } else {
          console.warn('Native host disconnected before status settled:', response);
        }
      } else {
        nativeConnectionStatus.value = 'disconnected';
        const normalizedReason =
          normalizeNativeLastError(response?.lastError) ??
          normalizeNativeLastError(response?.error) ??
          getMessage('popupStatusDetailDisconnected');
        console.error(`[Tabrix] Native connection failed: ${normalizedReason}`);
        if (response !== undefined) {
          console.debug('[Tabrix] Native connection response:', response);
        }
        await refreshServerStatus();
      }
    }
  } catch (error) {
    const normalizedError = normalizeNativeLastError(error) ?? getMessage('unknownErrorMessage');
    console.error(`[Tabrix] Connection test failed: ${normalizedError}`);
    applyDisconnectedPopupSnapshot();
    await refreshStandaloneDaemonStatus();
  } finally {
    isConnecting.value = false;
  }
};

const savePortPreference = async (port: number) => {
  try {
    await chrome.storage.local.set({ nativeServerPort: port });
    console.log(`Port preference saved: ${port}`);
  } catch (error) {
    console.error('Failed to save port preference:', error);
  }
};

const loadPortPreference = async () => {
  try {
    const result = await chrome.storage.local.get(['nativeServerPort']);
    if (result.nativeServerPort) {
      nativeServerPort.value = result.nativeServerPort;
      console.log(`Loaded port preference: ${result.nativeServerPort}`);
    }
  } catch (error) {
    console.error('Failed to load port preference:', error);
  }
};

const setupServerStatusListener = () => {
  const onMessage = (message: {
    type?: string;
    payload?: unknown;
    connected?: boolean;
    lastError?: unknown;
  }) => {
    if (message.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
      const nextServerStatus = message.payload as ServerStatus;
      if (
        !shouldApplyPopupServerStatusMessage({
          desiredPort: nativeServerPort.value,
          isBusy: connectActionState.value.busy,
          serverStatus: nextServerStatus,
          connected: message.connected,
        })
      ) {
        return;
      }

      serverStatus.value = nextServerStatus;
      if (message.connected !== undefined) {
        nativeConnectionStatus.value = message.connected ? 'connected' : 'disconnected';
      }
      if (message.lastError !== undefined) {
        lastNativeError.value = normalizeNativeLastError(message.lastError);
      }
      if (message.connected && nextServerStatus.isRunning) {
        void fetchConnectedClients();
      } else {
        connectedClients.value = [];
      }
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  // Store reference for cleanup
  (window as any).__tabrix_popup_onMessage = onMessage;
};

onMounted(async () => {
  try {
    await initTheme();
    await loadPortPreference();
    await checkNativeConnection();
    await checkServerStatus();
    setupServerStatusListener();

    // Popup defaults to a read-only status view.
    // Only enable auto-connect when explicitly requested via `?autoconnect=1`.
    const allowAutoConnect = shouldPopupAutoConnect(window.location.search);
    if (allowAutoConnect && nativeConnectionStatus.value !== 'connected') {
      await testNativeConnection();
      await refreshServerStatus();
    }
  } finally {
    isBootstrappingStatus.value = false;
  }
});

onUnmounted(() => {
  try {
    const msgFn = (window as any).__tabrix_popup_onMessage;
    if (msgFn && chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(msgFn);
    }
  } catch {}
});
</script>

<style scoped>
.popup-container {
  background:
    radial-gradient(circle at 12% -10%, rgba(217, 119, 87, 0.18), transparent 48%),
    radial-gradient(circle at 88% -18%, rgba(30, 64, 175, 0.14), transparent 44%),
    linear-gradient(165deg, #f8fafc 0%, #eef2ff 52%, #f8fafc 100%);
  border-radius: 24px;
  box-shadow: 0 22px 50px -24px rgba(15, 23, 42, 0.5);
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100%;
  height: 100%;
  overflow: hidden;
  font-family:
    'Segoe UI Variable', 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
}

.header {
  flex-shrink: 0;
  position: relative;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(203, 213, 225, 0.92);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9) 0%, rgba(241, 245, 249, 0.76) 100%);
  backdrop-filter: blur(8px);
}

.header::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 1px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(217, 119, 87, 0.28) 12%,
    rgba(59, 130, 246, 0.18) 46%,
    rgba(99, 102, 241, 0.14) 68%,
    transparent 100%
  );
  opacity: 0.9;
  pointer-events: none;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 34px;
}

.header-meta {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
}

.header-mainline {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
  min-width: 0;
  flex-wrap: nowrap;
  white-space: nowrap;
  overflow: hidden;
}

.header-title {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.02;
  letter-spacing: -0.04em;
  color: #0f172a;
  margin: 0;
  text-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
}

.header-separator {
  color: #94a3b8;
  font-size: 14px;
  font-weight: 700;
}

.header-context {
  margin: 0;
  font-size: 11px;
  font-weight: 620;
  line-height: 1;
  color: #64748b;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-theme-button {
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: 10px;
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.92);
  color: #475569;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;
}

.header-theme-icon {
  width: 22px;
  height: 22px;
  display: block;
  color: currentColor;
}

.header-theme-glyph {
  transform-origin: center;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition:
    transform 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease;
}

.header-theme-glyph-sun {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.header-theme-glyph-moon {
  opacity: 0;
  transform: rotate(-30deg) scale(0.78);
}

.header-theme-button:hover {
  color: #0f172a;
  border-color: #94a3b8;
  transform: translateY(-1px);
  box-shadow: 0 10px 18px -16px rgba(15, 23, 42, 0.75);
}

.header-theme-button.active {
  border-color: rgba(34, 211, 238, 0.54);
  color: #0e7490;
  box-shadow:
    0 10px 18px -16px rgba(6, 182, 212, 0.7),
    0 0 0 1px rgba(34, 211, 238, 0.18) inset;
}

.header-theme-button.active .header-theme-glyph-sun {
  opacity: 0;
  transform: rotate(30deg) scale(0.78);
}

.header-theme-button.active .header-theme-glyph-moon {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.header-refresh-button {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: rgba(255, 255, 255, 0.9);
  color: #475569;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
}

.header-action-icon {
  width: 22px;
  height: 22px;
}

.header-refresh-button:hover {
  color: #0f172a;
  border-color: #94a3b8;
  transform: translateY(-1px);
  box-shadow: 0 10px 18px -16px rgba(15, 23, 42, 0.75);
}

.header-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 128px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(6px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.header-status-dot {
  height: 8px;
  width: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.header-status-dot.bg-emerald-500 {
  background-color: #10b981;
}

.header-status-dot.bg-red-500 {
  background-color: #ef4444;
}

.header-status-dot.bg-yellow-500 {
  background-color: #eab308;
}

.header-status-dot.bg-gray-500 {
  background-color: #6b7280;
}

.header-status-text {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-button {
  padding: 8px;
  border-radius: 50%;
  color: #64748b;
  background: none;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.settings-button:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.content {
  flex-grow: 1;
  padding: 8px 14px 12px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.content::-webkit-scrollbar {
  display: none;
}
.status-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 20px;
  margin-bottom: 20px;
}

.status-inline {
  display: flex;
  align-items: center;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.88) 0%, #f8fafc 100%);
  border: 1px solid #dbe3ef;
  border-radius: 11px;
  padding: 8px 10px;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.status-inline--running {
  background: linear-gradient(180deg, #f3fbf7 0%, #ecfdf5 100%);
  border-color: #86efac;
  box-shadow: 0 10px 16px -16px rgba(22, 163, 74, 0.7);
}

.status-inline--warning {
  background: linear-gradient(180deg, #fffbeb 0%, #fefce8 100%);
  border-color: #fcd34d;
  box-shadow: 0 10px 16px -16px rgba(202, 138, 4, 0.75);
}

.status-inline--error {
  background: linear-gradient(180deg, #fef2f2 0%, #fff1f2 100%);
  border-color: #fda4af;
  box-shadow: 0 10px 16px -16px rgba(220, 38, 38, 0.72);
}

.status-inline--error .status-text {
  color: #9f1239;
}

.status-inline--warning .status-text {
  color: #92400e;
}

.status-mainline {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
  gap: 10px;
}

.status-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.status-updated {
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.3;
  color: #94a3b8;
}

.status-dot {
  height: 9px;
  width: 9px;
  border-radius: 50%;
}

.status-dot.bg-emerald-500 {
  background-color: #10b981;
}

.status-dot.bg-red-500 {
  background-color: #ef4444;
}

.status-dot.bg-yellow-500 {
  background-color: #eab308;
}

.status-dot.bg-gray-500 {
  background-color: #6b7280;
}

.status-text {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.model-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin-bottom: 4px;
}

.model-name {
  font-weight: 600;
  color: #7c3aed;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.stats-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 16px;
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.stats-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
}

.stats-icon {
  padding: 8px;
  border-radius: 8px;
}

.stats-icon.violet {
  background: #ede9fe;
  color: #7c3aed;
}

.stats-icon.teal {
  background: #ccfbf1;
  color: #0d9488;
}

.stats-icon.blue {
  background: #dbeafe;
  color: #2563eb;
}

.stats-icon.green {
  background: #dcfce7;
  color: #16a34a;
}

.stats-value {
  font-size: 30px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.section {
  margin-bottom: 16px;
}

.secondary-button {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.secondary-button:hover:not(:disabled) {
  background: #e2e8f0;
  border-color: #94a3b8;
}

.secondary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary-button {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.primary-button:hover {
  background: #2563eb;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #334155;
  margin: 0 0 12px;
}
.current-model-card {
  background: linear-gradient(135deg, #faf5ff, #f3e8ff);
  border: 1px solid #e9d5ff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.current-model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.current-model-label {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  margin: 0;
}

.current-model-badge {
  background: #8b5cf6;
  color: white;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}

.current-model-name {
  font-size: 16px;
  font-weight: 700;
  color: #7c3aed;
  margin: 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
}

.model-card:hover {
  border-color: #8b5cf6;
}

.model-card.selected {
  border: 2px solid #8b5cf6;
  background: #faf5ff;
}

.model-card.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.model-info {
  flex: 1;
}

.model-name {
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.model-name.selected-text {
  color: #7c3aed;
}

.model-description {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

.check-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  background: #8b5cf6;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}
.model-tag {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
}

.model-tag.performance {
  background: #d1fae5;
  color: #065f46;
}

.model-tag.size {
  background: #ddd6fe;
  color: #5b21b6;
}

.model-tag.dimension {
  background: #e5e7eb;
  color: #4b5563;
}

.config-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, #ffffff 100%);
  border: 1px solid rgba(203, 213, 225, 0.95);
  border-radius: 14px;
  box-shadow:
    0 14px 28px -26px rgba(15, 23, 42, 0.78),
    0 1px 0 rgba(255, 255, 255, 0.92) inset;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.semantic-engine-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.semantic-engine-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.semantic-engine-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #8b5cf6;
  color: white;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.semantic-engine-button:hover:not(:disabled) {
  background: #7c3aed;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.semantic-engine-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.refresh-status-button {
  background: rgba(241, 245, 249, 0.95);
  border: 1px solid #dbe4ef;
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s ease;
}

.refresh-status-button:hover {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #334155;
  transform: translateY(-1px);
}

.status-detail {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 10px;
  padding: 8px 10px;
  word-break: break-word;
}

.status-detail-info {
  color: #334155;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.22);
}

.status-detail-error {
  color: #8b5e34;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.16);
}

.status-detail-actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.repair-command-button {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(37, 99, 235, 0.26);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(241, 245, 249, 0.94) 100%);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.repair-command-button:hover {
  border-color: rgba(37, 99, 235, 0.44);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(239, 246, 255, 0.98) 100%);
  transform: translateY(-1px);
}

.repair-guide-button {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(100, 116, 139, 0.28);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.94) 100%);
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.repair-guide-button:hover {
  border-color: rgba(100, 116, 139, 0.42);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(241, 245, 249, 0.98) 100%);
  transform: translateY(-1px);
}

.troubleshooting-dialog {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.52);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 14px;
}

.troubleshooting-content {
  width: min(620px, 100%);
  max-height: 86vh;
  overflow: auto;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%);
  border: 1px solid rgba(203, 213, 225, 0.88);
  border-radius: 14px;
  padding: 14px;
  box-shadow:
    0 26px 48px -26px rgba(15, 23, 42, 0.5),
    0 8px 22px -20px rgba(30, 64, 175, 0.22);
}

.troubleshooting-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.9);
}

.troubleshooting-title-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.troubleshooting-header h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
  font-weight: 760;
  color: #0f172a;
}

.troubleshooting-close {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(203, 213, 225, 0.85);
  background: rgba(255, 255, 255, 0.88);
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.16s ease;
}

.troubleshooting-close:hover {
  border-color: rgba(148, 163, 184, 0.9);
  color: #334155;
  transform: translateY(-1px);
}

.troubleshooting-desc {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.45;
}

.troubleshooting-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.troubleshooting-item {
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.94) 0%, rgba(241, 245, 249, 0.86) 100%);
  border: 1px solid rgba(203, 213, 225, 0.82);
  border-radius: 10px;
  padding: 10px 10px 9px;
}

.troubleshooting-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}

.troubleshooting-item-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #374151;
  min-width: 0;
}

.troubleshooting-item-index {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #1d4ed8;
  background: rgba(219, 234, 254, 0.95);
  border: 1px solid rgba(147, 197, 253, 0.95);
}

.troubleshooting-item-command {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  font-family:
    'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', 'Liberation Mono', monospace;
  white-space: pre-wrap;
  word-break: break-all;
  color: #0f172a;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(203, 213, 225, 0.88);
  border-radius: 8px;
  padding: 7px 8px;
}

.troubleshooting-item-note {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: #64748b;
}

.troubleshooting-copy {
  border: 1px solid rgba(148, 163, 184, 0.42);
  background: rgba(255, 255, 255, 0.96);
  color: #374151;
  font-size: 12px;
  font-weight: 650;
  border-radius: 7px;
  min-height: 28px;
  padding: 0 9px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.troubleshooting-copy:hover {
  border-color: rgba(100, 116, 139, 0.52);
  background: #ffffff;
}

.troubleshooting-actions {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.troubleshooting-action-btn {
  flex: 1 1 140px;
  min-height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.42);
  background: rgba(255, 255, 255, 0.98);
  color: #374151;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 650;
  padding: 0 10px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.troubleshooting-action-btn.secondary:hover {
  border-color: rgba(30, 64, 175, 0.48);
  color: #1e40af;
}

.troubleshooting-action-btn.primary {
  border-color: rgba(37, 99, 235, 0.42);
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
  color: #eff6ff;
  box-shadow: 0 12px 18px -16px rgba(37, 99, 235, 0.66);
}

.troubleshooting-action-btn.primary:hover {
  background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
  transform: translateY(-1px);
}

/* Connected clients */
.connected-clients-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 6px;
}

.connected-clients-section.connected-clients-empty {
  padding-bottom: 2px;
}

.connected-clients-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.connected-clients-label {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin: 0;
}

.connected-clients-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.connected-client-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
}

.client-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.client-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.client-name {
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100px;
}

.client-meta {
  color: #94a3b8;
  white-space: nowrap;
  font-size: 11px;
}

.client-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.client-time {
  color: #94a3b8;
  font-size: 11px;
  white-space: nowrap;
}

.client-disconnect-btn {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  color: #ef4444;
  cursor: pointer;
  padding: 1px 5px;
  font-size: 11px;
  line-height: 1;
  transition: all 0.15s;
}

.client-disconnect-btn:hover {
  background: #fef2f2;
  border-color: #fca5a5;
}

.mcp-config-section {
  border-top: 1px solid #f1f5f9;
  padding-top: 8px;
}

.mcp-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mcp-config-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 9px;
  padding: 4px;
}

.mcp-tab {
  flex: 1;
  min-height: 30px;
  padding: 6px 8px;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.mcp-tab:hover {
  color: #374151;
  background: rgba(255, 255, 255, 0.5);
}

.mcp-tab.active {
  color: #0f172a;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #dbe4ef;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
  font-weight: 600;
}

.mcp-config-hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
  line-height: 1.45;
}

.remote-toggle-card {
  margin-bottom: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #cfe0ff;
  background: #f8fbff;
}

.remote-toggle-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.remote-toggle-title {
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
}

.remote-toggle-desc {
  font-size: 11px;
  color: #475569;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remote-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.remote-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.remote-switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #cbd5e1;
  border-radius: 20px;
  transition: background 0.25s;
}

.remote-switch-slider::before {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.25s;
}

.remote-switch input:checked + .remote-switch-slider {
  background: #1d4ed8;
}

.remote-switch input:checked + .remote-switch-slider::before {
  transform: translateX(16px);
}

.remote-switch input:disabled + .remote-switch-slider {
  opacity: 0.45;
  cursor: not-allowed;
}

.remote-switch.disabled {
  pointer-events: none;
}

.remote-toggle-copied {
  margin-top: 6px;
  font-size: 11px;
  color: #0369a1;
}

.remote-disabled-hint {
  font-size: 11px;
  color: #64748b;
  text-align: center;
  padding: 12px 8px;
  background: #f8fafc;
  border-radius: 6px;
  border: 1px dashed #cbd5e1;
}

.mcp-network-info {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
  font-size: 10.5px;
  color: #94a3b8;
  flex-wrap: wrap;
}

.network-label {
  color: #94a3b8;
}

.network-ip {
  font-family: 'Monaco', 'Menlo', monospace;
  color: #64748b;
  font-weight: 500;
}

.network-sep {
  color: #cbd5e1;
  margin: 0 2px;
}

.network-link {
  color: #3b82f6;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color 0.15s;
}

.network-link:hover {
  text-decoration-color: #3b82f6;
}

.mcp-security-warning {
  font-size: 11px;
  line-height: 1.4;
  color: #92400e;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
}

.mcp-config-label {
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  margin: 0;
}

.copy-config-button {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #cbd5e1;
  cursor: pointer;
  min-width: 74px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #334155;
  transition: all 0.18s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.copy-config-button:hover {
  background: #ffffff;
  border-color: #94a3b8;
  color: #0f172a;
  transform: translateY(-1px);
  box-shadow: 0 8px 16px -14px rgba(15, 23, 42, 0.62);
}

.copy-config-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  background: #eef2f7;
  color: #94a3b8;
  border-color: #dbe4ef;
}

.mcp-config-content {
  background: linear-gradient(180deg, #f8fbff 0%, #f2f7ff 100%);
  border: 1px solid #c6d3e5;
  border-radius: 11px;
  padding: 12px;
  overflow: auto;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
}

.mcp-config-json {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #374151;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-height: 198px;
  overflow: auto;
}

.port-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.port-label {
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
}

.port-input {
  display: block;
  width: 100%;
  border-radius: 9px;
  border: 1px solid #d1d5db;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  padding: 8px 10px;
  font-size: 14px;
  background: #f8fafc;
}

.port-input:focus {
  outline: none;
  border-color: var(--ac-accent, #d97757);
  box-shadow: 0 0 0 3px var(--ac-accent-subtle, rgba(217, 119, 87, 0.12));
}

.port-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ac-accent, #d97757);
  line-height: 1.4;
}

.connect-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
  color: #eff6ff;
  font-weight: 600;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.44);
  cursor: pointer;
  transition: all var(--ac-motion-fast, 120ms) ease;
  box-shadow:
    0 14px 24px -14px rgba(37, 99, 235, 0.66),
    0 1px 0 rgba(255, 255, 255, 0.22) inset;
}

.connect-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
  border-color: rgba(59, 130, 246, 0.58);
  transform: translateY(-1px);
  box-shadow:
    0 18px 26px -14px rgba(37, 99, 235, 0.72),
    0 1px 0 rgba(255, 255, 255, 0.24) inset;
}

.connect-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connect-button.is-disconnect {
  border: 1px solid rgba(244, 63, 94, 0.42);
  background: linear-gradient(180deg, #fb7185 0%, #e11d48 58%, #be123c 100%);
  color: #fff1f2;
  box-shadow:
    0 14px 24px -14px rgba(225, 29, 72, 0.56),
    0 1px 0 rgba(255, 255, 255, 0.22) inset,
    0 -1px 0 rgba(136, 19, 55, 0.38) inset;
}

.connect-button.is-disconnect:hover:not(:disabled) {
  background: linear-gradient(180deg, #fb4d6f 0%, #e11d48 54%, #9f1239 100%);
  border-color: rgba(244, 63, 94, 0.54);
  color: #fff1f2;
  transform: translateY(-1px);
  box-shadow:
    0 18px 26px -14px rgba(225, 29, 72, 0.62),
    0 1px 0 rgba(255, 255, 255, 0.24) inset,
    0 -1px 0 rgba(122, 16, 47, 0.48) inset;
}
.error-card {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.error-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.error-icon {
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.error-details {
  flex: 1;
}

.error-title {
  font-size: 14px;
  font-weight: 600;
  color: #dc2626;
  margin: 0 0 4px 0;
}

.error-message {
  font-size: 14px;
  color: #991b1b;
  margin: 0 0 8px 0;
  font-weight: 500;
}

.error-suggestion {
  font-size: 13px;
  color: #7f1d1d;
  margin: 0;
  line-height: 1.4;
}

.retry-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #dc2626;
  color: white;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
  flex-shrink: 0;
}

.retry-button:hover:not(:disabled) {
  background: #b91c1c;
}

.retry-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.danger-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: white;
  border: 1px solid #d1d5db;
  color: #374151;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 16px;
}

.danger-button:hover:not(:disabled) {
  border-color: #ef4444;
  color: #dc2626;
}

.danger-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Icon sizes - use :deep to apply to child components */
:deep(.icon-small) {
  width: 16px;
  height: 16px;
}

:deep(.icon-default) {
  width: 20px;
  height: 20px;
}

:deep(.icon-medium) {
  width: 24px;
  height: 24px;
}
.footer {
  padding: 10px 16px 14px;
  margin-top: 2px;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  margin-bottom: 6px;
}

.footer-link {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.footer-link:hover {
  color: #8b5cf6;
  background: #e2e8f0;
}

.footer-link svg {
  width: 14px;
  height: 14px;
}

.footer-text {
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  margin: 0;
}

.home-view .content .section:last-child {
  margin-bottom: 8px;
}

@media (max-width: 320px) {
  .popup-container {
    width: 100%;
    height: auto;
    min-height: 100%;
    max-height: 1080px;
    border-radius: 0;
  }

  .footer-links {
    gap: 8px;
  }

  .rr-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rr-controls {
    display: flex;
    gap: 8px;
  }
  .rr-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rr-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    border: 1px solid #eee;
    border-radius: 6px;
  }
  .rr-runoverrides {
    margin-top: 6px;
    border: 1px dashed #e5e7eb;
    border-radius: 8px;
    padding: 8px;
    background: #f9fafb;
  }
  .rr-meta {
    display: flex;
    flex-direction: column;
  }
  .rr-name {
    font-weight: 600;
  }
  .rr-desc {
    font-size: 12px;
    color: #666;
  }
  .empty {
    color: #888;
    font-size: 13px;
  }

  .header {
    padding: 10px 12px 8px;
  }

  .header-mainline {
    gap: 6px;
  }

  .header-title {
    font-size: 30px;
  }

  .header-context {
    font-size: 13px;
  }

  .header-status-chip {
    max-width: 120px;
    padding: 4px 8px;
  }

  .header-status-text {
    font-size: 10px;
  }

  .content {
    padding: 8px 12px 12px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .config-card {
    padding: 16px;
    gap: 12px;
  }

  .current-model-card {
    padding: 12px;
    margin-bottom: 12px;
  }

  .stats-card {
    padding: 12px;
  }

  .stats-value {
    font-size: 24px;
  }
}

@media (max-width: 420px) {
  .header-title {
    font-size: 22px;
  }
}

/* 快捷工具icon按钮样式 */
.rr-icon-buttons {
  display: flex;
  gap: 12px;
  justify-content: flex-start;
  padding: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, #ffffff 100%);
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 14px;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.65);
}

.rr-icon-btn {
  width: 46px;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ac-surface-muted, #f2f0eb);
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--ac-text-muted, #6e6e6e);
  cursor: pointer;
  transition: all var(--ac-motion-fast, 120ms) ease;
}

.rr-icon-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: rgba(148, 163, 184, 0.35);
  box-shadow: 0 10px 16px -12px rgba(15, 23, 42, 0.58);
}

.rr-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rr-icon-btn svg {
  width: 24px;
  height: 24px;
}

/* 录制按钮 - 红色 */
.rr-icon-btn-record {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.rr-icon-btn-record:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

/* 录制中状态 - 脉冲动画 */
.rr-icon-btn-recording {
  animation: pulse-recording 1.5s ease-in-out infinite;
}

@keyframes pulse-recording {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
}

/* 停止按钮 - 深红色 */
.rr-icon-btn-stop {
  background: rgba(185, 28, 28, 0.1);
  color: #b91c1c;
}

.rr-icon-btn-stop:hover:not(:disabled) {
  background: rgba(185, 28, 28, 0.2);
  color: #991b1b;
}

/* 编辑按钮 - 蓝色 */
.rr-icon-btn-edit {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}

.rr-icon-btn-edit:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.2);
  color: #1d4ed8;
}

/* 标注按钮 - 绿色 */
.rr-icon-btn-marker {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.rr-icon-btn-marker:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.2);
  color: #059669;
}

/* Coming Soon 按钮样式 */
.rr-icon-btn-coming-soon {
  opacity: 0.5;
  cursor: default !important;
}

.rr-icon-btn-coming-soon:hover {
  transform: none !important;
  box-shadow: none !important;
  opacity: 0.6;
}

/* CSS Tooltip - instant display */
.has-tooltip {
  position: relative;
}

.has-tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  color: var(--ac-text-inverse, #ffffff);
  background-color: var(--ac-text, #1a1a1a);
  border-radius: var(--ac-radius-button, 8px);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 80ms ease,
    visibility 80ms ease;
  pointer-events: none;
  z-index: 100;
}

.has-tooltip::before {
  content: '';
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: var(--ac-text, #1a1a1a);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 80ms ease,
    visibility 80ms ease;
  pointer-events: none;
  z-index: 100;
}

.has-tooltip:hover::after,
.has-tooltip:hover::before {
  opacity: 1;
  visibility: visible;
}

/* 首页视图 */
.home-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

/* 管理入口卡片样式 */
.entry-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, #ffffff 100%);
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 14px;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.65);
  overflow: hidden;
}

.entry-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--ac-border, #e7e5e4);
  cursor: pointer;
  transition: all var(--ac-motion-fast, 120ms) ease;
  text-align: left;
}

.entry-item:last-child {
  border-bottom: none;
}

.entry-item:hover {
  background: rgba(241, 245, 249, 0.86);
}

.entry-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ac-radius-button, 8px);
  flex-shrink: 0;
}

.entry-icon.agent {
  background: rgba(217, 119, 87, 0.12);
  color: var(--ac-accent, #d97757);
}

.entry-icon.workflow {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.entry-icon.marker {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.entry-icon.model {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.entry-icon.token {
  background: rgba(234, 88, 12, 0.12);
  color: #ea580c;
}

.entry-content {
  flex: 1;
  min-width: 0;
}

.entry-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--ac-text, #1a1a1a);
  line-height: 1.3;
}

.entry-desc {
  display: block;
  font-size: 12px;
  color: var(--ac-text-subtle, #a8a29e);
  line-height: 1.3;
  margin-top: 2px;
}

.entry-arrow {
  color: var(--ac-text-subtle, #a8a29e);
  flex-shrink: 0;
}

/* Coming Soon Badge */
.coming-soon-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 2px 6px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--ac-accent, #d97757);
  background: rgba(217, 119, 87, 0.12);
  border-radius: 4px;
  vertical-align: middle;
}

.entry-item-coming-soon {
  opacity: 0.7;
}

.entry-item-coming-soon:hover {
  opacity: 0.85;
}

/* Coming Soon Toast */
.coming-soon-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: var(--ac-text, #1a1a1a);
  color: var(--ac-text-inverse, #ffffff);
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--ac-radius-card, 12px);
  box-shadow: var(--ac-shadow-float, 0 4px 20px -2px rgba(0, 0, 0, 0.15));
  z-index: 1000;
  white-space: nowrap;
}

.toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--ac-accent, #d97757);
}

/* Toast transition */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* Dark Console popup (OpenViking-inspired tech tone) */
.popup-container[data-agent-theme='dark-console'] {
  --popup-neon-cyan: #22d3ee;
  --popup-neon-blue: #38bdf8;
  --popup-neon-violet: #a855f7;
  --popup-bg-0: #020817;
  --popup-bg-1: #051226;
  --popup-surface: rgba(6, 18, 37, 0.78);
  --popup-surface-strong: rgba(9, 24, 48, 0.9);
  --popup-border: rgba(56, 189, 248, 0.26);
  --popup-border-strong: rgba(34, 211, 238, 0.42);
  --popup-text-main: #dbeafe;
  --popup-text-muted: #94a3b8;
  --popup-text-subtle: #64748b;
  background:
    radial-gradient(circle at 12% -12%, rgba(34, 211, 238, 0.28), transparent 48%),
    radial-gradient(circle at 90% -20%, rgba(168, 85, 247, 0.2), transparent 44%),
    linear-gradient(160deg, var(--popup-bg-0) 0%, var(--popup-bg-1) 55%, #040b18 100%);
  box-shadow:
    0 20px 42px -26px rgba(14, 165, 233, 0.27),
    0 8px 18px -18px rgba(168, 85, 247, 0.2);
}

.popup-container[data-agent-theme='dark-console'] .header {
  background: linear-gradient(180deg, rgba(6, 15, 30, 0.95) 0%, rgba(5, 14, 28, 0.9) 100%);
  border-bottom-color: rgba(56, 189, 248, 0.25);
}

.popup-container[data-agent-theme='dark-console'] .header::after {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(34, 211, 238, 0.5) 12%,
    rgba(56, 189, 248, 0.24) 42%,
    rgba(168, 85, 247, 0.2) 72%,
    transparent 100%
  );
  opacity: 0.9;
}

.popup-container[data-agent-theme='dark-console'] .header-title {
  color: #e0f2fe;
  text-shadow: 0 0 18px rgba(56, 189, 248, 0.35);
}

.popup-container[data-agent-theme='dark-console'] .header-context {
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .header-separator {
  color: #38bdf8;
}

.popup-container[data-agent-theme='dark-console'] .header-refresh-button {
  background: rgba(8, 22, 44, 0.82);
  border-color: rgba(56, 189, 248, 0.35);
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .header-theme-button {
  background: rgba(8, 22, 44, 0.82);
  border-color: rgba(56, 189, 248, 0.35);
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .header-theme-button:hover {
  border-color: rgba(34, 211, 238, 0.62);
  color: #e0f2fe;
  box-shadow: 0 12px 20px -16px rgba(34, 211, 238, 0.62);
}

.popup-container[data-agent-theme='dark-console'] .header-theme-button.active {
  border-color: rgba(34, 211, 238, 0.72);
  color: #a5f3fc;
  box-shadow:
    0 10px 18px -16px rgba(34, 211, 238, 0.72),
    0 0 0 1px rgba(34, 211, 238, 0.3) inset;
}

.popup-container[data-agent-theme='dark-console'] .header-refresh-button:hover {
  border-color: rgba(34, 211, 238, 0.62);
  color: #e0f2fe;
  box-shadow: 0 12px 20px -16px rgba(34, 211, 238, 0.62);
}

.popup-container[data-agent-theme='dark-console'] .config-card,
.popup-container[data-agent-theme='dark-console'] .entry-card,
.popup-container[data-agent-theme='dark-console'] .rr-icon-buttons {
  background: linear-gradient(180deg, rgba(5, 18, 36, 0.86) 0%, rgba(7, 20, 40, 0.92) 100%);
  border-color: var(--popup-border);
  box-shadow:
    0 1px 0 rgba(56, 189, 248, 0.18) inset,
    0 12px 20px -24px rgba(2, 132, 199, 0.42);
}

.popup-container[data-agent-theme='dark-console'] .section-title {
  color: #93c5fd;
}

.popup-container[data-agent-theme='dark-console'] .status-inline {
  background: linear-gradient(180deg, rgba(8, 24, 44, 0.86) 0%, rgba(6, 20, 38, 0.9) 100%);
  border-color: rgba(56, 189, 248, 0.32);
}

.popup-container[data-agent-theme='dark-console'] .status-inline--running {
  background: linear-gradient(180deg, rgba(5, 51, 58, 0.76) 0%, rgba(6, 38, 46, 0.78) 100%);
  border-color: rgba(45, 212, 191, 0.52);
  box-shadow: 0 10px 18px -18px rgba(34, 211, 238, 0.58);
}

.popup-container[data-agent-theme='dark-console'] .status-inline--warning {
  background: linear-gradient(180deg, rgba(70, 37, 6, 0.76) 0%, rgba(58, 30, 6, 0.78) 100%);
  border-color: rgba(251, 191, 36, 0.46);
}

.popup-container[data-agent-theme='dark-console'] .status-inline--error {
  background: linear-gradient(180deg, rgba(69, 10, 27, 0.74) 0%, rgba(60, 9, 26, 0.78) 100%);
  border-color: rgba(251, 113, 133, 0.5);
}

.popup-container[data-agent-theme='dark-console'] .status-text {
  color: var(--popup-text-main);
}

.popup-container[data-agent-theme='dark-console'] .status-updated,
.popup-container[data-agent-theme='dark-console'] .connected-clients-label,
.popup-container[data-agent-theme='dark-console'] .mcp-config-label,
.popup-container[data-agent-theme='dark-console'] .port-label {
  color: #9ec3e7;
}

.popup-container[data-agent-theme='dark-console'] .connected-clients-empty .connected-clients-label,
.popup-container[data-agent-theme='dark-console'] .entry-desc,
.popup-container[data-agent-theme='dark-console'] .remote-toggle-desc {
  color: #9ab8d8;
}

.popup-container[data-agent-theme='dark-console'] .remote-toggle-title {
  color: #dbeafe;
  font-weight: 700;
}

.popup-container[data-agent-theme='dark-console'] .remote-toggle-desc {
  color: #c7e6ff;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.popup-container[data-agent-theme='dark-console'] .remote-toggle-copied {
  color: #67e8f9;
}

.popup-container[data-agent-theme='dark-console'] .connected-clients-section,
.popup-container[data-agent-theme='dark-console'] .mcp-config-section {
  border-top-color: rgba(56, 189, 248, 0.2);
}

.popup-container[data-agent-theme='dark-console'] .mcp-config-tabs {
  background: rgba(8, 25, 46, 0.72);
  border-color: rgba(56, 189, 248, 0.24);
}

.popup-container[data-agent-theme='dark-console'] .mcp-tab {
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .mcp-tab.active {
  color: #e0f2fe;
  background: linear-gradient(180deg, rgba(8, 36, 66, 0.98) 0%, rgba(5, 24, 47, 0.98) 100%);
  border-color: rgba(34, 211, 238, 0.45);
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.34) inset;
}

.popup-container[data-agent-theme='dark-console'] .copy-config-button {
  background: rgba(8, 24, 44, 0.82);
  border-color: rgba(56, 189, 248, 0.35);
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .copy-config-button:hover {
  background: rgba(9, 31, 56, 0.95);
  border-color: rgba(34, 211, 238, 0.6);
  color: #e0f2fe;
}

.popup-container[data-agent-theme='dark-console'] .repair-command-button {
  border-color: rgba(34, 211, 238, 0.42);
  background: linear-gradient(180deg, rgba(8, 37, 68, 0.9) 0%, rgba(7, 30, 56, 0.92) 100%);
  color: #67e8f9;
}

.popup-container[data-agent-theme='dark-console'] .repair-command-button:hover {
  border-color: rgba(34, 211, 238, 0.68);
  color: #cffafe;
}

.popup-container[data-agent-theme='dark-console'] .repair-guide-button {
  border-color: rgba(56, 189, 248, 0.34);
  background: linear-gradient(180deg, rgba(8, 27, 49, 0.88) 0%, rgba(8, 24, 44, 0.9) 100%);
  color: #9ec3e7;
}

.popup-container[data-agent-theme='dark-console'] .repair-guide-button:hover {
  border-color: rgba(34, 211, 238, 0.5);
  color: #dbeafe;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-dialog {
  background: rgba(2, 6, 23, 0.72);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-content {
  background: linear-gradient(180deg, rgba(4, 18, 35, 0.96) 0%, rgba(4, 14, 28, 0.98) 100%);
  border-color: rgba(56, 189, 248, 0.38);
  box-shadow:
    0 28px 46px -26px rgba(2, 132, 199, 0.5),
    0 8px 24px -20px rgba(168, 85, 247, 0.3);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-header {
  border-bottom-color: rgba(56, 189, 248, 0.2);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-header h3 {
  color: #e0f2fe;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-desc,
.popup-container[data-agent-theme='dark-console'] .troubleshooting-item-note {
  color: #a5c9eb;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-close {
  border-color: rgba(56, 189, 248, 0.3);
  background: rgba(8, 24, 44, 0.82);
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-close:hover {
  border-color: rgba(34, 211, 238, 0.56);
  color: #dbeafe;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-item {
  background: linear-gradient(180deg, rgba(5, 18, 36, 0.92) 0%, rgba(6, 20, 38, 0.96) 100%);
  border-color: rgba(56, 189, 248, 0.3);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-item-title {
  color: #dbeafe;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-item-index {
  color: #67e8f9;
  background: rgba(7, 35, 61, 0.94);
  border-color: rgba(34, 211, 238, 0.48);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-item-command {
  color: #cfe8ff;
  background: rgba(3, 16, 33, 0.96);
  border-color: rgba(56, 189, 248, 0.32);
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-copy,
.popup-container[data-agent-theme='dark-console'] .troubleshooting-action-btn.secondary {
  border-color: rgba(56, 189, 248, 0.34);
  background: rgba(7, 26, 47, 0.9);
  color: #9ec3e7;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-copy:hover,
.popup-container[data-agent-theme='dark-console'] .troubleshooting-action-btn.secondary:hover {
  border-color: rgba(34, 211, 238, 0.56);
  color: #e0f2fe;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-action-btn.primary {
  border-color: rgba(56, 189, 248, 0.48);
  background: linear-gradient(180deg, #0891b2 0%, #0e7490 100%);
  color: #ecfeff;
}

.popup-container[data-agent-theme='dark-console'] .troubleshooting-action-btn.primary:hover {
  background: linear-gradient(180deg, #06b6d4 0%, #0e7490 100%);
}

.popup-container[data-agent-theme='dark-console'] .mcp-config-content,
.popup-container[data-agent-theme='dark-console'] .remote-toggle-card,
.popup-container[data-agent-theme='dark-console'] .port-input {
  background: linear-gradient(180deg, rgba(5, 16, 33, 0.92) 0%, rgba(6, 20, 38, 0.95) 100%);
  border-color: rgba(56, 189, 248, 0.32);
  color: var(--popup-text-main);
  box-shadow: inset 0 1px 0 rgba(34, 211, 238, 0.16);
}

.popup-container[data-agent-theme='dark-console'] .remote-switch-slider {
  background: rgba(51, 65, 85, 0.9);
  border: 1px solid rgba(125, 211, 252, 0.38);
}

.popup-container[data-agent-theme='dark-console'] .remote-switch-slider::before {
  background: #f0f9ff;
  box-shadow: 0 2px 6px rgba(8, 47, 73, 0.45);
}

.popup-container[data-agent-theme='dark-console']
  .remote-switch
  input:checked
  + .remote-switch-slider {
  background: linear-gradient(180deg, #06b6d4 0%, #0284c7 100%);
  border-color: rgba(34, 211, 238, 0.72);
}

.popup-container[data-agent-theme='dark-console'] .remote-disabled-hint {
  color: #9ec3e7;
  background: rgba(10, 30, 55, 0.56);
  border-color: rgba(56, 189, 248, 0.38);
}

.popup-container[data-agent-theme='dark-console'] .mcp-security-warning {
  color: #fde68a;
  background: rgba(120, 53, 15, 0.45);
  border-color: rgba(251, 191, 36, 0.4);
}

.popup-container[data-agent-theme='dark-console'] .mcp-config-json {
  color: #b9d9f8;
}

.popup-container[data-agent-theme='dark-console'] .entry-item {
  border-bottom-color: rgba(56, 189, 248, 0.16);
}

.popup-container[data-agent-theme='dark-console'] .entry-item:hover {
  background: rgba(8, 30, 55, 0.68);
}

.popup-container[data-agent-theme='dark-console'] .entry-title {
  color: #e0f2fe;
}

.popup-container[data-agent-theme='dark-console'] .entry-arrow {
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .connect-button {
  background: linear-gradient(180deg, #0891b2 0%, #0e7490 100%);
  color: #ecfeff;
  box-shadow:
    0 14px 22px -16px rgba(6, 182, 212, 0.62),
    0 0 0 1px rgba(34, 211, 238, 0.25) inset;
}

.popup-container[data-agent-theme='dark-console'] .connect-button:hover:not(:disabled) {
  background: linear-gradient(180deg, #06b6d4 0%, #0e7490 100%);
}

.popup-container[data-agent-theme='dark-console'] .connect-button.is-disconnect {
  background: linear-gradient(
    180deg,
    rgba(138, 34, 61, 0.94) 0%,
    rgba(112, 27, 50, 0.94) 56%,
    rgba(88, 21, 40, 0.95) 100%
  );
  border-color: rgba(251, 113, 133, 0.36);
  color: #ffe4e6;
  box-shadow:
    0 14px 22px -14px rgba(244, 63, 94, 0.44),
    0 1px 0 rgba(255, 228, 230, 0.2) inset,
    0 -1px 0 rgba(78, 17, 35, 0.62) inset;
}

.popup-container[data-agent-theme='dark-console']
  .connect-button.is-disconnect:hover:not(:disabled) {
  background: linear-gradient(
    180deg,
    rgba(164, 36, 70, 0.98) 0%,
    rgba(130, 28, 56, 0.98) 58%,
    rgba(99, 22, 44, 0.98) 100%
  );
  border-color: rgba(251, 113, 133, 0.5);
  color: #ffe4e6;
  transform: translateY(-1px);
  box-shadow:
    0 18px 26px -14px rgba(244, 63, 94, 0.5),
    0 1px 0 rgba(255, 228, 230, 0.24) inset,
    0 -1px 0 rgba(88, 18, 38, 0.68) inset;
}

.popup-container[data-agent-theme='dark-console'] .footer-link {
  color: #7dd3fc;
}

.popup-container[data-agent-theme='dark-console'] .footer-link:hover {
  background: rgba(8, 30, 55, 0.68);
  color: #e0f2fe;
}

.popup-container[data-agent-theme='dark-console'] .footer-text {
  color: var(--popup-text-subtle);
}

.popup-container[data-agent-theme='dark-console'] ::selection {
  background: rgba(56, 189, 248, 0.42);
  color: #f8fcff;
  text-shadow: none;
}

.popup-container[data-agent-theme='dark-console'] .mcp-config-json::selection {
  background: rgba(34, 211, 238, 0.5);
  color: #ecfeff;
}
</style>
