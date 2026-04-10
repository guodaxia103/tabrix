<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{
        getMessage('builderPropScreenshotSelectorOptionalLabel')
      }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.selector"
        :placeholder="getMessage('builderPropScreenshotSelectorPlaceholder')"
      />
    </div>
    <div class="form-group checkbox-group">
      <label class="checkbox-label"
        ><input type="checkbox" v-model="(node as any).config.fullPage" />
        {{ getMessage('builderPropScreenshotFullPageLabel') }}</label
      >
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSaveAsVariableLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.saveAs"
        :placeholder="getMessage('builderPropScreenshotSaveAsPlaceholder')"
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
