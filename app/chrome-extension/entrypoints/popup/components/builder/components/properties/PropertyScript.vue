<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropScriptCodeLabel') }}</label>
      <textarea
        class="form-textarea"
        v-model="(node as any).config.code"
        rows="6"
        placeholder="// your JS code"
      ></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropScriptWorldLabel') }}</label>
      <select class="form-select" v-model="(node as any).config.world">
        <option value="ISOLATED">ISOLATED</option>
        <option value="MAIN">MAIN</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropScriptWhenLabel') }}</label>
      <select class="form-select" v-model="(node as any).config.when">
        <option value="before">before</option>
        <option value="after">after</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSaveAsVariableOptionalLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.saveAs"
        :placeholder="getMessage('builderPropVariableNamePlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropScriptAssignLabel') }}</label>
      <KeyValueEditor v-model="(node as any).config.assign" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import KeyValueEditor from '@/entrypoints/popup/components/builder/components/KeyValueEditor.vue';
import { getMessage } from '@/utils/i18n';

defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
