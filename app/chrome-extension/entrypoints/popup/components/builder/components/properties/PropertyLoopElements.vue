<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropElementSelectorLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.selector"
        :placeholder="getMessage('builderPropCssSelectorPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropLoopElementsListVarLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.saveAs"
        :placeholder="getMessage('builderPropDefaultElementsPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropForeachItemVarLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.itemVar"
        :placeholder="getMessage('builderPropDefaultItemPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSubflowIdLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.subflowId"
        :placeholder="getMessage('builderPropSubflowPlaceholder')"
      />
      <button class="btn-sm" style="margin-top: 8px" @click="onCreateSubflow">{{
        getMessage('builderPropCreateSubflowButton')
      }}</button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();
const emit = defineEmits<{ (e: 'create-subflow', id: string): void }>();

function onCreateSubflow() {
  const id = prompt(getMessage('propertyPanelPromptNewSubflowId'));
  if (!id) return;
  emit('create-subflow', id);
  const n = props.node as any;
  if (n && n.config) n.config.subflowId = id;
}
</script>

<style scoped></style>
