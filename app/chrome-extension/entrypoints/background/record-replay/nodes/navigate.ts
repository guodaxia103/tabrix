import { TOOL_NAMES } from 'chrome-mcp-shared';
import { handleCallTool } from '@/entrypoints/background/tools';
import { getMessage } from '@/utils/i18n';
import type { Step } from '../types';
import type { ExecCtx, ExecResult, NodeRuntime } from './types';

export const navigateNode: NodeRuntime<any> = {
  validate: (step) => {
    const ok = !!(step as any).url;
    return ok ? { ok } : { ok, errors: [getMessage('rrNodeMissingUrl')] };
  },
  run: async (_ctx: ExecCtx, step: Step) => {
    const url = (step as any).url;
    const res = await handleCallTool({ name: TOOL_NAMES.BROWSER.NAVIGATE, args: { url } });
    if ((res as any).isError) throw new Error('navigate failed');
    return {} as ExecResult;
  },
};
