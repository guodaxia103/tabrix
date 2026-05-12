import { describe, expect, it, vi } from 'vitest';
import { closeTabsTool } from '@/entrypoints/background/tools/browser/common';

describe('chrome_close_tabs hygiene guard', () => {
  it('refuses empty args instead of closing the active user tab', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    const result = await closeTabsTool.execute({});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'Refusing to close the active tab without explicit tabIds or url',
    );
    expect(removeSpy).not.toHaveBeenCalled();
  });
});
