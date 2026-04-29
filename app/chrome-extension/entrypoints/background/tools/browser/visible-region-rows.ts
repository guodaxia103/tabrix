export interface VisibleRegionRow {
  title: string;
  primaryText: string | null;
  secondaryText: string | null;
  metaText: string | null;
  interactionText: string | null;
  targetRef: string | null;
  sourceRegion: string;
  confidence: number;
}

export interface VisibleRegionRowsResult {
  sourceDataSource: 'dom_region_rows';
  rows: VisibleRegionRow[];
  rowCount: number;
  visibleRegionRowsUsed: boolean;
  visibleRegionRowsRejectedReason: string | null;
  sourceRegion: string;
  rowExtractionConfidence: number;
  cardExtractorUsed: boolean;
  cardPatternConfidence: number;
  cardRowsCount: number;
  rowOrder: 'visual_order';
  targetRefCoverageRate: number;
}

interface ParsedVisibleNode {
  role: string;
  name: string;
  ref: string | null;
  href: string | null;
  depth: number;
  x: number | null;
  y: number | null;
  order: number;
}

interface CandidateGroup {
  container: ParsedVisibleNode;
  nodes: ParsedVisibleNode[];
  sourceRegion: string;
}

const RESULT_CONTAINER_ROLES = new Set([
  'article',
  'listitem',
  'row',
  'gridcell',
  'cell',
  'treeitem',
  'generic',
]);

const SHELL_ROLES = new Set([
  'banner',
  'navigation',
  'contentinfo',
  'footer',
  'search',
  'form',
  'toolbar',
  'tablist',
]);

const CONTROL_ROLES = new Set([
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'tab',
  'option',
]);

const SHELL_TEXT_PATTERN =
  /\b(filter|filters?|sort|footer|navigation|menu|home|login|sign in|submit|search|all|more|settings|privacy|terms|help)\b|筛选|过滤|排序|首页|登录|搜索|隐私|协议|帮助/i;
const META_PATTERN =
  /\b(\d+\s*(?:h|hr|hrs|hour|hours|d|day|days|m|min|mins|minute|minutes|ago)|yesterday|today|updated|posted|views?)\b|刚刚|分钟前|小时前|昨天|今天|发布|更新/i;
const INTERACTION_PATTERN =
  /\b(\d+(?:\.\d+)?\s*[kKmM]?\s*(?:likes?|stars?|comments?|replies?|views?|shares?))\b|点赞|评论|收藏|转发|阅读|浏览/i;

export function extractVisibleRegionRows(input: {
  pageContent: string;
  sourceRegion?: string | null;
  maxRows?: number;
}): VisibleRegionRowsResult {
  const sourceRegion = normalizeText(input.sourceRegion) || 'viewport';
  const nodes = parseVisibleNodes(input.pageContent);
  const groups = buildCandidateGroups(nodes, sourceRegion);
  const orderedGroups = groups.slice().sort(compareGroupsByVisualOrder);
  const rows = orderedGroups
    .map((group) => buildRow(group))
    .filter((row): row is VisibleRegionRow => row !== null)
    .slice(0, Math.max(1, Math.floor(input.maxRows ?? 20)));
  const rowExtractionConfidence = rows.length
    ? clampConfidence(rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length)
    : 0;
  const cardRowsCount = rows.length;
  const targetRefCoverageRate = rows.length
    ? clampConfidence(rows.filter((row) => row.targetRef).length / rows.length)
    : 0;
  const cardPatternConfidence =
    rows.length >= 2
      ? clampConfidence(
          0.56 +
            Math.min(0.2, rows.length * 0.04) +
            Math.min(0.2, targetRefCoverageRate * 0.2) +
            repeatedRoleBonus(orderedGroups),
        )
      : 0;

  return {
    sourceDataSource: 'dom_region_rows',
    rows,
    rowCount: rows.length,
    visibleRegionRowsUsed: rows.length > 0,
    visibleRegionRowsRejectedReason: rows.length > 0 ? null : 'dom_region_rows_unavailable',
    sourceRegion,
    rowExtractionConfidence,
    cardExtractorUsed: rows.length > 0,
    cardPatternConfidence,
    cardRowsCount,
    rowOrder: 'visual_order',
    targetRefCoverageRate,
  };
}

function parseVisibleNodes(pageContent: string): ParsedVisibleNode[] {
  const lines = String(pageContent || '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const nodes: ParsedVisibleNode[] = [];

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    const match = trimmed.match(/^- ([^\s"]+)(?: "([^"]*)")?(?: \[ref=([^\]]+)\])?/);
    if (!match) return;
    const position = trimmed.match(/\(x=(-?\d+(?:\.\d+)?),y=(-?\d+(?:\.\d+)?)\)/);
    const hrefMatch = trimmed.match(/\shref="([^"]+)"/i);
    const depth = Math.max(0, Math.floor((rawLine.length - rawLine.trimStart().length) / 2));
    nodes.push({
      role: normalizeText(match[1]).toLowerCase() || 'generic',
      name: normalizeText(match[2]),
      ref: normalizeText(match[3]) || null,
      href: normalizeText(hrefMatch?.[1]) || null,
      depth,
      x: position ? Number(position[1]) : null,
      y: position ? Number(position[2]) : null,
      order: index,
    });
  });

  return nodes.slice(0, 500);
}

