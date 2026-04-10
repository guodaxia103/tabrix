import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { STEP_TYPES } from 'chrome-mcp-shared';
import { getMessage } from '@/utils/i18n';

export function validateNode(n: NodeBase): string[] {
  const errs: string[] = [];
  const c: any = n.config || {};

  switch (n.type) {
    case STEP_TYPES.CLICK:
    case STEP_TYPES.DBLCLICK:
    case 'fill': {
      const hasCandidate = !!c?.target?.candidates?.length;
      if (!hasCandidate) errs.push(getMessage('builderValidationMissingTargetSelectorCandidate'));
      if (n.type === 'fill' && (!('value' in c) || c.value === undefined))
        errs.push(getMessage('builderValidationMissingInputValue'));
      break;
    }
    case STEP_TYPES.WAIT: {
      if (!c?.condition) errs.push(getMessage('builderValidationMissingWaitCondition'));
      break;
    }
    case STEP_TYPES.ASSERT: {
      if (!c?.assert) errs.push(getMessage('builderValidationMissingAssertCondition'));
      break;
    }
    case STEP_TYPES.NAVIGATE: {
      if (!c?.url) errs.push(getMessage('builderValidationMissingUrl'));
      break;
    }
    case STEP_TYPES.HTTP: {
      if (!c?.url) errs.push(getMessage('builderValidationHttpMissingUrl'));
      if (c?.assign && typeof c.assign === 'object') {
        const pathRe = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+|\[\d+\])*$/;
        for (const v of Object.values(c.assign)) {
          const s = String(v);
          if (!pathRe.test(s)) errs.push(getMessage('builderValidationAssignInvalidPath', [s]));
        }
      }
      break;
    }
    case STEP_TYPES.HANDLE_DOWNLOAD: {
      // filenameContains 可选
      break;
    }
    case STEP_TYPES.EXTRACT: {
      if (!c?.saveAs) errs.push(getMessage('builderValidationExtractNeedSaveVar'));
      if (!c?.selector && !c?.js) errs.push(getMessage('builderValidationExtractNeedSelectorOrJs'));
      break;
    }
    case STEP_TYPES.SWITCH_TAB: {
      if (!c?.tabId && !c?.urlContains && !c?.titleContains)
        errs.push(getMessage('builderValidationSwitchTabNeedOne'));
      break;
    }
    case STEP_TYPES.SCREENSHOT: {
      // selector 可空（全页/可视区），不强制
      break;
    }
    case STEP_TYPES.TRIGGER_EVENT: {
      const hasCandidate = !!c?.target?.candidates?.length;
      if (!hasCandidate) errs.push(getMessage('builderValidationMissingTargetSelectorCandidate'));
      if (!String(c?.event || '').trim()) errs.push(getMessage('builderValidationNeedEventType'));
      break;
    }
    case STEP_TYPES.IF: {
      const arr = Array.isArray(c?.branches) ? c.branches : [];
      if (arr.length === 0) errs.push(getMessage('builderValidationNeedAtLeastOneBranch'));
      for (let i = 0; i < arr.length; i++) {
        if (!String(arr[i]?.expr || '').trim())
          errs.push(getMessage('builderValidationBranchNeedExpression', [String(i + 1)]));
      }
      break;
    }
    case STEP_TYPES.SET_ATTRIBUTE: {
      const hasCandidate = !!c?.target?.candidates?.length;
      if (!hasCandidate) errs.push(getMessage('builderValidationMissingTargetSelectorCandidate'));
      if (!String(c?.name || '').trim())
        errs.push(getMessage('builderValidationNeedAttributeName'));
      break;
    }
    case STEP_TYPES.LOOP_ELEMENTS: {
      if (!String(c?.selector || '').trim())
        errs.push(getMessage('builderValidationNeedElementSelector'));
      if (!String(c?.subflowId || '').trim())
        errs.push(getMessage('builderValidationNeedSubflowId'));
      break;
    }
    case STEP_TYPES.SWITCH_FRAME: {
      // Both index/urlContains optional; empty means switch back to top frame
      break;
    }
    case STEP_TYPES.EXECUTE_FLOW: {
      if (!String(c?.flowId || '').trim())
        errs.push(getMessage('builderValidationNeedExecuteFlowId'));
      break;
    }
    case STEP_TYPES.CLOSE_TAB: {
      // 允许空（关闭当前标签页），不强制
      break;
    }
    case STEP_TYPES.SCRIPT: {
      // 若配置了 saveAs/assign，应提供 code
      const hasAssign = c?.assign && Object.keys(c.assign).length > 0;
      if ((c?.saveAs || hasAssign) && !String(c?.code || '').trim())
        errs.push(getMessage('builderValidationScriptNeedCodeWhenAssign'));
      if (hasAssign) {
        const pathRe = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+|\[\d+\])*$/;
        for (const v of Object.values(c.assign || {})) {
          const s = String(v);
          if (!pathRe.test(s)) errs.push(getMessage('builderValidationAssignInvalidPath', [s]));
        }
      }
      break;
    }
  }
  return errs;
}

export function validateFlow(nodes: NodeBase[]): {
  totalErrors: number;
  nodeErrors: Record<string, string[]>;
} {
  const nodeErrors: Record<string, string[]> = {};
  let totalErrors = 0;
  for (const n of nodes) {
    const e = validateNode(n);
    if (e.length) {
      nodeErrors[n.id] = e;
      totalErrors += e.length;
    }
  }
  return { totalErrors, nodeErrors };
}
