<template>
  <div v-if="visible" class="confirmation-dialog" @click.self="$emit('cancel')">
    <div class="dialog-content">
      <div class="dialog-header">
        <span class="dialog-icon">{{ icon }}</span>
        <h3 class="dialog-title">{{ title }}</h3>
      </div>

      <div class="dialog-body">
        <p class="dialog-message">{{ message }}</p>

        <div v-if="slots.extra" class="dialog-extra">
          <slot name="extra" />
        </div>

        <ul v-if="items && items.length > 0" class="dialog-list">
          <li v-for="item in items" :key="item">{{ item }}</li>
        </ul>

        <div v-if="warning" class="dialog-warning">
          <strong>{{ warning }}</strong>
        </div>
      </div>

      <div class="dialog-actions">
        <button
          class="dialog-button confirm-button"
          :disabled="isConfirming"
          @click="$emit('confirm')"
        >
          {{ isConfirming ? confirmingText : confirmText }}
        </button>
        <button class="dialog-button cancel-button" @click="$emit('cancel')">
          {{ cancelText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useSlots } from 'vue';
import { getMessage } from '@/utils/i18n';

const slots = useSlots();

interface Props {
  visible: boolean;
  title: string;
  message: string;
  items?: string[];
  warning?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string;
  confirmingText?: string;
  isConfirming?: boolean;
}

interface Emits {
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}

withDefaults(defineProps<Props>(), {
  icon: '⚠️',
  confirmText: getMessage('confirmButton'),
  cancelText: getMessage('cancelButton'),
  confirmingText: getMessage('processingStatus'),
  isConfirming: false,
});

defineEmits<Emits>();
</script>

<style scoped>
.confirmation-dialog {
  --cd-overlay: rgba(2, 6, 23, 0.56);
  --cd-surface: #ffffff;
  --cd-surface-muted: #f8fafc;
  --cd-border: #d8e0ea;
  --cd-text: #0f172a;
  --cd-text-muted: #64748b;
  --cd-warn-bg: rgba(251, 113, 133, 0.08);
  --cd-warn-border: rgba(248, 113, 113, 0.38);
  --cd-warn-text: #be123c;
  --cd-cancel-bg: #ffffff;
  --cd-cancel-border: #cdd7e3;
  --cd-cancel-text: #334155;
  --cd-confirm-bg: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
  --cd-confirm-text: #fff;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--cd-overlay);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 14px 10px;
  z-index: 1000;
  backdrop-filter: blur(6px);
  overflow-y: auto;
}

.dialog-content {
  background: linear-gradient(180deg, var(--cd-surface) 0%, var(--cd-surface-muted) 100%);
  border-radius: 14px;
  padding: 16px 16px 14px;
  max-width: 380px;
  width: min(380px, calc(100vw - 20px));
  max-height: calc(100vh - 28px);
  overflow-y: auto;
  box-shadow: 0 24px 48px -28px rgba(2, 8, 23, 0.75);
  border: 1px solid var(--cd-border);
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--cd-border);
}

.dialog-icon {
  font-size: 20px;
  line-height: 1;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--cd-text);
  margin: 0;
}

.dialog-body {
  margin-bottom: 14px;
}

.dialog-message {
  font-size: 13px;
  color: var(--cd-text);
  margin: 0 0 10px;
  line-height: 1.5;
  opacity: 0.86;
}

.dialog-extra {
  margin: 0 0 10px;
}

.dialog-list {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--cd-surface-muted);
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
  list-style: none;
}

.dialog-list li {
  position: relative;
  font-size: 12px;
  color: var(--cd-text-muted);
  margin-bottom: 4px;
  line-height: 1.4;
  padding-left: 12px;
}

.dialog-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.5em;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #3b82f6;
}

.dialog-list li:last-child {
  margin-bottom: 0;
}

.dialog-warning {
  font-size: 12px;
  color: var(--cd-warn-text);
  margin: 10px 0 0;
  padding: 10px;
  background: var(--cd-warn-bg);
  border-radius: 6px;
  border: 1px solid var(--cd-warn-border);
}

.dialog-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  justify-content: stretch;
  margin-top: 12px;
}

.dialog-button {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.cancel-button {
  background: var(--cd-cancel-bg);
  color: var(--cd-cancel-text);
  border-color: var(--cd-cancel-border);
}

.cancel-button:hover {
  background: var(--cd-surface-muted);
}

.confirm-button {
  background: var(--cd-confirm-bg);
  color: var(--cd-confirm-text);
  border: none;
  box-shadow: 0 10px 18px -16px rgba(220, 38, 38, 0.8);
}

.confirm-button:hover:not(:disabled) {
  filter: brightness(1.03);
  transform: translateY(-1px);
}

.confirm-button:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

@media (max-width: 420px) {
  .dialog-content {
    padding: 14px;
    width: calc(100vw - 16px);
    max-height: calc(100vh - 18px);
  }

  .dialog-message {
    font-size: 12px;
  }

  .dialog-actions {
    gap: 8px;
  }

  .dialog-button {
    padding: 11px 14px;
    font-size: 14px;
  }
}

.dialog-button:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.24);
}

:deep(.popup-container[data-agent-theme='dark-console']) .confirmation-dialog {
  --cd-overlay: rgba(0, 5, 20, 0.72);
  --cd-surface: rgba(6, 20, 39, 0.96);
  --cd-surface-muted: rgba(10, 30, 55, 0.58);
  --cd-border: rgba(56, 189, 248, 0.4);
  --cd-text: #e0f2fe;
  --cd-text-muted: #9ec3e7;
  --cd-warn-bg: rgba(120, 20, 45, 0.36);
  --cd-warn-border: rgba(251, 113, 133, 0.52);
  --cd-warn-text: #fecdd3;
  --cd-cancel-bg: rgba(8, 24, 44, 0.84);
  --cd-cancel-border: rgba(56, 189, 248, 0.34);
  --cd-cancel-text: #c7e6ff;
  --cd-confirm-bg: linear-gradient(180deg, #dc2626 0%, #be123c 100%);
  --cd-confirm-text: #fff1f2;
}
</style>
