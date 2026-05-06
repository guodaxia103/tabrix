import type {
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
  ReadPageInteractiveElement,
} from '@tabrix/shared';

export type CandidateActionSeed = ReadPageCandidateAction;

function buildRefSelectorMap(refMap: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof item?.ref === 'string' ? item.ref.trim() : '';
    const selector = typeof item?.selector === 'string' ? item.selector.trim() : '';
    if (!ref || !selector) continue;
    map.set(ref, selector);
  }
  return map;
}

export function buildCandidateActions(
  interactiveElements: ReadPageInteractiveElement[],
  refMap: any[],
): CandidateActionSeed[] {
  const selectorMap = buildRefSelectorMap(refMap);
  const clickRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option']);
  const fillRoles = new Set(['textbox', 'searchbox', 'combobox']);
  const primaryKeywords =
    /(submit|save|continue|next|confirm|login|sign in|search|checkout|提交|保存|继续|下一步|确认|登录|搜索)/i;

  const seeds: CandidateActionSeed[] = [];
  for (const element of interactiveElements) {
    if (!element.ref) continue;
    const role = String(element.role || '').toLowerCase();
    const name = String(element.name || '').trim();
    let actionType: 'click' | 'fill' | null = null;

    if (clickRoles.has(role)) actionType = 'click';
    else if (fillRoles.has(role)) actionType = 'fill';
    if (!actionType) continue;

    const locatorChain: ReadPageCandidateActionLocator[] = [];
    if (name) {
      locatorChain.push({ type: 'aria', value: name });
    }
    const selector = selectorMap.get(element.ref);
    if (selector) {
      locatorChain.push({ type: 'css', value: selector });
    }

    const isPrimary = primaryKeywords.test(name);
    const confidence = isPrimary ? 0.93 : actionType === 'fill' ? 0.68 : 0.72;
    const matchReason = isPrimary
      ? 'primary action inferred from interactive label'
      : actionType === 'fill'
        ? 'form input candidate from structured snapshot'
        : 'interactive clickable candidate from structured snapshot';

    const safeRef = element.ref.replace(/[^a-zA-Z0-9_]/g, '_');
    seeds.push({
      id: `ca_${actionType}_${safeRef}`,
      actionType,
      targetRef: element.ref,
      confidence: Number(confidence.toFixed(2)),
      matchReason,
      locatorChain,
    });
    if (seeds.length >= 8) break;
  }
  return seeds;
}
