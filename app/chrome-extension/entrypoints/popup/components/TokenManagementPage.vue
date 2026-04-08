<template>
  <div class="token-management-page">
    <div class="page-header">
      <button class="back-button" type="button" @click="$emit('back')" title="返回首页">
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
        <span>返回</span>
      </button>
      <h2 class="page-title">Token 管理</h2>
    </div>

    <div class="page-content">
      <div v-if="loadError" class="error-banner">{{ loadError }}</div>

      <div v-else-if="tokenInfo" class="section">
        <h3 class="section-title">当前 Token</h3>
        <div class="token-row">
          <span class="token-value" @click="tokenVisible = !tokenVisible">
            {{ tokenVisible ? tokenInfo.token : maskedToken(tokenInfo.token) }}
          </span>
          <button
            type="button"
            class="icon-btn"
            title="复制 Token"
            @click="copyText(tokenInfo.token)"
          >
            📋
          </button>
        </div>
        <p v-if="tokenInfo.fromEnv" class="env-badge"
          >由环境变量 MCP_AUTH_TOKEN 提供（不可在此页刷新）</p
        >

        <div class="meta-grid">
          <div>
            <span class="meta-label">状态</span>
            <span class="meta-value">{{ expiryStatusText }}</span>
          </div>
          <div v-if="tokenInfo.expiresAt !== null">
            <span class="meta-label">到期时间</span>
            <span class="meta-value">{{ formatExpiresAt(tokenInfo.expiresAt) }}</span>
          </div>
          <div v-if="!tokenInfo.fromEnv && tokenInfo.ttlDays != null">
            <span class="meta-label">生成时有效天数</span>
            <span class="meta-value">{{
              tokenInfo.ttlDays === 0 ? '永不过期' : `${tokenInfo.ttlDays} 天`
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
          {{ refreshing ? '处理中…' : '重新生成 Token' }}
        </button>
      </div>

      <div v-else class="section muted">
        <p
          >暂无 Token 数据。请确认服务已启动且监听 <code>0.0.0.0</code> 或已设置
          <code>MCP_AUTH_TOKEN</code>。</p
        >
        <button type="button" class="secondary-button" @click="fetchToken">重试</button>
      </div>

      <div class="section">
        <h3 class="section-title">说明</h3>
        <p class="help-text">
          在「重新生成 Token」弹框内可设置有效天数。服务端环境变量
          <code>MCP_AUTH_TOKEN_TTL</code> 仍影响首次自动生成时的默认天数（默认 7；<code>0</code>
          永不过期），修改后需重启生效。
        </p>
      </div>

      <div class="section">
        <h3 class="section-title">远程 MCP 配置（含 Token）</h3>
        <pre class="config-pre">{{ remoteConfigJson }}</pre>
        <button
          type="button"
          class="secondary-button"
          :disabled="!remoteConfigJson.trim()"
          @click="copyText(remoteConfigJson)"
        >
          复制完整配置
        </button>
      </div>
    </div>

    <ConfirmDialog
      :visible="showRefreshConfirm"
      title="重新生成 Token？"
      :message="refreshConfirmMessage"
      :items="['已保存新 Token 或确认可立即更新各客户端']"
      warning="此操作不可撤销。"
      icon="⚠️"
      confirm-text="确认重新生成"
      cancel-text="取消"
      :is-confirming="refreshing"
      @confirm="onConfirmRefresh"
      @cancel="showRefreshConfirm = false"
    >
      <template #extra>
        <div class="refresh-ttl-in-dialog">
          <label class="refresh-ttl-label" for="dialog-token-ttl-days">新 Token 有效天数</label>
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
            <span class="refresh-ttl-hint">0 = 永不过期，最大 3650</span>
          </div>
        </div>
      </template>
    </ConfirmDialog>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
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
/** 重新生成时使用的有效天数（与上方输入同步） */
const refreshTtlDays = ref(7);
const loadError = ref('');
const showRefreshConfirm = ref(false);
const tick = ref(0);
let tickTimer: ReturnType<typeof setInterval> | null = null;

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
const refreshConfirmMessage =
  '旧 Token 将立即失效，其他设备上的 MCP 客户端需更新配置中的 Authorization。请在下方设置新 Token 的有效天数。';

const expiryStatusText = computed(() => {
  tick.value;
  const info = tokenInfo.value;
  if (!info) return '';
  if (info.expiresAt === null) return '永不过期';
  const remaining = info.expiresAt - Date.now();
  if (remaining <= 0) return '已过期';
  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (days > 0) return `剩余约 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `剩余约 ${hours} 小时 ${mins} 分钟`;
  return `剩余约 ${mins} 分钟`;
});

const remoteConfigJson = computed(() => {
  const port = props.serverPort;
  const host = props.lanIp || '<局域网IP>';
  const tok = tokenInfo.value?.token;
  const chromeMcp: Record<string, unknown> = {
    url: `http://${host}:${port}/mcp`,
  };
  if (tok) {
    chromeMcp.headers = { Authorization: `Bearer ${tok}` };
  }
  return JSON.stringify({ mcpServers: { 'chrome-mcp': chromeMcp } }, null, 2);
});

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

async function fetchToken(): Promise<void> {
  loadError.value = '';
  try {
    const res = await fetch(`${props.baseUrl}/auth/token`);
    if (!res.ok) {
      loadError.value = `无法读取 Token（HTTP ${res.status}）`;
      tokenInfo.value = null;
      return;
    }
    const json = await res.json();
    tokenInfo.value = json?.data ?? null;
  } catch {
    loadError.value = '无法连接本地服务，请确认已连接 Native 且服务运行中。';
    tokenInfo.value = null;
  }
}

async function onConfirmRefresh(): Promise<void> {
  refreshing.value = true;
  const ttlDays = refreshTtlDaysClamped.value;
  try {
    const res = await fetch(`${props.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttlDays }),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      const msg = errJson?.message || errJson?.status || res.status;
      loadError.value = `刷新失败：${msg}`;
      return;
    }
    const json = await res.json();
    tokenInfo.value = json?.data ?? null;
    if (tokenInfo.value?.ttlDays != null) {
      refreshTtlDays.value = tokenInfo.value.ttlDays;
    }
    emit('token-changed');
    showRefreshConfirm.value = false;
  } catch {
    loadError.value = '刷新请求失败';
  } finally {
    refreshing.value = false;
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
