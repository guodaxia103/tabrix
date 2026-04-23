<template>
  <section class="exec-tab">
    <header class="exec-tab__header">
      <div class="exec-title-row">
        <h2 class="exec-tab__title">Execution</h2>
        <button
          type="button"
          class="exec-btn"
          :disabled="insights.status.value === 'loading'"
          @click="handleRefresh"
        >
          {{ insights.status.value === 'loading' ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
      <p class="exec-tab__subtitle">
        Layer-dispatch and replay telemetry from
        <code>tabrix_choose_context</code>.
        <span v-if="persistenceMode" class="exec-meta">
          · persistence: <code>{{ persistenceMode }}</code>
        </span>
      </p>
    </header>

    <div
      v-if="insights.status.value === 'loading' && !insights.recent.value"
      class="exec-state"
      role="status"
      aria-live="polite"
    >
      Loading execution telemetry…
    </div>

    <div
      v-else-if="insights.status.value === 'error'"
      class="exec-state exec-state--error"
      role="alert"
    >
      <strong>Could not load execution insights.</strong>
      <p class="exec-state__detail">{{ insights.errorMessage.value || 'Unknown error.' }}</p>
      <p class="exec-state__hint">
        <template v-if="insights.errorKind.value === 'network'">
          The native server does not appear to be reachable at
          <code>http://127.0.0.1</code>. Start it from the popup, then retry.
        </template>
        <template v-else-if="insights.errorKind.value === 'http'">
          The native server returned an error. The <code>/execution/*</code> routes require Memory
          persistence to be enabled — see <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code>.
        </template>
        <template v-else>
          Unexpected response shape. Check that the extension and native-server are on matching
          versions.
        </template>
      </p>
      <button type="button" class="exec-btn" @click="handleRefresh">Retry</button>
    </div>

    <div v-else-if="insights.isEmpty.value" class="exec-state exec-state--empty">
      <h3 class="exec-state__heading">No execution decisions recorded yet.</h3>
      <p class="exec-state__detail">
        Run a task through an MCP client (Claude / Codex / Cursor) with the
        <code>tabrix</code> server attached. Each <code>tabrix_choose_context</code> call will land
        here with its chosen layer envelope.
      </p>
    </div>

    <template v-else-if="insights.status.value === 'ready'">
      <!-- Savings overview -->
      <article v-if="insights.savings.value" class="exec-card">
        <h3 class="exec-card__title">Token savings</h3>
        <dl class="exec-grid">
          <div class="exec-grid__cell">
            <dt>Decisions</dt>
            <dd>{{ insights.savings.value.decisionCount.toLocaleString() }}</dd>
          </div>
          <div class="exec-grid__cell">
            <dt>Tokens saved (est.)</dt>
            <dd>{{ insights.savings.value.tokensSavedEstimateSum.toLocaleString() }}</dd>
          </div>
          <div class="exec-grid__cell">
            <dt>Avg / decision</dt>
            <dd>{{ formatAverageSavings(insights.savings.value) }}</dd>
          </div>
        </dl>
        <div class="exec-bars" aria-label="Layer envelope distribution">
          <div
            v-for="layer in LAYER_ORDER"
            :key="layer"
            class="exec-bar"
            :class="`exec-bar--${slugifyLayer(layer)}`"
            :title="`${layer}: ${insights.savings.value.layerCounts[layer]} decision${insights.savings.value.layerCounts[layer] === 1 ? '' : 's'}`"
          >
            <span class="exec-bar__label">{{ layer }}</span>
            <span class="exec-bar__count">{{ insights.savings.value.layerCounts[layer] }}</span>
          </div>
        </div>
        <p v-if="insights.savings.value.lastReplay" class="exec-card__footer">
          Last replay <code>{{ insights.savings.value.lastReplay.outcome ?? 'pending' }}</code> ·
          <time :datetime="insights.savings.value.lastReplay.createdAt">{{
            formatTimestamp(insights.savings.value.lastReplay.createdAt)
          }}</time>
        </p>
        <p v-else class="exec-card__footer exec-card__footer--muted">
          No experience replay recorded yet.
        </p>
      </article>

      <!-- Reliability signals -->
      <article v-if="insights.reliability.value" class="exec-card">
        <h3 class="exec-card__title">Dispatcher reliability</h3>
        <p class="exec-card__metric">
          Fail-safe fallback rate
          <strong
            :class="{
              'exec-metric--warn': insights.reliability.value.fallbackSafeRate > 0,
            }"
          >
            {{ formatRate(insights.reliability.value.fallbackSafeRate) }}
          </strong>
          <span class="exec-card__sub">
            ({{ insights.reliability.value.fallbackSafeCount }} of
            {{ insights.reliability.value.decisionCount }})
          </span>
        </p>
        <ul class="exec-list exec-list--routes">
          <li v-for="route in sourceRouteRows" :key="route.key" class="exec-list__row">
            <span class="exec-pill" :class="`exec-pill--route-${route.key}`">{{
              route.label
            }}</span>
            <span class="exec-list__count">{{ route.count }}</span>
          </li>
        </ul>
        <div v-if="replayBlockedRows.length > 0" class="exec-card__sublist">
          <h4>Replay blocked by</h4>
          <ul class="exec-list">
            <li v-for="row in replayBlockedRows" :key="row.reason" class="exec-list__row">
              <span class="exec-list__reason">{{ row.reason }}</span>
              <span class="exec-list__count">{{ row.count }}</span>
            </li>
          </ul>
        </div>
      </article>

      <!-- Top action paths -->
      <article
        v-if="insights.topPaths.value && insights.topPaths.value.paths.length > 0"
        class="exec-card"
      >
        <h3 class="exec-card__title">Top action paths</h3>
        <ul class="exec-list">
          <li
            v-for="path in insights.topPaths.value.paths"
            :key="actionPathKey(path)"
            class="exec-list__row exec-list__row--path"
          >
            <div class="exec-path">
              <code class="exec-path__intent">{{ path.intentSignature }}</code>
              <span class="exec-path__meta">
                <span v-if="path.pageRole">{{ path.pageRole }}</span>
                <span v-if="path.pageRole && path.siteFamily" class="exec-path__dot">·</span>
                <span v-if="path.siteFamily">{{ path.siteFamily }}</span>
              </span>
              <span class="exec-path__strategy">strategy: {{ path.topStrategy }}</span>
            </div>
            <div class="exec-path__stats">
              <span class="exec-list__count">{{ path.decisionCount }}</span>
              <time :datetime="path.lastSeenAt">{{ formatTimestamp(path.lastSeenAt) }}</time>
            </div>
          </li>
        </ul>
      </article>

      <!-- Recent decisions -->
      <article
        v-if="insights.recent.value && insights.recent.value.decisions.length > 0"
        class="exec-card"
      >
        <h3 class="exec-card__title">
          Recent decisions
          <span class="exec-card__sub">
            (showing {{ insights.recent.value.decisions.length }} of
            {{ insights.recent.value.total }})
          </span>
        </h3>
        <ul class="exec-list exec-list--decisions">
          <li
            v-for="row in insights.recent.value.decisions"
            :key="row.decisionId"
            class="exec-decision"
          >
            <div class="exec-decision__head">
              <span
                class="exec-pill exec-pill--layer"
                :class="`exec-pill--layer-${slugifyLayer(row.chosenLayer ?? 'unknown')}`"
                >{{ row.chosenLayer ?? 'unknown' }}</span
              >
              <span
                v-if="row.sourceRoute"
                class="exec-pill exec-pill--soft"
                :title="row.layerDispatchReason ?? undefined"
                >{{ row.sourceRoute }}</span
              >
              <time class="exec-decision__time" :datetime="row.createdAt">{{
                formatTimestamp(row.createdAt)
              }}</time>
            </div>
            <p class="exec-decision__intent">
              <code>{{ row.intentSignature }}</code>
              <span v-if="row.pageRole" class="exec-decision__role"> · {{ row.pageRole }} </span>
              <span v-if="row.siteFamily" class="exec-decision__role">
                · {{ row.siteFamily }}
              </span>
            </p>
            <p class="exec-decision__meta">
              <span
                >strategy: <code>{{ row.strategy }}</code></span
              >
              <span v-if="row.fallbackStrategy">
                · fallback: <code>{{ row.fallbackStrategy }}</code>
              </span>
              <span v-if="row.tokensSavedEstimate !== null">
                · saved ~{{ row.tokensSavedEstimate.toLocaleString() }} tok
              </span>
            </p>
            <p v-if="row.fallbackCause" class="exec-decision__warn" :title="row.fallbackCause">
              ⚠ fallback: {{ row.fallbackCause }}
            </p>
          </li>
        </ul>
      </article>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type {
  ExecutionTopActionPathSummary,
  ExecutionSavingsSummary,
  LayerSourceRoute,
  ReadPageRequestedLayer,
} from '@tabrix/shared';
import { useExecutionInsights } from '../../shared/composables/useExecutionInsights';

const insights = useExecutionInsights();

const LAYER_ORDER: ReadonlyArray<ReadPageRequestedLayer | 'unknown'> = [
  'L0',
  'L0+L1',
  'L0+L1+L2',
  'unknown',
];

const ROUTE_LABELS: Record<LayerSourceRoute | 'unknown', string> = {
  read_page_required: 'read_page required',
  experience_replay_skip_read: 'replay (skip read_page)',
  knowledge_supported_read: 'knowledge-supported read',
  dispatcher_fallback_safe: 'dispatcher fail-safe',
  unknown: 'unknown / legacy',
};

onMounted(() => {
  void insights.load();
});

onBeforeUnmount(() => {
  insights.dispose();
});

function handleRefresh(): void {
  void insights.reload();
}

const persistenceMode = computed(() => {
  // Any of the four routes carries the same persistence mode; pick the
  // first one available so we don't show stale "memory" if a fetch
  // hasn't completed yet.
  return (
    insights.savings.value?.persistenceMode ??
    insights.recent.value?.persistenceMode ??
    insights.topPaths.value?.persistenceMode ??
    insights.reliability.value?.persistenceMode ??
    null
  );
});

const sourceRouteRows = computed(() => {
  const reliability = insights.reliability.value;
  if (!reliability) return [];
  const order: ReadonlyArray<LayerSourceRoute | 'unknown'> = [
    'read_page_required',
    'experience_replay_skip_read',
    'knowledge_supported_read',
    'dispatcher_fallback_safe',
    'unknown',
  ];
  return order.map((key) => ({
    key,
    label: ROUTE_LABELS[key],
    count: reliability.sourceRouteCounts[key] ?? 0,
  }));
});

const replayBlockedRows = computed(() => {
  const reliability = insights.reliability.value;
  if (!reliability) return [];
  return Object.entries(reliability.replayBlockedByCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
});

function actionPathKey(path: ExecutionTopActionPathSummary): string {
  return `${path.intentSignature}|${path.pageRole ?? ''}|${path.siteFamily ?? ''}`;
}

function slugifyLayer(layer: ReadPageRequestedLayer | 'unknown'): string {
  // CSS class fragments — `+` is invalid; map to a stable token.
  switch (layer) {
    case 'L0':
      return 'l0';
    case 'L0+L1':
      return 'l0l1';
    case 'L0+L1+L2':
      return 'l0l1l2';
    default:
      return 'unknown';
  }
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%';
  return `${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}%`;
}

function formatAverageSavings(s: ExecutionSavingsSummary): string {
  if (!s.decisionCount) return '0';
  return Math.round(s.tokensSavedEstimateSum / s.decisionCount).toLocaleString();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style>
/*
 * V25-03 — Execution tab. We deliberately avoid `@import './mkep-tab.css'`
 * (which Vue scoped styles inline once per importer and was bloating the
 * sidepanel CSS bundle past the 22 kB hard cap, see
 * scripts/check-bundle-size.mjs and the M5 binding in the V25 plan).
 * Instead, the tab is fully self-contained under the unique `exec-`
 * prefix and uses CSS custom properties so the dark-mode override is
 * one small variable swap instead of a parallel rule set.
 */

.exec-tab {
  --exec-bg: #ffffff;
  --exec-bg-soft: #f9fafb;
  --exec-bg-soft2: #f3f4f6;
  --exec-border: #e5e7eb;
  --exec-border-soft: #f3f4f6;
  --exec-text: #111827;
  --exec-text-2: #4b5563;
  --exec-text-3: #6b7280;
  --exec-text-mute: #9ca3af;
  --exec-warn: #b45309;
  --exec-warn-bg: #fffbeb;
  --exec-error: #b91c1c;
  --exec-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  box-sizing: border-box;
  height: 100%;
  padding: 20px;
  overflow-y: auto;
  color: var(--exec-text-2);
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

@media (prefers-color-scheme: dark) {
  .exec-tab {
    --exec-bg: #1f2937;
    --exec-bg-soft: #111827;
    --exec-bg-soft2: #374151;
    --exec-border: #374151;
    --exec-border-soft: #374151;
    --exec-text: #f9fafb;
    --exec-text-2: #d1d5db;
    --exec-text-3: #9ca3af;
    --exec-text-mute: #6b7280;
    --exec-warn: #fcd34d;
    --exec-warn-bg: #422006;
    --exec-error: #fca5a5;
    --exec-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
}

.exec-tab__header {
  margin-bottom: 16px;
}

.exec-tab__title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  color: var(--exec-text);
}

.exec-tab__subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--exec-text-3);
  line-height: 1.45;
}

.exec-tab code {
  font-family: 'SF Mono', Menlo, Monaco, Consolas, 'Roboto Mono', monospace;
  font-size: 12px;
  background: var(--exec-bg-soft2);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--exec-text);
}

