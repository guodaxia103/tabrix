<template>
  <div class="sidepanel-root">
    <nav class="mkep-nav" role="tablist" aria-label="MKEP sidepanel">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="mkep-nav__item"
        :class="{ 'mkep-nav__item--active': activeTab === tab.id }"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="setActiveTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <div class="sidepanel-body">
      <MemoryTab v-if="activeTab === 'memory'" />
      <KnowledgeTab v-else-if="activeTab === 'knowledge'" />
      <ExperienceTab v-else-if="activeTab === 'experience'" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MemoryTab from './tabs/MemoryTab.vue';
import KnowledgeTab from './tabs/KnowledgeTab.vue';
import ExperienceTab from './tabs/ExperienceTab.vue';

type SidepanelTab = 'memory' | 'knowledge' | 'experience';

const tabs: ReadonlyArray<{ id: SidepanelTab; label: string }> = [
  { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'experience', label: 'Experience' },
];

const DEFAULT_TAB: SidepanelTab = 'memory';

const activeTab = ref<SidepanelTab>(DEFAULT_TAB);

function parseTabFromUrl(): SidepanelTab {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('tab');
    if (raw === 'memory' || raw === 'knowledge' || raw === 'experience') {
      return raw;
    }
  } catch {
    // noop
  }
  return DEFAULT_TAB;
}

function setActiveTab(tab: SidepanelTab): void {
  activeTab.value = tab;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    history.replaceState(null, '', url.toString());
  } catch {
    // noop — sidepanel may run in restricted contexts where history is unavailable
  }
}

onMounted(() => {
  activeTab.value = parseTabFromUrl();
});
</script>

<style scoped>
.sidepanel-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: #f9fafb;
  color: #1f2937;
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.mkep-nav {
  display: flex;
  flex: 0 0 auto;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  padding: 6px 8px;
  gap: 4px;
}

.mkep-nav__item {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}

.mkep-nav__item:hover {
  background: #f3f4f6;
  color: #111827;
}

.mkep-nav__item--active {
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 600;
}

.sidepanel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

@media (prefers-color-scheme: dark) {
  .sidepanel-root {
    background: #111827;
    color: #e5e7eb;
  }
  .mkep-nav {
    background: #1f2937;
    border-bottom-color: #374151;
  }
  .mkep-nav__item {
    color: #9ca3af;
  }
  .mkep-nav__item:hover {
    background: #374151;
    color: #f9fafb;
  }
  .mkep-nav__item--active {
    background: #1e3a8a;
    color: #bfdbfe;
  }
}
</style>
