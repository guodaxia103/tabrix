/**
 * Minimal popup/extension theme composable.
 *
 * This replaces the previous `useAgentTheme` composable from the deprecated
 * Agent/AgentChat stack (removed as part of the MKEP pruning — see
 * docs/PRODUCT_PRUNING_PLAN.md §P2). The only popup consumer kept the
 * two-tone light/dark toggle, so this module intentionally exposes the
 * smallest surface needed to preserve that UX without dragging in any
 * agent infrastructure.
 *
 * The theme identifier is persisted in `chrome.storage.local` so the
 * popup restores the user's last choice across sessions. Falls back to
 * `localStorage` when running outside an extension (tests, local dev).
 */
import { ref, type Ref } from 'vue';

export type AgentThemeId = 'warm-editorial' | 'dark-console';

const STORAGE_KEY = 'tabrix.popup.theme';
const DEFAULT_THEME: AgentThemeId = 'warm-editorial';

let preloadedTheme: AgentThemeId | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome?.storage?.local &&
    typeof chrome.storage.local.get === 'function'
  );
}

async function readStoredTheme(): Promise<AgentThemeId> {
  if (hasChromeStorage()) {
    return new Promise<AgentThemeId>((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (items) => {
          const raw = items?.[STORAGE_KEY];
          resolve(raw === 'dark-console' ? 'dark-console' : DEFAULT_THEME);
        });
      } catch {
        resolve(DEFAULT_THEME);
      }
    });
  }
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw === 'dark-console' ? 'dark-console' : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

async function writeStoredTheme(theme: AgentThemeId): Promise<void> {
  if (hasChromeStorage()) {
    return new Promise<void>((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: theme }, () => resolve());
      } catch {
        resolve();
      }
    });
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore persistence errors in non-DOM contexts
  }
}

/**
 * Eager-load the theme from storage so the first render can avoid a flash.
 * Kept as a no-throw best-effort primitive.
 */
export async function preloadAgentTheme(): Promise<AgentThemeId> {
  preloadedTheme = await readStoredTheme();
  return preloadedTheme;
}

interface UseAgentThemeResult {
  theme: Ref<AgentThemeId>;
  initTheme: () => Promise<void>;
  setTheme: (next: AgentThemeId) => Promise<void>;
}

/**
 * Popup theme composable. Preserves the `useAgentTheme` API contract that
 * existing popup code depends on, without any agent runtime coupling.
 */
export function useAgentTheme(): UseAgentThemeResult {
  const theme = ref<AgentThemeId>(preloadedTheme ?? DEFAULT_THEME);

  const initTheme = async () => {
    theme.value = await readStoredTheme();
  };

  const setTheme = async (next: AgentThemeId) => {
    theme.value = next;
    await writeStoredTheme(next);
  };

  return { theme, initTheme, setTheme };
}
