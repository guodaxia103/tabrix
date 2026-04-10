<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSwitchFrameUrlContainsLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.frame.urlContains"
        :placeholder="getMessage('builderPropSwitchFrameUrlPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSwitchFrameIndexLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.frame.index"
        :placeholder="getMessage('builderPropSwitchFrameIndexPlaceholder')"
      />
    </div>
    <div class="text-xs text-slate-500" style="padding: 0 20px">{{
      getMessage('builderPropSwitchFrameHint')
    }}</div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';
defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
