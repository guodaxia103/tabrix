import { cdpSessionManager } from '@/utils/cdp-session-manager';

const PREARM_OWNER_PREFIX = 'dialog-prearm';
const PREARM_TTL_MS = 8000;

const detachTimers = new Map<number, ReturnType<typeof setTimeout>>();

function clearDetachTimer(tabId: number) {
  const timer = detachTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    detachTimers.delete(tabId);
  }
}

function scheduleDetach(tabId: number, owner: string, ttlMs: number) {
  clearDetachTimer(tabId);
  const timer = setTimeout(async () => {
    detachTimers.delete(tabId);
    try {
      await cdpSessionManager.detach(tabId, owner);
    } catch {
      // best-effort cleanup
    }
  }, ttlMs);
  detachTimers.set(tabId, timer);
}

export async function prearmDialogHandling(tabId: number, ttlMs: number = PREARM_TTL_MS) {
  const owner = `${PREARM_OWNER_PREFIX}:${tabId}`;
  try {
    await cdpSessionManager.attach(tabId, owner);
    try {
      await cdpSessionManager.sendCommand(tabId, 'Page.enable');
    } catch {
      // Page.enable may fail when the page is already transitioning; keep the session attached anyway.
    }
    scheduleDetach(tabId, owner, ttlMs);
  } catch {
    // Do not fail the click path if debugger attach/prearm is unavailable.
  }
}
