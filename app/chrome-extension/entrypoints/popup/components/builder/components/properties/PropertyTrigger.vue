<template>
  <div class="form-section">
    <div class="form-group checkbox-group">
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.enabled" /> {{ getMessage('triggerEnabled') }}</label
      >
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerDescriptionOptional') }}</label>
      <input
        class="form-input"
        v-model="cfg.description"
        :placeholder="getMessage('triggerDescriptionPlaceholder')"
      />
    </div>
  </div>

  <div class="divider"></div>

  <div class="form-section">
    <div class="section-header"
      ><span class="section-title">{{ getMessage('triggerModesTitle') }}</span></div
    >
    <div class="form-group checkbox-group">
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.manual" />
        {{ getMessage('triggerModeManual') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.url" /> {{ getMessage('triggerModeUrl') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.contextMenu" />
        {{ getMessage('triggerModeContextMenu') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.command" />
        {{ getMessage('triggerModeCommand') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.dom" /> {{ getMessage('triggerModeDom') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.modes.schedule" />
        {{ getMessage('triggerModeSchedule') }}</label
      >
    </div>
  </div>

  <div v-if="cfg.modes.url" class="form-section">
    <div class="section-title">{{ getMessage('triggerUrlMatchTitle') }}</div>
    <div class="selector-list">
      <div v-for="(r, i) in urlRules" :key="i" class="selector-item">
        <select class="form-select-sm" v-model="r.kind">
          <option value="url">{{ getMessage('triggerUrlRuleUrlPrefix') }}</option>
          <option value="domain">{{ getMessage('triggerUrlRuleDomainContains') }}</option>
          <option value="path">{{ getMessage('triggerUrlRulePathPrefix') }}</option>
        </select>
        <input
          class="form-input-sm flex-1"
          v-model="r.value"
          :placeholder="getMessage('triggerUrlRulePlaceholder')"
        />
        <button class="btn-icon-sm" @click="move(urlRules, i, -1)" :disabled="i === 0">↑</button>
        <button
          class="btn-icon-sm"
          @click="move(urlRules, i, 1)"
          :disabled="i === urlRules.length - 1"
          >↓</button
        >
        <button class="btn-icon-sm danger" @click="urlRules.splice(i, 1)">×</button>
      </div>
    </div>
    <button class="btn-sm" @click="urlRules.push({ kind: 'url', value: '' })">
      {{ getMessage('triggerAddUrlRule') }}
    </button>
  </div>

  <div v-if="cfg.modes.contextMenu" class="form-section">
    <div class="section-title">{{ getMessage('triggerContextMenuTitle') }}</div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerContextMenuLabel') }}</label>
      <input
        class="form-input"
        v-model="cfg.contextMenu.title"
        :placeholder="getMessage('triggerContextMenuPlaceholder')"
      />
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerContextScopeLabel') }}</label>
      <div class="checkbox-group">
        <label class="checkbox-label" v-for="c in menuContexts" :key="c">
          <input type="checkbox" :value="c" v-model="cfg.contextMenu.contexts" /> {{ c }}
        </label>
      </div>
    </div>
  </div>

  <div v-if="cfg.modes.command" class="form-section">
    <div class="section-title">{{ getMessage('triggerCommandTitle') }}</div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerCommandLabel') }}</label>
      <input
        class="form-input"
        v-model="cfg.command.commandKey"
        :placeholder="getMessage('triggerCommandPlaceholder')"
      />
    </div>
    <div class="text-xs text-slate-500" style="padding: 0 20px">{{
      getMessage('triggerCommandHint')
    }}</div>
  </div>

  <div v-if="cfg.modes.dom" class="form-section">
    <div class="section-title">{{ getMessage('triggerDomTitle') }}</div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerDomSelectorLabel') }}</label>
      <input class="form-input" v-model="cfg.dom.selector" placeholder="#app .item" />
    </div>
    <div class="form-group checkbox-group">
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.dom.appear" />
        {{ getMessage('triggerDomAppear') }}</label
      >
      <label class="checkbox-label"
        ><input type="checkbox" v-model="cfg.dom.once" /> {{ getMessage('triggerDomOnce') }}</label
      >
    </div>
    <div class="form-group">
      <label class="form-label">{{ getMessage('triggerDomDebounceLabel') }}</label>
      <input class="form-input" type="number" min="0" v-model.number="cfg.dom.debounceMs" />
    </div>
  </div>

  <div v-if="cfg.modes.schedule" class="form-section">
    <div class="section-title">{{ getMessage('scheduleTitle') }}</div>
    <div class="selector-list">
      <div v-for="(s, i) in schedules" :key="i" class="selector-item">
        <select class="form-select-sm" v-model="s.type">
          <option value="interval">{{ getMessage('scheduleTypeInterval') }}</option>
          <option value="daily">{{ getMessage('scheduleTypeDaily') }}</option>
          <option value="once">{{ getMessage('scheduleTypeOnce') }}</option>
        </select>
        <input
          class="form-input-sm flex-1"
          v-model="s.when"
          :placeholder="getMessage('triggerScheduleWhenPlaceholder')"
        />
        <label class="checkbox-label"
          ><input type="checkbox" v-model="s.enabled" />
          {{ getMessage('scheduleEnabledLabel') }}</label
        >
        <button class="btn-icon-sm" @click="move(schedules, i, -1)" :disabled="i === 0">↑</button>
        <button
          class="btn-icon-sm"
          @click="move(schedules, i, 1)"
          :disabled="i === schedules.length - 1"
          >↓</button
        >
        <button class="btn-icon-sm danger" @click="schedules.splice(i, 1)">×</button>
      </div>
    </div>
    <button
      class="btn-sm"
      @click="schedules.push({ type: 'interval', when: '5', enabled: true })"
      >{{ getMessage('triggerAddSchedule') }}</button
    >
  </div>

  <div class="divider"></div>
  <div class="form-section">
    <div class="text-xs text-slate-500" style="padding: 0 20px">{{
      getMessage('triggerSummaryNote')
    }}</div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { getMessage } from '@/utils/i18n';

const props = defineProps<{ node: NodeBase }>();

function ensure() {
  const n: any = props.node;
  if (!n.config) n.config = {};
  if (!n.config.modes)
    n.config.modes = {
      manual: true,
      url: false,
      contextMenu: false,
      command: false,
      dom: false,
      schedule: false,
    };
  if (!n.config.url) n.config.url = { rules: [] };
  if (!n.config.contextMenu)
    n.config.contextMenu = {
      title: getMessage('triggerContextMenuDefaultTitle'),
      contexts: ['all'],
      enabled: false,
    };
  if (!n.config.command) n.config.command = { commandKey: '', enabled: false };
  if (!n.config.dom)
    n.config.dom = { selector: '', appear: true, once: true, debounceMs: 800, enabled: false };
  if (!Array.isArray(n.config.schedules)) n.config.schedules = [];
}

const cfg = computed<any>({
  get() {
    ensure();
    return (props.node as any).config;
  },
  set(v) {
    (props.node as any).config = v;
  },
});

const urlRules = computed({
  get() {
    ensure();
    return (props.node as any).config.url.rules as Array<any>;
  },
  set(v) {
    (props.node as any).config.url.rules = v;
  },
});

const schedules = computed({
  get() {
    ensure();
    return (props.node as any).config.schedules as Array<any>;
  },
  set(v) {
    (props.node as any).config.schedules = v;
  },
});

const menuContexts = ['all', 'page', 'selection', 'image', 'link', 'video', 'audio'];

function move(arr: any[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  const t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}
</script>

<style scoped></style>
