<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropExtractSelectorOptionalLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.selector"
        :placeholder="getMessage('builderPropCssSelectorPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropExtractAttributeLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.attr"
        :placeholder="getMessage('builderPropExtractAttributePlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropExtractCustomJsLabel') }}</label>
      <textarea
        class="form-textarea"
        v-model="(node as any).config.js"
        rows="3"
        placeholder="return document.title"
      ></textarea>
    </div>
    <div class="form-group" :class="{ invalid: !(node as any).config?.saveAs }">
      <label class="form-label">{{ getMessage('builderPropSaveAsVariableLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.saveAs"
        :placeholder="getMessage('builderPropVariableNamePlaceholder')"
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
