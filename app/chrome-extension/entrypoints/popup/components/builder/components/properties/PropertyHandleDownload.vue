<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropDownloadFilenameContainsLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.filenameContains"
        :placeholder="getMessage('builderPropSubstringMatchPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropTimeoutMsCompactLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.timeoutMs"
        :placeholder="getMessage('builderPropDefault60000Placeholder')"
      />
    </div>
    <div class="form-group checkbox-group">
      <label class="checkbox-label"
        ><input type="checkbox" v-model="(node as any).config.waitForComplete" />
        {{ getMessage('builderPropDownloadWaitCompleteLabel') }}</label
      >
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropSaveToVariableLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.saveAs"
        :placeholder="getMessage('builderPropDefaultDownloadPlaceholder')"
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
