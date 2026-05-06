<template>
  <section class="mkep-tab">
    <header class="mkep-tab__header">
      <div class="mkep-tab__title-row">
        <h2 class="mkep-tab__title">Memory</h2>
        <button
          type="button"
          class="memory-refresh"
          :disabled="timeline.status.value === 'loading'"
          @click="handleRefresh"
        >
          {{ timeline.status.value === 'loading' ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
      <p class="mkep-tab__subtitle">
        Recent browser automation sessions captured by the native server.
        <span v-if="timeline.persistenceMode.value" class="memory-meta">
          · persistence: <code>{{ timeline.persistenceMode.value }}</code>
        </span>
      </p>
    </header>

    <!-- Filter chips + search + jump-to-last-failure -->
    <div
      v-if="timeline.sessions.value.length > 0 || timeline.hasActiveFilters.value"
      class="memory-filters"
    >
      <div class="memory-chips" role="radiogroup" aria-label="Filter sessions by status">
        <button
          type="button"
          class="memory-chip"
          :class="{ 'memory-chip--active': timeline.statusFilter.value.size === 0 }"
          role="radio"
          :aria-checked="timeline.statusFilter.value.size === 0"
          @click="timeline.clearFilters()"
        >
          All
        </button>
        <button
          v-for="chip in MEMORY_STATUS_CHIPS"
          :key="chip"
          type="button"
          class="memory-chip"
          :class="[
            `memory-chip--${chip}`,
            { 'memory-chip--active': timeline.statusFilter.value.has(chip) },
          ]"
          role="radio"
          :aria-checked="timeline.statusFilter.value.has(chip)"
          @click="timeline.toggleStatusChip(chip)"
        >
          {{ chipLabel(chip) }}
        </button>
      </div>
      <input
        v-model="searchModel"
        type="search"
        class="memory-search"
        aria-label="Search memory by task title or intent"
        placeholder="Search title or intent…"
      />
      <button
        v-if="timeline.lastFailedSessionId.value"
        type="button"
        class="memory-jump"
        @click="handleJumpToLastFailure"
      >
        ↓ Jump to last failure
      </button>
    </div>

    <!-- Loading: initial fetch, no prior data to show -->
    <div
      v-if="timeline.status.value === 'loading' && timeline.sessions.value.length === 0"
      class="memory-state memory-state--loading"
      role="status"
      aria-live="polite"
    >
      Loading recent sessions…
    </div>

    <!-- Error -->
    <div
      v-else-if="timeline.status.value === 'error'"
      class="memory-state memory-state--error"
      role="alert"
    >
      <strong>Could not load sessions.</strong>
      <p class="memory-state__detail">
        {{ timeline.errorMessage.value || 'Unknown error.' }}
      </p>
      <p class="memory-state__hint">
        <template v-if="timeline.errorKind.value === 'network'">
          The native server does not appear to be reachable at
          <code>http://127.0.0.1</code>. Start it from the popup, then retry.
        </template>
        <template v-else-if="timeline.errorKind.value === 'http'">
          The native server returned an error. It may not be running with Memory persistence enabled
          — see
          <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code>.
        </template>
        <template v-else>
          Unexpected response shape. Check that the extension and native-server are on matching
          versions.
        </template>
      </p>
      <button type="button" class="memory-refresh" @click="handleRefresh">Retry</button>
    </div>

    <!-- Empty (no sessions at all) -->
    <div v-else-if="timeline.isEmpty.value" class="memory-state memory-state--empty">
      <h3 class="memory-state__heading">No sessions yet</h3>
      <p class="memory-state__detail">
        MCP clients haven't executed any browser actions against this extension yet. Run a task from
        Claude / Codex / Cursor with the
        <code>tabrix</code> MCP server attached, then refresh.
      </p>
    </div>

    <!-- Empty (filters hide all rows on the current page) -->
    <div
      v-else-if="timeline.filteredSessions.value.length === 0"
      class="memory-state memory-state--empty"
    >
      <h3 class="memory-state__heading">No sessions match your filters</h3>
      <p class="memory-state__detail">
        Try clearing the status chip or search input. If you're looking for older data, use the
        pager at the bottom.
      </p>
      <button type="button" class="memory-refresh" @click="timeline.clearFilters()">
        Clear filters
      </button>
    </div>

    <!-- Ready -->
    <template v-else>
      <ol ref="listEl" class="memory-list" aria-label="Recent sessions">
        <li
          v-for="row in timeline.filteredSessions.value"
          :key="row.sessionId"
          class="memory-row"
          :data-session-id="row.sessionId"
        >
          <button
            type="button"
            class="memory-row__toggle"
            :aria-expanded="timeline.expandedSessionId.value === row.sessionId"
            :aria-controls="`memory-steps-${row.sessionId}`"
            @click="timeline.toggleExpansion(row.sessionId)"
          >
            <div class="memory-row__primary">
              <span
                class="memory-row__caret"
                :class="{
                  'memory-row__caret--open': timeline.expandedSessionId.value === row.sessionId,
                }"
                aria-hidden="true"
              >
                ›
              </span>
              <span
                class="memory-row__status"
                :class="`memory-row__status--${row.status}`"
                :title="`status: ${row.status}`"
              />
              <h3 class="memory-row__title" :title="row.taskTitle">
                {{ row.taskTitle || '(untitled)' }}
              </h3>
              <span class="memory-row__steps" :title="`${row.stepCount} steps`">
                {{ row.stepCount }} step{{ row.stepCount === 1 ? '' : 's' }}
              </span>
            </div>
            <p class="memory-row__intent" :title="row.taskIntent">
              {{ row.taskIntent || row.sessionId }}
            </p>
            <div class="memory-row__meta">
              <time :datetime="row.startedAt">{{ formatTimestamp(row.startedAt) }}</time>
              <span class="memory-row__dot">·</span>
              <span>{{ row.clientName || row.transport }}</span>
              <span v-if="formatDuration(row)" class="memory-row__meta-extra">
                <span class="memory-row__dot">·</span>
                <span>{{ formatDuration(row) }}</span>
              </span>
            </div>
          </button>

          <div
            v-if="timeline.expandedSessionId.value === row.sessionId"
            :id="`memory-steps-${row.sessionId}`"
          >
            <MemorySessionSteps
              :slot-data="timeline.getStepsSlot(row.sessionId)"
              @retry="timeline.reloadSteps(row.sessionId)"
            />
          </div>
        </li>
      </ol>

      <footer class="memory-pager">
        <button
          type="button"
          class="memory-refresh"
          :disabled="!timeline.hasPrevPage.value || timeline.status.value === 'loading'"
          @click="timeline.prevPage()"
        >
          Previous
        </button>
        <span class="memory-pager__range">{{ pagerLabel }}</span>
        <button
          type="button"
          class="memory-refresh"
          :disabled="!timeline.hasNextPage.value || timeline.status.value === 'loading'"
          @click="timeline.nextPage()"
        >
          Next
        </button>
      </footer>
    </template>
  </section>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue';