function buildCandidateGroups(nodes: ParsedVisibleNode[], sourceRegion: string): CandidateGroup[] {
  const groups: CandidateGroup[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!isCandidateContainer(node)) continue;
    const children: ParsedVisibleNode[] = [node];
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      const candidate = nodes[cursor];
      if (candidate.depth <= node.depth) break;
      children.push(candidate);
    }
    if (children.length < 2 && !node.href) continue;
    groups.push({ container: node, nodes: children, sourceRegion });
  }
  return dedupeOverlappingGroups(groups);
}

function isCandidateContainer(node: ParsedVisibleNode): boolean {
  if (!RESULT_CONTAINER_ROLES.has(node.role)) return false;
  if (SHELL_ROLES.has(node.role)) return false;
  if (CONTROL_ROLES.has(node.role)) return false;
  const label = normalizeText(node.name).toLowerCase();
  if (label && SHELL_TEXT_PATTERN.test(label) && !INTERACTION_PATTERN.test(label)) return false;
  return true;
}

function dedupeOverlappingGroups(groups: CandidateGroup[]): CandidateGroup[] {
  const result: CandidateGroup[] = [];
  const usedRefs = new Set<string>();
  for (const group of groups) {
    const ownRef = group.container.ref;
    if (ownRef && usedRefs.has(ownRef)) continue;
    const descendantRefs = group.nodes
      .map((node) => node.ref)
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
    if (descendantRefs.some((ref) => usedRefs.has(ref))) continue;
    for (const ref of descendantRefs) usedRefs.add(ref);
    result.push(group);
  }
  return result;
}

function compareGroupsByVisualOrder(left: CandidateGroup, right: CandidateGroup): number {
  const leftY = groupCoordinate(left, 'y');
  const rightY = groupCoordinate(right, 'y');
  if (leftY !== rightY) return leftY - rightY;
  const leftX = groupCoordinate(left, 'x');
  const rightX = groupCoordinate(right, 'x');
  if (leftX !== rightX) return leftX - rightX;
  return left.container.order - right.container.order;
}

function groupCoordinate(group: CandidateGroup, axis: 'x' | 'y'): number {
  const values = group.nodes
    .map((node) => node[axis])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.min(...values);
}

function repeatedRoleBonus(groups: CandidateGroup[]): number {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.container.role, (counts.get(group.container.role) ?? 0) + 1);
  }
  return Array.from(counts.values()).some((count) => count >= 2) ? 0.12 : 0;
}

function buildRow(group: CandidateGroup): VisibleRegionRow | null {
  const textNodes = group.nodes
    .filter((node) => node.name)
    .filter((node) => node !== group.container || node.role === 'link' || node.role === 'heading')
    .filter((node) => !SHELL_ROLES.has(node.role))
    .filter((node) => !isLowValueShellText(node.name));
  if (textNodes.length === 0) return null;

  const titleNode = pickTitleNode(textNodes);
  if (!titleNode) return null;
  const title = titleNode.name;
  const remaining = textNodes.filter((node) => node !== titleNode);
  const interactionText = firstMatchingText(remaining, INTERACTION_PATTERN);
  const metaText = firstMatchingText(remaining, META_PATTERN);
  const primaryText = firstNonMatchingText(remaining, [INTERACTION_PATTERN, META_PATTERN]);
  const secondaryText = firstNonMatchingText(
    remaining.filter((node) => node.name !== primaryText),
    [INTERACTION_PATTERN, META_PATTERN],
  );
  const targetRef =
    group.nodes.find((node) => node.href && node.ref)?.ref ||
    group.nodes.find((node) => node.ref && node.role === 'link')?.ref ||
    group.container.ref;
  const textFieldCount = [primaryText, secondaryText, metaText, interactionText].filter(
    Boolean,
  ).length;
  const confidence = clampConfidence(
    0.52 + (targetRef ? 0.16 : 0) + Math.min(0.24, textFieldCount * 0.06),
  );

  return {
    title,
    primaryText: primaryText || null,
    secondaryText: secondaryText || null,
    metaText: metaText || null,
    interactionText: interactionText || null,
    targetRef: targetRef || null,
    sourceRegion: group.sourceRegion,
    confidence,
  };
}

function pickTitleNode(nodes: ParsedVisibleNode[]): ParsedVisibleNode | null {
  const candidates = nodes
    .filter((node) => !CONTROL_ROLES.has(node.role) || node.role === 'link')
    .filter((node) => !META_PATTERN.test(node.name) && !INTERACTION_PATTERN.test(node.name))
    .filter((node) => node.name.length >= 2)
    .sort(
      (left, right) => scoreTitleNode(right) - scoreTitleNode(left) || left.order - right.order,
    );
  return candidates[0] ?? null;
}

function scoreTitleNode(node: ParsedVisibleNode): number {
  let score = 0;
  if (node.role === 'heading') score += 30;
  if (node.role === 'link') score += 24;
  if (node.href) score += 18;
  if (node.name.length >= 8) score += 12;
  if (node.name.length >= 80) score -= 20;
  score -= node.depth;
  return score;
}

function firstMatchingText(nodes: ParsedVisibleNode[], pattern: RegExp): string | null {
  return nodes.find((node) => pattern.test(node.name))?.name ?? null;
}

function firstNonMatchingText(nodes: ParsedVisibleNode[], patterns: RegExp[]): string | null {
  return nodes.find((node) => patterns.every((pattern) => !pattern.test(node.name)))?.name ?? null;
}

function isLowValueShellText(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized.length <= 1) return true;
  return SHELL_TEXT_PATTERN.test(normalized) && normalized.length < 24;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(0.99, value)).toFixed(2));
}