.exec-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.exec-meta {
  color: var(--exec-text-3);
}

.exec-btn {
  border: 1px solid var(--exec-border);
  background: var(--exec-bg);
  color: var(--exec-text);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.exec-btn:hover:not(:disabled) {
  background: var(--exec-bg-soft2);
}

.exec-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.exec-state,
.exec-card {
  border: 1px solid var(--exec-border);
  border-radius: 10px;
  background: var(--exec-bg);
  box-shadow: var(--exec-shadow);
  color: var(--exec-text-2);
  margin-bottom: 12px;
}

.exec-state {
  padding: 16px;
  font-size: 13px;
}

.exec-card {
  padding: 12px 14px;
}

.exec-state__heading,
.exec-card__title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--exec-text);
}

.exec-state__heading {
  font-size: 15px;
}

.exec-state__detail {
  margin: 0 0 10px;
  line-height: 1.55;
}

.exec-state__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--exec-text-3);
  line-height: 1.55;
}

.exec-state--error strong {
  display: block;
  color: var(--exec-error);
  margin-bottom: 6px;
}

.exec-card__sub {
  font-weight: 400;
  font-size: 11px;
  color: var(--exec-text-3);
  margin-left: 4px;
}

.exec-card__metric {
  margin: 0 0 8px;
  font-size: 12px;
}