import type { MemorySessionSummary } from '@tabrix/shared';
import {
  useMemoryTimeline,
  MEMORY_STATUS_CHIPS,
  type MemoryStatusChip,
} from '../../shared/composables/useMemoryTimeline';
import MemorySessionSteps from './MemorySessionSteps.vue';

const timeline = useMemoryTimeline();
const listEl = ref<HTMLElement | null>(null);

const searchModel = computed<string>({
  get: () => timeline.searchQuery.value,
  set: (v: string) => (timeline.searchQuery.value = v),
});

onMounted(() => {
  void timeline.load();
});

onBeforeUnmount(() => {
  timeline.dispose();
});

function handleRefresh(): void {
  void timeline.reload();
}

function chipLabel(chip: MemoryStatusChip): string {
  switch (chip) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'aborted':
      return 'Canceled';
    default:
      return chip;
  }
}

async function handleJumpToLastFailure(): Promise<void> {
  const id = timeline.jumpToLastFailure();
  if (!id || !listEl.value) return;
  // Row may have just been rendered (filter state change); wait for DOM.
  await nextTick();
  const row = listEl.value.querySelector<HTMLElement>(`[data-session-id="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('memory-row--flash');
  // Force reflow so re-adding the class retriggers the animation.
  void row.offsetWidth;
  row.classList.add('memory-row--flash');
  window.setTimeout(() => row.classList.remove('memory-row--flash'), 900);
}

const pagerLabel = computed(() => {
  const count = timeline.sessions.value.length;
  if (count === 0) return '0 results';
  const start = timeline.offset.value + 1;
  const end = timeline.offset.value + count;
  const visible = timeline.filteredSessions.value.length;
  const filterBadge =
    timeline.hasActiveFilters.value && visible !== count ? ` (showing ${visible})` : '';
  return `${start}–${end} of ${timeline.total.value}${filterBadge}`;
});

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Local short format. Keeping this simple avoids a runtime dep on
  // Intl locale data in the extension sandbox.
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(row: MemorySessionSummary): string | null {
  if (!row.endedAt) return null;
  const start = Date.parse(row.startedAt);
  const end = Date.parse(row.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remaining = Math.round(s - m * 60);
  return `${m}m ${remaining}s`;
}
</script>

<style scoped>
@import './mkep-tab.css';

.mkep-tab__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.memory-meta {
  color: #6b7280;
}

.memory-refresh {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #1f2937;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.memory-refresh:hover:not(:disabled) {
  background: #f3f4f6;
}

.memory-refresh:disabled {
  opacity: 0.55;
  cursor: default;
}

.memory-state {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.memory-state__heading {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.memory-state__detail {
  margin: 0 0 12px;
  font-size: 13px;
  color: #374151;
  line-height: 1.55;
}

.memory-state__hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.55;
}

.memory-state--loading {
  color: #4b5563;
  font-size: 13px;
}

.memory-state--error strong {
  color: #b91c1c;
  font-size: 13px;
}

.memory-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0 10px;
}

.memory-chips {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.memory-chip {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-color 120ms ease;
}

.memory-chip:hover {
  background: #f3f4f6;
}

.memory-chip--active {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.memory-chip--active.memory-chip--failed {
  background: #dc2626;
  border-color: #dc2626;
}

.memory-chip--active.memory-chip--completed {
  background: #16a34a;
  border-color: #16a34a;
}

.memory-chip--active.memory-chip--aborted {
  background: #6b7280;
  border-color: #6b7280;
}

.memory-search {
  flex: 1 1 180px;
  min-width: 140px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #1f2937;
  background: #ffffff;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.memory-search:focus {
  outline: none;
  border-color: #93c5fd;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.memory-jump {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease;
}

.memory-jump:hover {
  background: #fee2e2;
}

.memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@keyframes memory-row-flash {
  0% {
    background-color: rgba(251, 191, 36, 0.4);
    box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.7);
  }
  100% {
    background-color: transparent;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }
}

.memory-row--flash {
  animation: memory-row-flash 900ms ease-out;
}

.memory-row {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  overflow: hidden;
}

.memory-row__toggle {
  all: unset;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  box-sizing: border-box;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease;
}

.memory-row__toggle:hover {
  background: #f9fafb;
}

.memory-row__toggle:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: -2px;
}

.memory-row__primary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.memory-row__caret {
  flex: 0 0 auto;
  width: 12px;
  text-align: center;
  color: #9ca3af;
  font-size: 14px;
  line-height: 1;
  transition: transform 120ms ease;
}

.memory-row__caret--open {
  transform: rotate(90deg);
  color: #2563eb;
}

.memory-row__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-row__status {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #9ca3af;
  flex: 0 0 auto;
}

.memory-row__status--completed {
  background: #16a34a;
}

.memory-row__status--running,
.memory-row__status--starting {
  background: #2563eb;
}

.memory-row__status--failed,
.memory-row__status--aborted {
  background: #dc2626;
}

.memory-row__steps {
  font-size: 11px;
  color: #6b7280;
  padding: 2px 8px;
  background: #f3f4f6;
  border-radius: 999px;
  flex: 0 0 auto;
}

.memory-row__intent {
  margin: 0;
  font-size: 12px;
  color: #4b5563;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.memory-row__meta {
  font-size: 11px;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.memory-row__dot {
  color: #d1d5db;
}

.memory-pager {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.memory-pager__range {
  font-size: 12px;
  color: #6b7280;
}

@media (prefers-color-scheme: dark) {
  .memory-meta {
    color: #9ca3af;
  }
  .memory-refresh {
    background: #1f2937;
    border-color: #374151;
    color: #e5e7eb;
  }
  .memory-refresh:hover:not(:disabled) {
    background: #374151;
  }
  .memory-state,
  .memory-row {
    background: #1f2937;
    border-color: #374151;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .memory-row__toggle:hover {
    background: #111827;
  }
  .memory-row__caret {
    color: #6b7280;
  }
  .memory-row__caret--open {
    color: #60a5fa;
  }
  .memory-state__heading,
  .memory-row__title {
    color: #f9fafb;
  }
  .memory-state__detail {
    color: #d1d5db;
  }
  .memory-state__hint,
  .memory-pager__range,
  .memory-row__intent,
  .memory-row__meta,
  .memory-state--loading {
    color: #9ca3af;
  }
  .memory-row__dot {
    color: #4b5563;
  }
  .memory-row__steps {
    background: #374151;
    color: #d1d5db;
  }
  .memory-state--error strong {
    color: #fca5a5;
  }
  .memory-chip {
    background: #1f2937;
    border-color: #374151;
    color: #d1d5db;
  }
  .memory-chip:hover {
    background: #374151;
  }
  .memory-search {
    background: #111827;
    border-color: #374151;
    color: #e5e7eb;
  }
  .memory-search:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }
  .memory-jump {
    background: #3f1d1d;
    border-color: #7f1d1d;
    color: #fca5a5;
  }
  .memory-jump:hover {
    background: #4c1d1d;
  }
}
</style>
