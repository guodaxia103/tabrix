<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropHttpMethodLabel') }}</label>
      <select class="form-select" v-model="(node as any).config.method">
        <option>GET</option>
        <option>POST</option>
        <option>PUT</option>
        <option>PATCH</option>
        <option>DELETE</option>
      </select>
    </div>
    <div class="form-group" :class="{ invalid: !(node as any).config?.url }" data-field="http.url">
      <label class="form-label">{{ getMessage('builderPropUrlAddressLabel') }}</label>
      <input
        class="form-input"
        v-model="(node as any).config.url"
        placeholder="https://api.example.com/data"
      />
    </div>
    <div class="form-group">
      <label class="form-label">Headers (JSON)</label>
      <textarea
        class="form-textarea"
        v-model="headersJson"
        rows="3"
        placeholder='{"Content-Type": "application/json"}'
      ></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Body (JSON)</label>
      <textarea
        class="form-textarea"
        v-model="bodyJson"
        rows="3"
        placeholder='{"key": "value"}'
      ></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('builderPropHttpFormDataLabel') }}</label>
      <textarea
        class="form-textarea"
        v-model="formDataJson"
        rows="3"
        placeholder='{"fields":{"k":"v"},"files":[{"name":"file","fileUrl":"https://...","filename":"a.png"}]}'
      ></textarea>
      <div class="text-xs text-slate-500" style="margin-top: 6px">{{
        getMessage('builderPropHttpFormDataHint')
      }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();

const headersJson = computed({
  get() {
    try {
      return JSON.stringify((props.node as any).config?.headers || {}, null, 2);
    } catch {
      return '';
    }
  },
  set(v: string) {
    try {
      (props.node as any).config.headers = JSON.parse(v || '{}');
    } catch {}
  },
});
const bodyJson = computed({
  get() {
    try {
      return JSON.stringify((props.node as any).config?.body ?? null, null, 2);
    } catch {
      return '';
    }
  },
  set(v: string) {
    try {
      (props.node as any).config.body = v ? JSON.parse(v) : null;
    } catch {}
  },
});
const formDataJson = computed({
  get() {
    try {
      return (props.node as any).config?.formData
        ? JSON.stringify((props.node as any).config.formData, null, 2)
        : '';
    } catch {
      return '';
    }
  },
  set(v: string) {
    try {
      (props.node as any).config.formData = v ? JSON.parse(v) : undefined;
    } catch {}
  },
});
</script>

<style scoped></style>
