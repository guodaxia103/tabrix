import { createApp } from 'vue';
import { NativeMessageType } from '@tabrix/shared';
import './style.css';
import { preloadAgentTheme } from '../shared/composables/usePopupTheme';
import App from './App.vue';

// 在Vue挂载前预加载主题，防止主题闪烁
preloadAgentTheme().then(() => {
  // Trigger ensure native connection (fire-and-forget, don't block UI mounting)
  void chrome.runtime.sendMessage({ type: NativeMessageType.ENSURE_NATIVE }).catch(() => {
    // Silent failure - background will handle reconnection
  });
  createApp(App).mount('#app');
});
