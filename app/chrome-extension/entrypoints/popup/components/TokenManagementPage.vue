<template>
  <div class="token-management-page">
    <div class="page-header">
      <button
        class="back-button"
        type="button"
        @click="$emit('back')"
        :title="getMessage('tokenPageBackHomeTitle')"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span>{{ getMessage('tokenPageBackLabel') }}</span>
      </button>
      <h2 class="page-title">{{ getMessage('popupTokenManagementTitle') }}</h2>
    </div>

    <div class="page-content">
      <div v-if="loadError" class="error-banner">{{ loadError }}</div>

      <div v-else-if="tokenInfo" class="section">
        <h3 class="section-title">{{ getMessage('tokenPageCurrentTokenTitle') }}</h3>
        <div class="token-row">
          <span class="token-value" @click="tokenVisible = !tokenVisible">
            {{ tokenVisible ? tokenInfo.token : maskedToken(tokenInfo.token) }}
          </span>
          <button
            type="button"
            class="icon-btn"
            :title="getMessage('tokenPageCopyTokenTitle')"
            @click="copyText(tokenInfo.token)"
          >
            📋
          </button>
        </div>
        <p v-if="tokenInfo.fromEnv" class="env-badge">{{ getMessage('tokenPageEnvTokenBadge') }}</p>

        <div class="meta-grid">
          <div>
            <span class="meta-label">{{ getMessage('statusLabel') }}</span>
            <span class="meta-value">{{ expiryStatusText }}</span>
          </div>
          <div v-if="tokenInfo.expiresAt !== null">
            <span class="meta-label">{{ getMessage('tokenPageExpiryTimeLabel') }}</span>
            <span class="meta-value">{{ formatExpiresAt(tokenInfo.expiresAt) }}</span>
          </div>
          <div v-if="!tokenInfo.fromEnv && tokenInfo.ttlDays != null">
            <span class="meta-label">{{ getMessage('tokenPageTtlDaysLabel') }}</span>
            <span class="meta-value">{{
              tokenInfo.ttlDays === 0
                ? getMessage('tokenPageNeverExpire')
                : getMessage('tokenPageDays', [String(tokenInfo.ttlDays)])
            }}</span>
          </div>
        </div>

        <button
          v-if="!tokenInfo.fromEnv"
          type="button"
          class="danger-button"
          :disabled="refreshing"
          @click="showRefreshConfirm = true"
        >
          {{
            refreshing
              ? getMessage('processingStatus')
              : getMessage('tokenPageRegenerateTokenButton')
          }}
        </button>
      </div>

      <div v-else class="section muted">
        <p>{{ emptyStateText }}</p>
        <button
          type="button"
          class="secondary-button"
          :disabled="creatingDefaultToken"
          @click="fetchToken"
          >{{ getMessage('retryButton') }}</button
        >
        <button
          v-if="isRemoteEnabled"
          type="button"
          class="secondary-button"
          :disabled="creatingDefaultToken"
          @click="generateDefaultToken"
          >{{
            creatingDefaultToken
              ? getMessage('processingStatus')
              : getMessage('tokenPageGenerateDefaultTokenButton')
          }}</button
        >
      </div>

      <div class="section">
        <h3 class="section-title">{{ getMessage('tokenPageNotesTitle') }}</h3>
        <p class="help-text">{{ getMessage('tokenPageNotesText') }}</p>
      </div>

      <div class="section">
        <h3 class="section-title">{{ getMessage('tokenPageRemoteConfigTitle') }}</h3>
        <pre class="config-pre">{{ remoteConfigJson }}</pre>
        <button
          type="button"
          class="secondary-button"
          :disabled="!remoteConfigJson.trim()"
          @click="copyText(remoteConfigJson)"
        >
          {{ getMessage('tokenPageCopyFullConfigButton') }}
        </button>
      </div>
    </div>

    <ConfirmDialog
      :visible="showRefreshConfirm"
      :title="getMessage('tokenPageRegenerateConfirmTitle')"
      :message="refreshConfirmMessage"
      :items="[getMessage('tokenPageRegenerateConfirmItem')]"
      :warning="getMessage('tokenPageRegenerateConfirmWarning')"
      icon="⚠️"
      :confirm-text="getMessage('tokenPageRegenerateConfirmButton')"
      :cancel-text="getMessage('cancelButton')"
      :is-confirming="refreshing"
      @confirm="onConfirmRefresh"
      @cancel="showRefreshConfirm = false"
    >
      <template #extra>
        <div class="refresh-ttl-in-dialog">
          <label class="refresh-ttl-label" for="dialog-token-ttl-days">{{
            getMessage('tokenPageNewTokenTtlLabel')
          }}</label>
          <div class="refresh-ttl-row">
            <input
              id="dialog-token-ttl-days"
              v-model.number="refreshTtlDays"
              type="number"
              min="0"
              max="3650"
              step="1"
              class="refresh-ttl-input"
              @click.stop
            />
            <span class="refresh-ttl-hint">{{ getMessage('tokenPageTtlHint') }}</span>
          </div>
        </div>
      </template>
    </ConfirmDialog>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { getMessage } from '@/utils/i18n';
