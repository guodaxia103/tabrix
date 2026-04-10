<template>
  <div>
    <div class="form-row">
      <label class="form-label">{{ getMessage('builderPropScrollModeLabel') }}</label>
      <select v-model="cfg.mode" class="form-select-sm">
        <option value="element">{{ getMessage('builderPropScrollModeElement') }}</option>
        <option value="offset">{{ getMessage('builderPropScrollModeOffset') }}</option>
        <option value="container">{{ getMessage('builderPropScrollModeContainer') }}</option>
      </select>
    </div>

    <div v-if="cfg.mode === 'element'" class="mt-2">
      <SelectorEditor
        :node="node"
        :allowPick="true"
        :title="getMessage('builderPropScrollTargetElementTitle')"
        targetKey="target"
      />
    </div>

    <div v-if="cfg.mode !== 'element'" class="mt-2">
      <div class="form-row">
        <label class="form-label">{{ getMessage('builderPropOffsetXLabel') }}</label>
        <input type="number" class="form-input-sm" v-model.number="cfg.offset.x" placeholder="0" />
      </div>
      <div class="form-row">
        <label class="form-label">{{ getMessage('builderPropOffsetYLabel') }}</label>
        <input
          type="number"
          class="form-input-sm"
          v-model.number="cfg.offset.y"
          placeholder="300"
        />
      </div>
      <div v-if="cfg.mode === 'container'" class="mt-2">
        <SelectorEditor
          :node="node"
          :allowPick="true"
          :title="getMessage('builderPropScrollContainerSelectorTitle')"
          targetKey="target"
        />
        <div class="hint"
          ><small>{{ getMessage('builderPropScrollContainerHint') }}</small></div
        >
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import SelectorEditor from './SelectorEditor.vue';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();

function ensure() {
  const n: any = props.node;
  n.config = n.config || {};
  if (!n.config.mode) n.config.mode = 'offset';
  if (!n.config.offset) n.config.offset = { x: 0, y: 300 };
  if (!n.config.target) n.config.target = { candidates: [] };
}

const cfg = {
  get mode() {
    ensure();
    return (props.node as any).config.mode;
  },
  set mode(v: any) {
    ensure();
    (props.node as any).config.mode = v;
  },
  get offset() {
    ensure();
    return (props.node as any).config.offset;
  },
  set offset(v: any) {
    ensure();
    (props.node as any).config.offset = v;
  },
} as any;
</script>

<style scoped>
.hint {
  color: #64748b;
  margin-top: 8px;
}
.mt-2 {
  margin-top: 8px;
}
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
}
.form-label {
  width: 80px;
  color: #334155;
  font-size: 12px;
}
.form-input-sm,
.form-select-sm {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--rr-border);
  border-radius: 6px;
}
</style>
