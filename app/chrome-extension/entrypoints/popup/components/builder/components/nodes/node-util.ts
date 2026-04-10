// node-util.ts - shared UI helpers for node components
// Note: comments in English

import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import { summarizeNode as summarize } from '../../model/transforms';
import { getMessage } from '@/utils/i18n';
import ILucideMousePointerClick from '~icons/lucide/mouse-pointer-click';
import ILucideEdit3 from '~icons/lucide/edit-3';
import ILucideKeyboard from '~icons/lucide/keyboard';
import ILucideCompass from '~icons/lucide/compass';
import ILucideGlobe from '~icons/lucide/globe';
import ILucideFileCode2 from '~icons/lucide/file-code-2';
import ILucideScan from '~icons/lucide/scan';
import ILucideHourglass from '~icons/lucide/hourglass';
import ILucideCheckCircle2 from '~icons/lucide/check-circle-2';
import ILucideGitBranch from '~icons/lucide/git-branch';
import ILucideRepeat from '~icons/lucide/repeat';
import ILucideRefreshCcw from '~icons/lucide/refresh-ccw';
import ILucideSquare from '~icons/lucide/square';
import ILucideArrowLeftRight from '~icons/lucide/arrow-left-right';
import ILucideX from '~icons/lucide/x';
import ILucideZap from '~icons/lucide/zap';
import ILucideCamera from '~icons/lucide/camera';
import ILucideBell from '~icons/lucide/bell';
import ILucideWrench from '~icons/lucide/wrench';
import ILucideFrame from '~icons/lucide/frame';
import ILucideDownload from '~icons/lucide/download';
import ILucideArrowUpDown from '~icons/lucide/arrow-up-down';
import ILucideMoveVertical from '~icons/lucide/move-vertical';

export function iconComp(t?: string) {
  switch (t) {
    case 'trigger':
      return ILucideZap;
    case 'click':
    case 'dblclick':
      return ILucideMousePointerClick;
    case 'fill':
      return ILucideEdit3;
    case 'drag':
      return ILucideArrowUpDown;
    case 'scroll':
      return ILucideMoveVertical;
    case 'key':
      return ILucideKeyboard;
    case 'navigate':
      return ILucideCompass;
    case 'http':
      return ILucideGlobe;
    case 'script':
      return ILucideFileCode2;
    case 'screenshot':
      return ILucideCamera;
    case 'triggerEvent':
      return ILucideBell;
    case 'setAttribute':
      return ILucideWrench;
    case 'loopElements':
      return ILucideRepeat;
    case 'switchFrame':
      return ILucideFrame;
    case 'handleDownload':
      return ILucideDownload;
    case 'extract':
      return ILucideScan;
    case 'wait':
      return ILucideHourglass;
    case 'assert':
      return ILucideCheckCircle2;
    case 'if':
      return ILucideGitBranch;
    case 'foreach':
      return ILucideRepeat;
    case 'while':
      return ILucideRefreshCcw;
    case 'openTab':
      return ILucideSquare;
    case 'switchTab':
      return ILucideArrowLeftRight;
    case 'closeTab':
      return ILucideX;
    case 'delay':
      return ILucideHourglass;
    default:
      return ILucideSquare;
  }
}

export function getTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    trigger: getMessage('builderNodeTypeTrigger'),
    click: getMessage('builderNodeTypeClick'),
    fill: getMessage('builderNodeTypeFill'),
    navigate: getMessage('builderNodeTypeNavigate'),
    wait: getMessage('builderNodeTypeWait'),
    extract: getMessage('builderNodeTypeExtract'),
    http: 'HTTP',
    script: getMessage('builderNodeTypeScript'),
    if: getMessage('builderNodeTypeIf'),
    foreach: getMessage('builderNodeTypeForeach'),
    assert: getMessage('builderNodeTypeAssert'),
    key: getMessage('builderNodeTypeKey'),
    drag: getMessage('builderNodeTypeDrag'),
    dblclick: getMessage('builderNodeTypeDblclick'),
    openTab: getMessage('builderNodeTypeOpenTab'),
    switchTab: getMessage('builderNodeTypeSwitchTab'),
    closeTab: getMessage('builderNodeTypeCloseTab'),
    delay: getMessage('builderNodeTypeDelay'),
    scroll: getMessage('builderNodeTypeScroll'),
    while: getMessage('builderNodeTypeWhile'),
  };
  return labels[String(type || '')] || type || '';
}

export function nodeSubtitle(node?: NodeBase | null): string {
  if (!node) return '';
  const summary = summarize(node);
  if (!summary) return node.type || '';
  return summary.length > 40 ? summary.slice(0, 40) + '...' : summary;
}
