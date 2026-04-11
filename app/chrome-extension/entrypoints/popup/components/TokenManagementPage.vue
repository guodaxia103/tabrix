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

      <section v-if="tokenInfo" class="token-card">
        <div class="token-card-header">
          <div class="token-card-title-wrap">
            <h3 class="section-title">{{ getMessage('tokenPageCurrentTokenTitle') }}</h3>
            <span v-if="tokenInfo.fromEnv" class="env-badge">{{
              getMessage('tokenPageEnvTokenBadge')
            }}</span>
          </div>
          <button
            type="button"
            class="icon-btn"
            :title="getMessage('tokenPageCopyTokenTitle')"
            @click="copyText(tokenInfo.token)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
                d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2M8 4h8a2 2 0 0 1 2 2v8M6 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
              />
            </svg>
          </button>
        </div>
        <button
          type="button"
          class="token-visibility-button"
          :title="getMessage('tokenPageCopyTokenTitle')"
          @click="tokenVisible = !tokenVisible"
        >
          <code class="token-value">{{
            tokenVisible ? tokenInfo.token : maskedToken(tokenInfo.token)
          }}</code>
        </button>

        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">{{ getMessage('statusLabel') }}</span>
            <span class="meta-value">{{ expiryStatusText }}</span>
          </div>
          <div v-if="tokenInfo.expiresAt !== null" class="meta-item">
            <span class="meta-label">{{ getMessage('tokenPageExpiryTimeLabel') }}</span>
            <span class="meta-value">{{ formatExpiresAt(tokenInfo.expiresAt) }}</span>
          </div>
          <div v-if="!tokenInfo.fromEnv && tokenInfo.ttlDays != null" class="meta-item">
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
      </section>

      <section v-else class="empty-card">
        <p class="empty-text">{{ emptyStateText }}</p>
        <div class="empty-actions">
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
      </section>

      <section class="notes-card">
        <button type="button" class="notes-toggle" @click="showNotes = !showNotes">
          <h3 class="section-title">{{ getMessage('tokenPageNotesTitle') }}</h3>
          <span class="notes-toggle-icon">{{ showNotes ? '−' : '+' }}</span>
        </button>
        <p v-if="showNotes" class="help-text">{{ getMessage('tokenPageNotesText') }}</p>
      </section>
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
const showNotes = ref(false);
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

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${props.baseUrl}/auth/token`);
      if (!res.ok) {
        // 短暂服务波动时重试，避免出现“已连接但立即报错”的误判体验
        if (res.status >= 500 && attempt < maxAttempts) {
          await waitMs(attempt * 200);
          continue;
        }
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
      return;
    } catch {
      if (attempt < maxAttempts) {
        await waitMs(attempt * 200);
        continue;
      }
      loadError.value = getMessage('tokenPageLocalServiceUnavailable');
      tokenInfo.value = null;
    }
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
  --tm-page-bg: var(--ac-bg, #f8fafc);
  --tm-surface: var(--ac-surface, #ffffff);
  --tm-surface-muted: var(--ac-surface-muted, #f1f5f9);
  --tm-text: var(--ac-text, #0f172a);
  --tm-text-muted: var(--ac-text-muted, #64748b);
  --tm-text-subtle: var(--ac-text-subtle, #94a3b8);
  --tm-border: var(--ac-border, #e2e8f0);
  --tm-danger: var(--ac-danger, #dc2626);
  --tm-danger-bg: rgba(239, 68, 68, 0.08);
  --tm-danger-border: rgba(248, 113, 113, 0.45);
  --tm-shadow: 0 12px 24px -20px rgba(15, 23, 42, 0.55);
  --tm-code-bg: var(--ac-code-bg, #0f172a);
  --tm-code-text: var(--ac-code-text, #e2e8f0);
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 640px;
  background: var(--tm-page-bg);
  color: var(--tm-text);
}

.page-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--tm-border);
  background: linear-gradient(180deg, var(--tm-surface) 0%, var(--tm-surface-muted) 100%);
}

.back-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: none;
  background: transparent;
  color: var(--tm-text-muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
}

.back-button:hover {
  background: var(--tm-surface-muted);
}

.page-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--tm-text);
}

.page-content {
  padding: 14px 16px 16px;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.refresh-ttl-in-dialog {
  padding: 12px;
  background: var(--tm-surface-muted);
  border: 1px solid var(--tm-border);
  border-radius: 10px;
}

.refresh-ttl-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--tm-text);
  margin-bottom: 8px;
}

.refresh-ttl-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 10px;
}

.refresh-ttl-input {
  width: 90px;
  padding: 8px 10px;
  font-size: 18px;
  font-weight: 700;
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  background: var(--tm-surface);
  color: var(--tm-text);
}

.refresh-ttl-hint {
  font-size: 12px;
  color: var(--tm-text-muted);
}

.error-banner {
  font-size: 12px;
  color: var(--tm-danger);
  background: var(--tm-danger-bg);
  border: 1px solid var(--tm-danger-border);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: var(--tm-shadow);
}

.token-card,
.empty-card,
.notes-card {
  border: 1px solid var(--tm-border);
  background: linear-gradient(180deg, var(--tm-surface) 0%, var(--tm-surface-muted) 100%);
  border-radius: 14px;
  padding: 14px;
  box-shadow: var(--tm-shadow);
}

.token-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.token-card-title-wrap {
  min-width: 0;
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--tm-text);
}

.token-visibility-button {
  width: 100%;
  border: 1px solid var(--tm-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--tm-surface);
  text-align: left;
  cursor: pointer;
  margin-bottom: 10px;
}

.token-visibility-button:hover {
  border-color: var(--tm-text-subtle);
}

.token-visibility-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}

.token-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
  line-height: 1.5;
  color: var(--tm-text);
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  background: var(--tm-surface);
  cursor: pointer;
  color: var(--tm-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  color: var(--tm-text);
  border-color: var(--tm-text-subtle);
}

.env-badge {
  display: inline-flex;
  align-items: center;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  color: var(--tm-text-muted);
  background: var(--tm-surface);
  border: 1px solid var(--tm-border);
}

.meta-grid {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.meta-item {
  border: 1px solid var(--tm-border);
  border-radius: 10px;
  background: var(--tm-surface);
  padding: 8px 10px;
  display: grid;
  gap: 3px;
}

.meta-label {
  color: var(--tm-text-subtle);
  font-size: 11px;
  letter-spacing: 0.01em;
}

.meta-value {
  color: var(--tm-text);
  font-size: 13px;
  font-weight: 600;
}

.danger-button {
  width: 100%;
  padding: 11px 14px;
  font-size: 14px;
  font-weight: 700;
  color: #fff1f2;
  background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
  border: 1px solid #ef4444;
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.danger-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.03);
}

.danger-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.secondary-button {
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tm-text);
  background: var(--tm-surface);
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  cursor: pointer;
  min-height: 36px;
}

.secondary-button:hover:not(:disabled) {
  background: var(--tm-surface-muted);
}

.empty-card {
  color: var(--tm-text-muted);
}

.empty-text {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
}

.empty-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.notes-toggle {
  width: 100%;
  background: transparent;
  border: none;
  padding: 0;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.notes-toggle-icon {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1px solid var(--tm-border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--tm-text-muted);
  font-weight: 700;
}

.help-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--tm-text-muted);
  margin: 0;
}

.popup-container[data-agent-theme='dark-console'] .token-management-page {
  --tm-page-bg: rgba(2, 8, 23, 0.95);
  --tm-surface: rgba(6, 20, 39, 0.9);
  --tm-surface-muted: rgba(10, 30, 55, 0.62);
  --tm-text: #e0f2fe;
  --tm-text-muted: #9ec3e7;
  --tm-text-subtle: #7aa2c7;
  --tm-border: rgba(56, 189, 248, 0.34);
  --tm-danger: #fb7185;
  --tm-danger-bg: rgba(120, 20, 45, 0.32);
  --tm-danger-border: rgba(251, 113, 133, 0.45);
  --tm-shadow: 0 14px 28px -22px rgba(8, 47, 73, 0.72);
  --tm-code-bg: #05172e;
  --tm-code-text: #c7e6ff;
}

.popup-container[data-agent-theme='dark-console'] .token-visibility-button,
.popup-container[data-agent-theme='dark-console'] .meta-item,
.popup-container[data-agent-theme='dark-console'] .icon-btn,
.popup-container[data-agent-theme='dark-console'] .env-badge,
.popup-container[data-agent-theme='dark-console'] .secondary-button {
  background: rgba(5, 17, 34, 0.86);
}

.popup-container[data-agent-theme='dark-console'] .danger-button {
  background: linear-gradient(180deg, #dc2626 0%, #be123c 100%);
  border-color: rgba(251, 113, 133, 0.62);
}
</style>
