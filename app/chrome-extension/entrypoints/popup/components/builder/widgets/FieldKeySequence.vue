<template>
  <div class="keys">
    <input class="form-input" :placeholder="placeholder" :value="text" @input="onInput" />
    <div class="help">{{ getMessage('builderFieldKeySequenceHelp') }}</div>
  </div>
</template>

<script lang="ts" setup>
import { ref, watchEffect } from 'vue';
import { getMessage } from '@/utils/i18n';
const props = defineProps<{ modelValue?: string; field?: any }>();
const emit = defineEmits<{ (e: 'update:modelValue', v?: string): void }>();
const text = ref<string>(props.modelValue ?? '');
const placeholder = props.field?.placeholder || getMessage('builderPropKeySequencePlaceholder');
function onInput(ev: any) {
  const v = String(ev?.target?.value ?? '');
  text.value = v;
  emit('update:modelValue', v);
}
watchEffect(() => (text.value = props.modelValue ?? ''));
</script>
