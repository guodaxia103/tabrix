<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSwitchTabIdOptionalLabel') }}</label>
      <input
        class="form-input"
        type="number"
        v-model.number="(node as any).config.tabId"
        :placeholder="getMessage('builderPropNumberPlaceholder')"
      />
    </div>
    <div class="form-group" :class="{ invalid: needOne && !hasAny }">
      <label class="form-label">{{
        getMessage('builderPropSwitchTabUrlContainsOptionalLabel')
      }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.urlContains"
        :placeholder="getMessage('builderPropSubstringMatchPlaceholder')"
      />
    </div>
    <div class="form-group" :class="{ invalid: needOne && !hasAny }">
      <label class="form-label">{{
        getMessage('builderPropSwitchTabTitleContainsOptionalLabel')
      }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.titleContains"
        :placeholder="getMessage('builderPropSubstringMatchPlaceholder')"
      />
    </div>
    <div
      v-if="needOne && !hasAny"
      class="text-xs text-slate-500"
      style="padding: 0 20px; color: var(--rr-danger)"
      >{{ getMessage('builderPropSwitchTabNeedOneHint') }}</div
    >
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();
const needOne = true;
const hasAny = computed(() => {
  const c: any = (props.node as any).config || {};
  return !!(c.tabId || c.urlContains || c.titleContains);
});
</script>

<style scoped></style>