import ConfirmDialog from './ConfirmDialog.vue';

export interface TokenInfo {
  token: string;
  createdAt: number;
  expiresAt: number | null;
  fromEnv: boolean;
  ttlDays?: number | null;
}

const props = defineProps<{
  /** e.g. http://127.0.0.1:12306 */
  baseUrl: string;
  serverPort: number;
  lanIp: string | null;
}>();

const emit = defineEmits<{
  back: [];
  'token-changed': [];
}>();

const tokenInfo = ref<TokenInfo | null>(null);
const tokenVisible = ref(false);
const refreshing = ref(false);
const creatingDefaultToken = ref(false);
/** 重新生成时使用的有效天数（与上方输入同步） */
const refreshTtlDays = ref(7);
const loadError = ref('');
const showRefreshConfirm = ref(false);
const tick = ref(0);
const hasAttemptedAutoCreate = ref(false);
let tickTimer: ReturnType<typeof setInterval> | null = null;
const isRemoteEnabled = computed(() => Boolean(props.lanIp));

const emptyStateText = computed(() => {
  if (isRemoteEnabled.value) {
    return getMessage('tokenPageEmptyRemoteEnabled');
  }
  return getMessage('tokenPageEmptyLocalOnly');
});

function maskedToken(token: string): string {
  if (token.length <= 8) return token;
  return token.slice(0, 4) + '····' + token.slice(-4);
}

function formatExpiresAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function clampTtlDays(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 7;
  return Math.min(3650, Math.floor(raw));
}

const refreshTtlDaysClamped = computed(() => clampTtlDays(refreshTtlDays.value));

/** 弹框内说明不含天数（天数在下方输入框设置） */
const refreshConfirmMessage = getMessage('tokenPageRefreshConfirmMessage');

const expiryStatusText = computed(() => {
  void tick.value;
  const info = tokenInfo.value;
  if (!info) return '';
  if (info.expiresAt === null) return getMessage('tokenPageNeverExpire');
  const remaining = info.expiresAt - Date.now();
  if (remaining <= 0) return getMessage('tokenPageExpired');
  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return getMessage('tokenPageRemainingDaysHours', [String(days), String(hours)]);
  if (hours > 0) {
    return getMessage('tokenPageRemainingHoursMinutes', [String(hours), String(mins)]);
  }
  return getMessage('tokenPageRemainingMinutes', [String(mins)]);
});

const remoteConfigJson = computed(() => {
  const port = props.serverPort;
  const host = props.lanIp || getMessage('popupLanIpPlaceholder');
  const tok = tokenInfo.value?.token;
  const chromeMcp: Record<string, unknown> = {
    url: `http://${host}:${port}/mcp`,
  };
  if (tok) {
    chromeMcp.headers = { Authorization: `Bearer ${tok}` };
  }
  return JSON.stringify({ mcpServers: { tabrix: chromeMcp } }, null, 2);
});

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

