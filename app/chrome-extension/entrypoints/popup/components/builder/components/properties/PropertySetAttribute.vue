<template>
  <div>
    <SelectorEditor :node="node" :allowPick="true" />
    <div class="form-section">
      <div class="form-group">
        <label class="form-label">{{ getMessage('builderPropSetAttrNameLabel') }}</label>
        <input
          class="form-input"
          v-model="(node as any).config.name"
          :placeholder="getMessage('builderPropSetAttrNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label class="form-label">{{ getMessage('builderPropSetAttrValueLabel') }}</label>
        <input
          class="form-input"
          v-model="(node as any).config.value"
          :placeholder="getMessage('builderPropSetAttrValuePlaceholder')"
        />
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label"
          ><input type="checkbox" v-model="(node as any).config.remove" />
          {{ getMessage('builderPropSetAttrRemoveLabel') }}</label
        >
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import SelectorEditor from './SelectorEditor.vue';
import { getMessage } from '@/utils/i18n';

defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
