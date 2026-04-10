<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropWaitConditionLabel') }}</label>
      <textarea
        class="form-textarea"
        v-model="waitJson"
        rows="4"
        placeholder='{"text":"ok","appear":true}'
      ></textarea>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();

const waitJson = computed({
  get() {
    const n = props.node;
    if (!n || n.type !== 'wait') return '';
    try {
      return JSON.stringify((n as any).config?.condition || {}, null, 2);
    } catch {
      return '';
    }
  },
  set(v: string) {
    const n = props.node;
    if (!n || n.type !== 'wait') return;
    try {
      (n as any).config = { ...((n as any).config || {}), condition: JSON.parse(v || '{}') };
    } catch {}
  },
});
</script>

<style scoped></style>
