<template>
  <div class="memory-steps" :aria-busy="slotData.status === 'loading'">
    <div
      v-if="slotData.status === 'loading'"
      class="memory-steps__state memory-steps__state--loading"
      role="status"
      aria-live="polite"
    >
      Loading steps…
    </div>

    <div
      v-else-if="slotData.status === 'error'"
      class="memory-steps__state memory-steps__state--error"
      role="alert"
    >
      <strong>Could not load steps.</strong>
      <p class="memory-steps__detail">{{ slotData.errorMessage || 'Unknown error.' }}</p>
      <button type="button" class="memory-steps__retry" @click="emit('retry')">Retry</button>
    </div>

    <div
      v-else-if="slotData.status === 'ready' && slotData.steps.length === 0"
      class="memory-steps__state memory-steps__state--empty"
    >
      This session has no recorded steps.
    </div>

    <ol
      v-else-if="slotData.status === 'ready'"
      class="memory-steps__list"
      aria-label="Session steps"
    >
      <li
        v-for="step in slotData.steps"
        :key="step.stepId"
        class="memory-step"
        :class="{ 'memory-step--failed': step.status === 'failed' }"
      >
        <div class="memory-step__header">
          <span class="memory-step__index">#{{ step.index }}</span>
          <span
            class="memory-step__status"
            :class="`memory-step__status--${step.status}`"
            :title="`status: ${step.status}`"
          />
          <span class="memory-step__tool" :title="step.toolName">{{ step.toolName }}</span>
          <span
            v-if="step.stepType === 'retry'"
            class="memory-step__badge memory-step__badge--retry"
          >
            retry
          </span>
          <span v-else-if="step.stepType !== 'tool_call'" class="memory-step__badge">
            {{ step.stepType }}
          </span>
          <span class="memory-step__spacer" />
          <span v-if="formatDuration(step)" class="memory-step__duration">
            {{ formatDuration(step) }}
          </span>
        </div>

        <p v-if="step.resultSummary" class="memory-step__summary" :title="step.resultSummary">
          {{ step.resultSummary }}
        </p>
        <p
          v-else-if="step.inputSummary"
          class="memory-step__summary memory-step__summary--input"
          :title="step.inputSummary"
        >
          {{ step.inputSummary }}
        </p>

        <p v-if="step.errorSummary" class="memory-step__error" :title="step.errorSummary">
          <span v-if="step.errorCode" class="memory-step__error-code">{{ step.errorCode }}</span>
          {{ step.errorSummary }}
        </p>

        <div class="memory-step__actions">
          <button
            type="button"
            class="memory-step__copy"
            :disabled="!extractHistoryRef(step)"
            :title="
              extractHistoryRef(step) ||
              'No memory:// ref on this step (non-page tool or persistence off).'
            "
            @click="handleCopy(step)"
          >
            {{ copiedStepId === step.stepId ? 'Copied ✓' : 'Copy historyRef' }}
          </button>
        </div>
      </li>
    </ol>
  </div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type { MemoryExecutionStep } from '@tabrix/shared';
import { copyTextToClipboard, extractHistoryRef } from '../../../common/memory-api-client';
import type { MemoryStepsSlot } from '../../shared/composables/useMemoryTimeline';

defineProps<{
  slotData: MemoryStepsSlot;
}>();

const emit = defineEmits<{
  (e: 'retry'): void;
}>();

const copiedStepId = ref<string | null>(null);

async function handleCopy(step: MemoryExecutionStep): Promise<void> {
  const ref = extractHistoryRef(step);
  if (!ref) return;
  const ok = await copyTextToClipboard(ref);
  if (!ok) return;
  copiedStepId.value = step.stepId;
  window.setTimeout(() => {
    if (copiedStepId.value === step.stepId) {
      copiedStepId.value = null;
    }
  }, 1500);
}

function formatDuration(step: MemoryExecutionStep): string | null {
  if (!step.endedAt) return null;
  const start = Date.parse(step.startedAt);
  const end = Date.parse(step.endedAt);
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
.memory-steps {
  margin-top: 8px;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

.memory-steps__state {
  font-size: 12px;
  color: #4b5563;
  padding: 8px 4px;
}

.memory-steps__state--error strong {
  color: #b91c1c;
  display: block;
  margin-bottom: 6px;
}

.memory-steps__detail {
  margin: 0 0 8px;
  font-size: 12px;
  color: #6b7280;
}

.memory-steps__retry {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #1f2937;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
}

.memory-steps__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.memory-step {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-left: 3px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.memory-step--failed {
  border-left-color: #dc2626;
}

.memory-step__header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.memory-step__index {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: #6b7280;
  flex: 0 0 auto;
}

.memory-step__status {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #9ca3af;
  flex: 0 0 auto;
}

.memory-step__status--completed {
  background: #16a34a;
}

.memory-step__status--running,
.memory-step__status--pending {
  background: #2563eb;
}

.memory-step__status--failed {
  background: #dc2626;
}

.memory-step__status--skipped {
  background: #9ca3af;
}

.memory-step__tool {
  font-size: 12px;
  font-weight: 500;
  color: #111827;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-step__badge {
  font-size: 10px;
  color: #4b5563;
  padding: 1px 6px;
  background: #f3f4f6;
  border-radius: 999px;
  flex: 0 0 auto;
  letter-spacing: 0.2px;
}

.memory-step__badge--retry {
  background: #fef3c7;
  color: #92400e;
}

.memory-step__spacer {
  flex: 1 1 auto;
}

.memory-step__duration {
  font-size: 11px;
  color: #6b7280;
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

.memory-step__summary {
  margin: 0;
  font-size: 12px;
  color: #374151;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.memory-step__summary--input {
  color: #6b7280;
  font-style: italic;
}

.memory-step__error {
  margin: 0;
  font-size: 11px;
  color: #b91c1c;
  line-height: 1.4;
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.memory-step__error-code {
  font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
  background: #fee2e2;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  flex: 0 0 auto;
}

.memory-step__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}

.memory-step__copy {
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  transition: background 120ms ease;
}

.memory-step__copy:hover:not(:disabled) {
  background: #f3f4f6;
}

.memory-step__copy:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (prefers-color-scheme: dark) {
  .memory-steps {
    background: #111827;
    border-color: #374151;
  }
  .memory-steps__state {
    color: #d1d5db;
  }
  .memory-steps__state--error strong {
    color: #fca5a5;
  }
  .memory-steps__detail {
    color: #9ca3af;
  }
  .memory-step {
    background: #1f2937;
    border-color: #374151;
  }
  .memory-step__tool {
    color: #f9fafb;
  }
  .memory-step__badge {
    background: #374151;
    color: #d1d5db;
  }
  .memory-step__badge--retry {
    background: #78350f;
    color: #fef3c7;
  }
  .memory-step__summary {
    color: #d1d5db;
  }
  .memory-step__summary--input,
  .memory-step__duration,
  .memory-step__index {
    color: #9ca3af;
  }
  .memory-step__error {
    color: #fca5a5;
  }
  .memory-step__error-code {
    background: #7f1d1d;
    color: #fecaca;
  }
  .memory-step__copy,
  .memory-steps__retry {
    background: #1f2937;
    color: #e5e7eb;
    border-color: #374151;
  }
  .memory-step__copy:hover:not(:disabled),
  .memory-steps__retry:hover {
    background: #374151;
  }
}
</style>
