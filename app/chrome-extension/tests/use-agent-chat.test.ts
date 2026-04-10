import { describe, expect, it, vi } from 'vitest';
import type { UseAgentChatOptions } from '@/entrypoints/sidepanel/composables/useAgentChat';

vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return actual;
});

function createOptions(overrides: Partial<UseAgentChatOptions> = {}): UseAgentChatOptions {
  return {
    getServerPort: () => null,
    getSessionId: () => 'session-1',
    ensureServer: async () => false,
    openEventSource: vi.fn(),
    ...overrides,
  };
}

describe('useAgentChat connection messaging', () => {
  it('surfaces the native connection error when the agent server is unavailable', async () => {
    const { useAgentChat } = await import('@/entrypoints/sidepanel/composables/useAgentChat');
    const chat = useAgentChat(
      createOptions({
        getConnectionError: () => 'Native host manifest missing',
      }),
    );

    chat.input.value = 'hello';
    await chat.send();

    expect(chat.errorMessage.value).toBe(
      'Agent server is not available: Native host manifest missing',
    );
  });

  it('falls back to the generic availability message when no connection error is known', async () => {
    const { useAgentChat } = await import('@/entrypoints/sidepanel/composables/useAgentChat');
    const chat = useAgentChat(createOptions());

    chat.input.value = 'hello';
    await chat.send();

    expect(chat.errorMessage.value).toBe('Agent server is not available.');
  });
});
