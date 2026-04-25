import { initNativeHostListener } from './native-host';

/**
 * Background script entry point
 * Initializes all background services and listeners.
 *
 * The local-model / semantic-similarity / storage-manager services were
 * removed as part of the MKEP pruning.
 * Any future MKEP Memory/Knowledge indexing will bring up its own service
 * from `background/memory/` or `background/knowledge/`.
 */
export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      chrome.tabs.create({
        url: chrome.runtime.getURL('/welcome.html'),
      });
    }
  });

  initNativeHostListener();
});