async function requestNewToken(ttlDays?: number, silent = false): Promise<TokenInfo | null> {
  try {
    const payload = ttlDays === undefined ? {} : { ttlDays };
    const res = await fetch(`${props.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (!silent) {
        const errJson = await res.json().catch(() => null);
        const msg = errJson?.message || errJson?.status || res.status;
        loadError.value = getMessage('tokenPageRefreshFailed', [String(msg)]);
      }
      return null;
    }
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    if (!silent) {
      loadError.value = getMessage('tokenPageRefreshRequestFailed');
    }
    return null;
  }
}

async function fetchToken(): Promise<void> {
  loadError.value = '';
  try {
    const res = await fetch(`${props.baseUrl}/auth/token`);
    if (!res.ok) {
      loadError.value = getMessage('tokenPageReadTokenFailedHttp', [String(res.status)]);
      tokenInfo.value = null;
      return;
    }
    const json = await res.json();
    tokenInfo.value = json?.data ?? null;
    if (tokenInfo.value) {
      hasAttemptedAutoCreate.value = false;
      return;
    }
    if (isRemoteEnabled.value && !hasAttemptedAutoCreate.value) {
      hasAttemptedAutoCreate.value = true;
      const created = await requestNewToken(undefined, true);
      if (created) {
        tokenInfo.value = created;
        emit('token-changed');
      }
    }
  } catch {
    loadError.value = getMessage('tokenPageLocalServiceUnavailable');
    tokenInfo.value = null;
  }
}

async function onConfirmRefresh(): Promise<void> {
  refreshing.value = true;
  const ttlDays = refreshTtlDaysClamped.value;
  try {
    const data = await requestNewToken(ttlDays);
    if (!data) return;
    tokenInfo.value = data;
    if (tokenInfo.value?.ttlDays != null) {
      refreshTtlDays.value = tokenInfo.value.ttlDays;
    }
    emit('token-changed');
    showRefreshConfirm.value = false;
  } finally {
    refreshing.value = false;
  }
}

async function generateDefaultToken(): Promise<void> {
  creatingDefaultToken.value = true;
  loadError.value = '';
  try {
    const data = await requestNewToken();
    if (!data) return;
    tokenInfo.value = data;
    hasAttemptedAutoCreate.value = false;
    emit('token-changed');
  } finally {
    creatingDefaultToken.value = false;
  }
}

onMounted(() => {
  void fetchToken();
  tickTimer = setInterval(() => {
    tick.value += 1;
  }, 1000);
});

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

watch(
  () => props.baseUrl,
  () => {
    void fetchToken();
  },
);

watch(
  () => props.lanIp,
  () => {
    hasAttemptedAutoCreate.value = false;
    void fetchToken();
  },
);

watch(
  tokenInfo,
  (info) => {
    if (info && !info.fromEnv && info.ttlDays != null && typeof info.ttlDays === 'number') {
      refreshTtlDays.value = info.ttlDays;
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.token-management-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--popup-bg, #f8fafc);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.back-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: #475569;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
}

.back-button:hover {
  background: #f1f5f9;
}

.page-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.page-content {
  padding: 12px 16px 24px;
  flex: 1;
  overflow-y: auto;
}

.refresh-ttl-in-dialog {
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.refresh-ttl-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
}

.refresh-ttl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.refresh-ttl-input {
  width: 96px;
  padding: 8px 10px;
  font-size: 15px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
}

.refresh-ttl-hint {
  font-size: 12px;
  color: #64748b;
}

.error-banner {
  font-size: 12px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 12px;
}

.section {
  margin-bottom: 16px;
}

.section.muted {
  color: #64748b;
  font-size: 12px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.token-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.token-value {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
  cursor: pointer;
  color: #0f172a;
}

.icon-btn {
  flex-shrink: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
}

.env-badge {
  font-size: 11px;
  color: #64748b;
  margin: 0 0 8px;
}

.meta-grid {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 11px;
}

.meta-label {
  color: #94a3b8;
  margin-right: 6px;
}

.meta-value {
  color: #334155;
}

.danger-button {
  width: 100%;
  padding: 8px 12px;
  font-size: 12px;
  color: #b91c1c;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 8px;
  cursor: pointer;
}

.danger-button:hover:not(:disabled) {
  background: #fef2f2;
}

.danger-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-button {
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: #334155;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
}

.secondary-button:hover:not(:disabled) {
  background: #f8fafc;
}

.help-text {
  font-size: 11px;
  line-height: 1.55;
  color: #64748b;
  margin: 0 0 8px;
}

.help-text.subtle {
  margin-bottom: 6px;
}

.help-text code {
  font-size: 10px;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 4px;
}

.config-pre {
  font-size: 10px;
  line-height: 1.4;
  background: #0f172a;
  color: #e2e8f0;
  padding: 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0 0 8px;
  max-height: 200px;
  overflow-y: auto;
}
</style>
