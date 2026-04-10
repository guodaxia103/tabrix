import type { ExecCtx, ExecResult, NodeRuntime } from './types';
import { ENGINE_CONSTANTS } from '../engine/constants';
import { getMessage } from '@/utils/i18n';

export const foreachNode: NodeRuntime<any> = {
  validate: (step) => {
    const s = step as any;
    const ok =
      typeof s.listVar === 'string' && s.listVar && typeof s.subflowId === 'string' && s.subflowId;
    return ok ? { ok } : { ok, errors: [getMessage('rrNodeForeachNeedListVarAndSubflowId')] };
  },
  run: async (_ctx: ExecCtx, step) => {
    const s: any = step;
    const itemVar = typeof s.itemVar === 'string' && s.itemVar ? s.itemVar : 'item';
    return {
      control: {
        kind: 'foreach',
        listVar: String(s.listVar),
        itemVar,
        subflowId: String(s.subflowId),
        concurrency: Math.max(
          1,
          Math.min(ENGINE_CONSTANTS.MAX_FOREACH_CONCURRENCY, Number(s.concurrency ?? 1)),
        ),
      },
    } as ExecResult;
  },
};

export const whileNode: NodeRuntime<any> = {
  validate: (step) => {
    const s = step as any;
    const ok = !!s.condition && typeof s.subflowId === 'string' && s.subflowId;
    return ok ? { ok } : { ok, errors: [getMessage('rrNodeWhileNeedConditionAndSubflowId')] };
  },
  run: async (_ctx: ExecCtx, step) => {
    const s: any = step;
    const max = Math.max(1, Math.min(10000, Number(s.maxIterations ?? 100)));
    return {
      control: {
        kind: 'while',
        condition: s.condition,
        subflowId: String(s.subflowId),
        maxIterations: max,
      },
    } as ExecResult;
  },
};