.exec-card__metric strong {
  margin: 0 6px;
  font-size: 14px;
  color: var(--exec-text);
}

.exec-metric--warn {
  color: var(--exec-warn);
}

.exec-card__footer {
  margin: 8px 0 0;
  font-size: 12px;
}

.exec-card__footer--muted {
  color: var(--exec-text-mute);
}

.exec-card__sublist {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--exec-border);
}

.exec-card__sublist h4 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--exec-text-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.exec-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 0 0 10px;
}

.exec-grid__cell {
  background: var(--exec-bg-soft);
  border-radius: 6px;
  padding: 6px 10px;
  margin: 0;
}

.exec-grid__cell dt {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--exec-text-3);
  margin: 0 0 2px;
}

.exec-grid__cell dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--exec-text);
  font-variant-numeric: tabular-nums;
}

.exec-bars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.exec-bar {
  border-radius: 6px;
  padding: 6px 8px;
  background: var(--exec-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}

.exec-bar__label {
  color: var(--exec-text-3);
  font-weight: 500;
}

.exec-bar__count {
  font-size: 13px;
  font-weight: 600;
  color: var(--exec-text);
  font-variant-numeric: tabular-nums;
}

.exec-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.exec-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.exec-list__row--path {
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--exec-border-soft);
}

.exec-list__row--path:last-child {
  border-bottom: none;
}

