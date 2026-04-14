function getRuntimeError(): Error | null {
  const message = chrome.runtime?.lastError?.message;
  return message ? new Error(message) : null;
}

function isDuplicateMenuError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate id/i.test(message);
}

function isMissingMenuError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot find menu item|not found|no menu item/i.test(message);
}

function createContextMenu(properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(properties, () => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function updateContextMenu(
  id: string,
  properties: Omit<chrome.contextMenus.CreateProperties, 'id'>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.update(id, properties, () => {
      const error = getRuntimeError();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function removeContextMenu(id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.contextMenus.remove(id, () => {
      const error = getRuntimeError();
      if (error && !isMissingMenuError(error)) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function ensureContextMenuItem(
  id: string,
  properties: Omit<chrome.contextMenus.CreateProperties, 'id'>,
): Promise<void> {
  try {
    await createContextMenu({
      id,
      ...properties,
    });
    return;
  } catch (error) {
    if (!isDuplicateMenuError(error)) {
      throw error;
    }
  }

  await updateContextMenu(id, properties);
}
