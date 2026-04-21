import { createApp } from 'vue';
import { NativeMessageType } from '@tabrix/shared';
import App from './App.vue';

import '../styles/tailwind.css';

/**
 * Mount the MKEP sidepanel.
 *
 * The sidepanel currently ships placeholder tabs for the Memory,
 * Knowledge, and Experience layers; richer views land in Stage 3+.
 * See `docs/MKEP_STAGE_3_PLUS_ROADMAP.md`.
 */
async function init(): Promise<void> {
  void chrome.runtime.sendMessage({ type: NativeMessageType.ENSURE_NATIVE }).catch(() => {
    // Silent failure — background handles native-host reconnection.
  });

  createApp(App).mount('#app');
}

void init();
