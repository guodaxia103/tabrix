<template>
  <div class="expr">
    <input class="form-input mono" :placeholder="placeholder" :value="text" @input="onInput" />
    <div v-if="err" class="error-item">{{ err }}</div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watchEffect } from 'vue';
import { evalExpression } from '@/entrypoints/background/record-replay/engine/utils/expression';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ modelValue?: string; field?: any }>();
const emit = defineEmits<{ (e: 'update:modelValue', v?: string): void }>();
const text = ref<string>(props.modelValue ?? '');
const err = ref<string>('');
const placeholder = props.field?.placeholder || getMessage('builderFieldExpressionPlaceholder');

function onInput(ev: any) {
  const v = String(ev?.target?.value ?? '');
  text.value = v;
  try {
    // just validate; allow empty
    if (v.trim()) {
      evalExpression(v, { vars: {} as any });
    }
    err.value = '';
  } catch (e: any) {
    err.value = getMessage('builderFieldExpressionParseError');
  }
  emit('update:modelValue', v);
}

watchEffect(() => {
  text.value = props.modelValue ?? '';
});
</script>

<style scoped>
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}
</style>
