<template>
  <div>
    <SelectorEditor
      :node="node"
      :allowPick="true"
      :title="getMessage('builderPropDragStartSelectorTitle')"
      targetKey="start"
    />
    <SelectorEditor
      :node="node"
      :allowPick="true"
      :title="getMessage('builderPropDragEndSelectorTitle')"
      targetKey="end"
    />
    <div class="hint">
      <small>{{ getMessage('builderPropDragHint') }}</small>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import SelectorEditor from './SelectorEditor.vue';
import { getMessage } from '@/utils/i18n';

defineProps<{ node: NodeBase }>();
</script>

<style scoped>
.hint {
  color: #64748b;
  margin-top: 8px;
}
</style>
