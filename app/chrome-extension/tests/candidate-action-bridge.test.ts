import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { clickTool, fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';
import {
  __resetStableTargetRefRegistryForTests,
  recordStableTargetRefSnapshot,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';

describe('candidateAction bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStableTargetRefRegistryForTests();
  });

  it('resolves click target from candidateAction.targetRef', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4101,
      title: 'Repo',
      url: 'https://github.com/example/project',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_summary',
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      4101,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_summary',
      }),
      undefined,
    );
  });

  it('resolves fill target from candidateAction.locatorChain(css)', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4102,
      title: 'Login',
      url: 'https://example.com/login',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
    });

    const result = await fillTool.execute({
      value: 'alice@example.com',
      candidateAction: {
        locatorChain: [
          { type: 'aria', value: 'Email' },
          { type: 'css', value: 'input[name=email]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4102,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: 'input[name=email]',
      }),
      undefined,
    );
  });

  it('lets computer left_click consume candidateAction.targetRef', async () => {
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4103,
      title: 'Actions',
      url: 'https://github.com/example/project/actions',
    });
    const clickSpy = vi.spyOn(clickTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'left_click',
      candidateAction: {
        targetRef: 'ref_run_detail',
      },
    });

    expect(result.isError).toBe(false);
    expect(clickSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'ref_run_detail',
      }),
    );
  });

  it('lets computer fill consume candidateAction.locatorChain(css)', async () => {
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4104,
      title: 'Search',
      url: 'https://github.com/example/project/issues',
    });
    const fillSpy = vi.spyOn(fillTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'fill',
      value: 'bug',
      candidateAction: {
        locatorChain: [{ type: 'css', value: 'input[name=q]' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(fillSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'input[name=q]',
        value: 'bug',
      }),
    );
  });

  // ----- B-011: stable targetRef bridge coverage --------------------------
  // These tests pin the new contract: a `tgt_*` targetRef must route through
  // the per-tab snapshot registry and never silently fall through to the
  // legacy ref forwarding path.

  it('B-011: resolves click target from stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4201, [{ targetRef: 'tgt_abcdef0123', ref: 'ref_issues_live' }]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4201,
      title: 'Repo',
      url: 'https://github.com/example/project',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'tgt_abcdef0123' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4201,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_issues_live',
      }),
      undefined,
    );
  });

  it('B-011: click fails closed when stable targetRef has no registry mapping', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4202,
      title: 'Repo',
      url: 'https://github.com/example/project',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'tgt_unknown999' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(true);
    const text = String((result.content?.[0] as any)?.text || '');
    expect(text).toContain('tgt_unknown999');
    expect(text).toContain('chrome_read_page');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('B-011: legacy ref_* targetRef path is unchanged (regression guard)', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4203,
      title: 'Repo',
      url: 'https://github.com/example/project',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'ref_legacy_value' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4203,
      expect.objectContaining({ ref: 'ref_legacy_value' }),
      undefined,
    );
  });

  it('B-011: fill resolves stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4204, [{ targetRef: 'tgt_email00001', ref: 'ref_email_live' }]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4204,
      title: 'Login',
      url: 'https://example.com/login',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
    });

    const result = await fillTool.execute({
      value: 'alice@example.com',
      candidateAction: { targetRef: 'tgt_email00001' },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4204,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        ref: 'ref_email_live',
      }),
      undefined,
    );
  });

  it('B-011: computer left_click resolves stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4205, [{ targetRef: 'tgt_runabcd000', ref: 'ref_run_live' }]);
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4205,
      title: 'Actions',
      url: 'https://github.com/example/project/actions',
    });
    const clickSpy = vi.spyOn(clickTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'left_click',
      candidateAction: { targetRef: 'tgt_runabcd000' },
    });

    expect(result.isError).toBe(false);
    expect(clickSpy).toHaveBeenCalledWith(expect.objectContaining({ ref: 'ref_run_live' }));
  });
});
