<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropKeySequenceLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.keys"
        :placeholder="getMessage('builderPropKeySequencePlaceholder')"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';
defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
