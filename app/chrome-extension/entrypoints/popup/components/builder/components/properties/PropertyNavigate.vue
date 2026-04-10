<template>
  <div class="form-section">
    <div class="form-group" data-field="navigate.url">
      <label class="form-label">{{ getMessage('builderPropUrlAddressLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.url"
        placeholder="https://example.com"
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
