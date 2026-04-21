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

    <!-- Empty -->
    <div v-else-if="timeline.isEmpty.value" class="memory-state memory-state--empty">
      <h3 class="memory-state__heading">No sessions yet</h3>
      <p class="memory-state__detail">
        MCP clients haven't executed any browser actions against this extension yet. Run a task from
        Claude / Codex / Cursor with the
        <code>tabrix</code> MCP server attached, then refresh.
      </p>
    </div>

    <!-- Ready -->
    <template v-else>
      <ol class="memory-list" aria-label="Recent sessions">
        <li v-for="row in timeline.sessions.value" :key="row.sessionId" class="memory-row">
          <div class="memory-row__primary">
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
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type { MemorySessionSummary } from '@tabrix/shared';
import { useMemoryTimeline } from '../../shared/composables/useMemoryTimeline';

const timeline = useMemoryTimeline();

onMounted(() => {
  void timeline.load();
});

onBeforeUnmount(() => {
  timeline.dispose();
});

function handleRefresh(): void {
  void timeline.reload();
}

const pagerLabel = computed(() => {
  const count = timeline.sessions.value.length;
  if (count === 0) return '0 results';
  const start = timeline.offset.value + 1;
  const end = timeline.offset.value + count;
  return `${start}–${end} of ${timeline.total.value}`;
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

.memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memory-row {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 12px 14px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.memory-row__primary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
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
}
</style>