.exec-list__count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--exec-text);
  font-size: 12px;
}

.exec-list__reason {
  font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: var(--exec-warn);
}

.exec-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  background: var(--exec-bg-soft2);
  color: var(--exec-text-2);
  text-transform: uppercase;
}

.exec-pill--soft {
  background: var(--exec-bg-soft);
  color: var(--exec-text-3);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}

.exec-path {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.exec-path__intent {
  font-size: 12px;
  font-weight: 600;
  color: var(--exec-text);
  background: transparent;
  padding: 0;
}

.exec-path__meta,
.exec-path__strategy,
.exec-path__stats,
.exec-decision__time,
.exec-decision__role {
  font-size: 11px;
  color: var(--exec-text-3);
}

.exec-path__dot {
  margin: 0 4px;
  color: var(--exec-text-mute);
}

.exec-path__stats {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.exec-decision {
  border: 1px solid var(--exec-border-soft);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--exec-bg-soft);
}

.exec-decision:last-child {
  margin-bottom: 0;
}

.exec-decision__head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.exec-decision__time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.exec-decision__intent {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--exec-text);
  word-break: break-word;
}

.exec-decision__intent code {
  background: transparent;
  padding: 0;
  color: var(--exec-text);
}

.exec-decision__meta {
  margin: 0;
  font-size: 11px;
  color: var(--exec-text-2);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.exec-decision__warn {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--exec-warn);
  background: var(--exec-warn-bg);
  border-radius: 6px;
  padding: 4px 8px;
}
</style>
