import type {
  ReadPageVisibleRegionBoundingBox,
  ReadPageVisibleRegionPageInfo,
  ReadPageVisibleRegionRejectionReason,
  ReadPageVisibleRegionRow,
  ReadPageVisibleRegionRows,
} from '@tabrix/shared';

export type VisibleRegionRow = ReadPageVisibleRegionRow;

export type VisibleRegionBoundingBox = ReadPageVisibleRegionBoundingBox;

export type VisibleRegionPageInfo = ReadPageVisibleRegionPageInfo;

export type VisibleRegionRejectionReason = ReadPageVisibleRegionRejectionReason;

export type VisibleRegionRowsResult = ReadPageVisibleRegionRows;

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
  regionId: string;
}

interface CandidateBuildResult {
  groups: CandidateGroup[];
  rejectedReasonDistribution: Record<VisibleRegionRejectionReason, number>;
}

interface SearchShellContext {
  searchTerms: Set<string>;
  pageTitle: string;
  titleLooksSearchShell: boolean;
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
  /\b(filter|filters?|sort|footer|navigation|menu|home|login|sign in|submit|search|all|more|settings|privacy|terms|help|sponsor|sponsors?|sponsorable|skip to content|copyright|feedback|sidebar|topics?)\b|筛选|过滤|排序|首页|登录|搜索|赞助|隐私|协议|帮助|创作中心|放映厅|小游戏|业务合作|营业执照|公网安备|网文|ICP备|备案|许可证|许可|网络交易服务|医疗器械/i;
const FOOTER_LEGAL_REPORT_PATTERN =
  /\b(footer|privacy|terms|copyright|certificate|license|permit|legal|compliance|sponsors?|sponsorable|report (?:abuse|harmful|center)|harmful information report|rumou?r exposure|exposure desk|internet report center|business license|internet drug information service)\b|隐私|协议|版权|赞助|举报|有害信息|互联网举报|网络谣言|谣言曝光|资格证书|许可证|备案|公网安备|网文|营业执照|违法不良|网信算备|增值电信|ICP备?/i;
const SEARCH_CONTROL_TEXT_PATTERN =
  /\b(search results?(?: for)?|results for|search query|query|filters?|sort|feedback|how can we improve|ask ai summary|ai summary|topics?|sponsors?)\b|搜索结果|搜索词|筛选|过滤|排序|反馈|话题|赞助|为你找到以下结果|问问AI智能总结内容|^客户端$/i;
const UTILITY_LINK_TEXT_PATTERN =
  /\b(creator center|creator learning center|upload|upload video|video management|works? data|live data|ads?|advertising|advertisements?|account recovery|contact us|join us|site map|sitemap|friend links|business license|about us|download app)\b|发布视频(?:\/图文)?|发布图文|视频管理|作品数据|直播数据|创作者学习中心|创作中心|广告投放|账号找回|联系我们|加入我们|站点地图|友情链接|业务合作|营业执照|^下载(?:app|应用|客户端)?$/i;
const UTILITY_LINK_HREF_PATTERN =
  /(?:^|\/)(?:creator(?:-center)?|creator-center|upload|video-management|ads?|advertising|account(?:-recovery)?|recover|recovery|contact(?:-us)?|about(?:-us)?|sitemap|site-map|friend-links?|download(?:-app)?|legal|privacy|terms|certificate|license|permit|compliance|icp|record|report|feedback|sponsors?)(?:\/|$|\?)/i;
const META_PATTERN =
  /\b(\d+\s*(?:h|hr|hrs|hour|hours|d|day|days|m|min|mins|minute|minutes|ago)|yesterday|today|updated|posted|views?|\d{1,2}:\d{2})\b|\d{4}年\d{1,2}月\d{1,2}日|刚刚|分钟前|小时前|昨天|今天|发布|更新/i;
const INTERACTION_PATTERN =
  /\b(\d+(?:\.\d+)?\s*[kKmM]?\s*(?:likes?|stars?|comments?|replies?|views?|shares?))\b|点赞|评论|收藏|转发|阅读|浏览/i;

export function extractVisibleRegionRows(input: {
  pageContent: string;
  sourceRegion?: string | null;
  maxRows?: number;
  fallbackInteractiveElements?: Array<{
    ref?: unknown;
    role?: unknown;
    name?: unknown;
    href?: unknown;
  }>;
  url?: string | null;
  title?: string | null;
  viewport?: { width?: number | null; height?: number | null; dpr?: number | null } | null;
  scrollY?: number | null;
  pixelsBelow?: number | null;
}): VisibleRegionRowsResult {
  const sourceRegion = normalizeText(input.sourceRegion) || 'viewport';
  const nodes = parseVisibleNodes(input.pageContent);
  const searchShellContext = buildSearchShellContext(input.url, input.title);
  const { groups, rejectedReasonDistribution } = buildCandidateGroups(
    nodes,
    sourceRegion,
    searchShellContext,
  );
  const orderedGroups = supplementGroupsFromInteractiveElements(
    groups.slice().sort(compareGroupsByVisualOrder),
    input.fallbackInteractiveElements,
    sourceRegion,
    rejectedReasonDistribution,
    searchShellContext,
  );
  const candidateRows = orderedGroups
    .map((group) => buildRow(group, searchShellContext))
    .filter((row): row is VisibleRegionRow => row !== null)
    .slice(0, Math.max(1, Math.floor(input.maxRows ?? 20)));
  const candidateTargetRefCoverageRate = candidateRows.length
    ? clampConfidence(candidateRows.filter((row) => row.targetRef).length / candidateRows.length)
    : 0;
  const rows =
    candidateRows.length >= 2 && candidateTargetRefCoverageRate >= 0.95 ? candidateRows : [];
  if (candidateRows.length > 0 && rows.length === 0) {
    if (candidateRows.length < 2) {
      rejectedReasonDistribution.single_isolated_text += candidateRows.length;
    } else {
      rejectedReasonDistribution.target_ref_coverage_insufficient += candidateRows.length;
    }
  }
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
            repeatedRoleBonus(orderedGroups) +
            Math.min(0.08, averageRowQualityBonus(rows)),
        )
      : 0;
  const regionQualityScore = rows.length
    ? clampConfidence((rowExtractionConfidence + cardPatternConfidence + targetRefCoverageRate) / 3)
    : 0;
  const rejectedReason =
    rows.length > 0
      ? null
      : candidateRows.length > 0
        ? candidateRows.length < 2
          ? 'single_isolated_text'
          : 'target_ref_coverage_insufficient'
        : firstRejectedReason(rejectedReasonDistribution);

  return {
    sourceDataSource: 'dom_region_rows',
    rows,
    rowCount: rows.length,
    visibleRegionRowsUsed: rows.length > 0,
    visibleRegionRowsRejectedReason: rejectedReason,
    sourceRegion,
    rowExtractionConfidence,
    cardExtractorUsed: rows.length > 0,
    cardPatternConfidence,
    cardRowsCount,
    rowOrder: 'visual_order',
    targetRefCoverageRate,
    regionQualityScore,
    visibleDomRowsCandidateCount: candidateRows.length,
    visibleDomRowsSelectedCount: rows.length,
    lowValueRegionRejectedCount:
      rejectedReasonDistribution.low_value_region +
      rejectedReasonDistribution.single_isolated_text +
      rejectedReasonDistribution.empty_shell +
      rejectedReasonDistribution.broad_page_shell,
    footerLikeRejectedCount: rejectedReasonDistribution.footer_like_region,
    navigationLikeRejectedCount: rejectedReasonDistribution.navigation_like_region,
    targetRefCoverageRejectedCount: rejectedReasonDistribution.target_ref_coverage_insufficient,
    rejectedRegionReasonDistribution: rejectedReasonDistribution,
    pageInfo: {
      url: normalizeText(input.url) || null,
      title: normalizeText(input.title) || null,
      viewport: {
        width: finiteNumber(input.viewport?.width),
        height: finiteNumber(input.viewport?.height),
        dpr: finiteNumber(input.viewport?.dpr),
      },
      scrollY: finiteNumber(input.scrollY),
      pixelsAbove: finiteNumber(input.scrollY),
      pixelsBelow: finiteNumber(input.pixelsBelow),
      visibleRegionCount: nodes.filter((node) => hasVisibleCoordinate(node)).length,
      candidateRegionCount: orderedGroups.length,
    },
  };
}

function supplementGroupsFromInteractiveElements(
  groups: CandidateGroup[],
  fallbackInteractiveElements:
    | Array<{
        ref?: unknown;
        role?: unknown;
        name?: unknown;
        href?: unknown;
      }>
    | null
    | undefined,
  sourceRegion: string,
  rejectedReasonDistribution: Record<VisibleRegionRejectionReason, number>,
  searchShellContext: SearchShellContext,
): CandidateGroup[] {
  if (!Array.isArray(fallbackInteractiveElements) || fallbackInteractiveElements.length === 0) {
    return groups;
  }
  const usedRefs = new Set(
    groups
      .flatMap((group) => group.nodes.map((node) => node.ref))
      .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
  );
  const fallbackNodes: ParsedVisibleNode[] = [];
  fallbackInteractiveElements
    .map((item, index): ParsedVisibleNode => {
      const role = normalizeText(item?.role).toLowerCase() || 'generic';
      const name = normalizeText(item?.name);
      const ref = normalizeText(item?.ref) || null;
      const href = normalizeText(item?.href) || null;
      return { role, name, ref, href, depth: 0, x: null, y: null, order: 10_000 + index };
    })
    .forEach((node) => {
      if (!isStandaloneResultLink(node, searchShellContext)) {
        const shellReason = classifyShellNode(node, searchShellContext);
        if (shellReason) rejectedReasonDistribution[shellReason] += 1;
        return;
      }
      if (!node.ref || usedRefs.has(node.ref)) return;
      usedRefs.add(node.ref);
      fallbackNodes.push(node);
    });
  if (fallbackNodes.length < 2) return groups;
  return [
    ...groups,
    ...fallbackNodes.map((node, index) => ({
      container: node,
      nodes: [node],
      sourceRegion,
      regionId: node.ref || `${sourceRegion}_interactive_${index + 1}`,
    })),
  ];
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

function buildCandidateGroups(
  nodes: ParsedVisibleNode[],
  sourceRegion: string,
  searchShellContext: SearchShellContext,
): CandidateBuildResult {
  const groups: CandidateGroup[] = [];
  const rejectedReasonDistribution = emptyRejectedDistribution();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const shellReason = classifyShellNode(node, searchShellContext);
    if (shellReason) {
      rejectedReasonDistribution[shellReason] += 1;
      continue;
    }
    if (!isCandidateContainer(node)) continue;
    const children: ParsedVisibleNode[] = [node];
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      const candidate = nodes[cursor];
      if (candidate.depth <= node.depth) break;
      children.push(candidate);
    }
    if (children.length < 2 && !node.href) {
      rejectedReasonDistribution.single_isolated_text += 1;
      continue;
    }
    if (children.every((child) => !normalizeText(child.name))) {
      rejectedReasonDistribution.empty_shell += 1;
      continue;
    }
    if (isBroadPageContainer(node, children)) {
      rejectedReasonDistribution.broad_page_shell += 1;
      continue;
    }
    groups.push({
      container: node,
      nodes: children,
      sourceRegion,
      regionId: node.ref || `${sourceRegion}_${groups.length + 1}`,
    });
  }
  const standaloneResultLinks = nodes.filter((node) =>
    isStandaloneResultLink(node, searchShellContext),
  );
  if (standaloneResultLinks.length < 2) {
    rejectedReasonDistribution.single_isolated_text += standaloneResultLinks.length;
  }
  for (const node of standaloneResultLinks.length >= 2 ? standaloneResultLinks : []) {
    groups.push({
      container: node,
      nodes: [node],
      sourceRegion,
      regionId: node.ref || `${sourceRegion}_${groups.length + 1}`,
    });
  }
  groups.push(...buildHeadingAnchoredGroups(nodes, sourceRegion, searchShellContext));
  return {
    groups: dedupeOverlappingGroups(groups, searchShellContext),
    rejectedReasonDistribution,
  };
}

function isStandaloneResultLink(
  node: ParsedVisibleNode,
  searchShellContext?: SearchShellContext,
): boolean {
  if (node.role !== 'link') return false;
  if (!node.ref || !node.href) return false;
  const label = normalizeText(node.name);
  if (label.length < 6) return false;
  if (/^image:/i.test(label)) return false;
  if (
    isLowValueShellNode(node, searchShellContext) ||
    isUtilityLinkNode(node) ||
    isTagLikeLink(node) ||
    isFooterLikeText(label) ||
    isNavigationLikeText(label)
  ) {
    return false;
  }
  const href = node.href.toLowerCase();
  if (/^\/?(?:explore|home)(?:$|\?)/i.test(href)) return false;
  if (/\.(?:pdf|png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(href)) return false;
  if (
    /(^|\/)(?:user|profile|account|settings|help|about|privacy|terms|sponsors?)(?:\/|$)/i.test(href)
  ) {
    return false;
  }
  if (isUtilityHref(href)) return false;
  return true;
}

function buildHeadingAnchoredGroups(
  nodes: ParsedVisibleNode[],
  sourceRegion: string,
  searchShellContext: SearchShellContext,
): CandidateGroup[] {
  const groups: CandidateGroup[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const titleNode = pickHeadingAnchorTitleNode(nodes, index, searchShellContext);
    if (!titleNode) continue;

    const groupNodes = [titleNode];
    const titleY = titleNode.y;
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      const candidate = nodes[cursor];
      if (candidate !== titleNode && isHeadingAnchorTitleNode(candidate, searchShellContext)) {
        break;
      }
      if (
        titleY !== null &&
        candidate.y !== null &&
        Math.abs(candidate.y - titleY) > 170 &&
        groupNodes.length >= 2
      ) {
        break;
      }
      if (candidate === titleNode) continue;
      if (candidate.role === 'link' && isTagLikeLink(candidate)) continue;
      if (isFooterLikeText(candidate.name) || isNavigationLikeText(candidate.name)) continue;
      groupNodes.push(candidate);
      if (groupNodes.length >= 10) break;
    }

    if (groupNodes.length < 2) continue;
    groups.push({
      container: titleNode,
      nodes: groupNodes,
      sourceRegion,
      regionId: titleNode.ref || `${sourceRegion}_heading_${groups.length + 1}`,
    });
  }
  return groups;
}

function pickHeadingAnchorTitleNode(
  nodes: ParsedVisibleNode[],
  index: number,
  searchShellContext: SearchShellContext,
): ParsedVisibleNode | null {
  const node = nodes[index];
  if (isHeadingAnchorTitleNode(node, searchShellContext)) return node;
  if (node.role !== 'heading') return null;
  const childLink = nodes
    .slice(index + 1)
    .find((candidate) => candidate.depth > node.depth && candidate.role === 'link');
  if (!childLink || !isHeadingAnchorTitleNode(childLink, searchShellContext)) return null;
  return childLink;
}

function isHeadingAnchorTitleNode(
  node: ParsedVisibleNode,
  searchShellContext?: SearchShellContext,
): boolean {
  if (node.role !== 'link' && node.role !== 'heading') return false;
  if (!node.ref) return false;
  const label = normalizeText(node.name);
  if (label.length < 6) return false;
  if (isLowValueShellNode(node, searchShellContext) || isTagLikeLink(node)) return false;
  if (node.role === 'link' && !node.href) return false;
  const wordCount = label.split(/\s+/).filter(Boolean).length;
  return label.includes('/') || wordCount >= 3 || label.length >= 18;
}

function isCandidateContainer(node: ParsedVisibleNode): boolean {
  if (!RESULT_CONTAINER_ROLES.has(node.role)) return false;
  if (SHELL_ROLES.has(node.role)) return false;
  if (CONTROL_ROLES.has(node.role)) return false;
  const label = normalizeText(node.name).toLowerCase();
  if (label && SHELL_TEXT_PATTERN.test(label) && !INTERACTION_PATTERN.test(label)) return false;
  return true;
}

function classifyShellNode(
  node: ParsedVisibleNode,
  searchShellContext?: SearchShellContext,
): VisibleRegionRejectionReason | null {
  const label = normalizeText(node.name);
  if (node.role === 'contentinfo' || node.role === 'footer') return 'footer_like_region';
  if (node.role === 'navigation' || node.role === 'banner' || node.role === 'toolbar') {
    return 'navigation_like_region';
  }
  if (node.role === 'form' || node.role === 'search' || node.role === 'tablist') {
    return 'low_value_region';
  }
  if (!label) return null;
  if (isFooterLikeText(label)) return 'footer_like_region';
  if (isNavigationLikeText(label)) return 'navigation_like_region';
  if (isUtilityLinkNode(node)) return 'low_value_region';
  if (isLowValueShellText(label, searchShellContext)) return 'low_value_region';
  return null;
}

function dedupeOverlappingGroups(
  groups: CandidateGroup[],
  searchShellContext: SearchShellContext,
): CandidateGroup[] {
  const result: CandidateGroup[] = [];
  const usedRefs = new Set<string>();
  const orderedGroups = groups
    .map((group, index) => ({
      group,
      index,
      priority: groupDedupePriority(group, searchShellContext),
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.group);

  for (const group of orderedGroups) {
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

function groupDedupePriority(
  group: CandidateGroup,
  searchShellContext: SearchShellContext,
): number {
  if (isStrongCardContainer(group.container)) return 100;
  if (
    group.container.role === 'link' &&
    isStandaloneResultLink(group.container, searchShellContext)
  ) {
    return 90;
  }
  if (isHeadingAnchorTitleNode(group.container, searchShellContext)) return 88;

  const standaloneResultLinkCount = group.nodes.filter((node) =>
    isStandaloneResultLink(node, searchShellContext),
  ).length;
  if (group.container.role === 'generic') {
    if (standaloneResultLinkCount === 1 && group.nodes.length <= 8) return 95;
    if (standaloneResultLinkCount > 1) return 10;
  }

  return 50;
}

function isStrongCardContainer(node: ParsedVisibleNode): boolean {
  return ['article', 'listitem', 'row', 'gridcell', 'cell', 'treeitem'].includes(node.role);
}

function isBroadPageContainer(container: ParsedVisibleNode, nodes: ParsedVisibleNode[]): boolean {
  if (container.role === 'article' || container.role === 'listitem' || container.role === 'row') {
    return false;
  }
  const linkCount = nodes.filter((node) => node.role === 'link' || Boolean(node.href)).length;
  const headingCount = nodes.filter((node) => node.role === 'heading').length;
  const textCount = nodes.filter((node) => node.name).length;
  if (nodes.length > 18) return true;
  if (textCount > 12 && linkCount > 3) return true;
  if (headingCount > 2 && linkCount > 2) return true;
  return false;
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

function averageRowQualityBonus(rows: VisibleRegionRow[]): number {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => sum + Math.min(4, row.qualityReasons.length), 0);
  return total / rows.length / 20;
}

function buildRow(
  group: CandidateGroup,
  searchShellContext: SearchShellContext,
): VisibleRegionRow | null {
  const textNodes = group.nodes
    .filter((node) => node.name)
    .filter((node) => node !== group.container || node.role === 'link' || node.role === 'heading')
    .filter((node) => !SHELL_ROLES.has(node.role))
    .filter((node) => !isLowValueShellNode(node, searchShellContext))
    .filter((node) => !isTagLikeLink(node));
  if (textNodes.length === 0) return null;

  const titleNode = pickTitleNode(textNodes, searchShellContext);
  if (!titleNode) return null;
  const title = titleNode.name;
  const remaining = textNodes.filter((node) => node !== titleNode);
  const interactionText = firstInteractionText(remaining);
  const metaText = firstMatchingText(remaining, META_PATTERN);
  const primaryText = firstNonMatchingText(
    remaining.filter((node) => !isInteractionNode(node)),
    [INTERACTION_PATTERN, META_PATTERN],
  );
  const secondaryText = firstNonMatchingText(
    remaining.filter((node) => node.name !== primaryText),
    [INTERACTION_PATTERN, META_PATTERN],
  );
  const targetRef =
    group.nodes.find((node) => node.href && node.ref)?.ref ||
    group.nodes.find((node) => node.ref && node.role === 'link')?.ref ||
    group.container.ref;
  const visibleTextFields = uniqueCompactStrings([
    title,
    primaryText,
    secondaryText,
    metaText,
    interactionText,
  ]);
  const summary = uniqueCompactStrings([primaryText, secondaryText, metaText]).join(' | ') || null;
  const textFieldCount = [primaryText, secondaryText, metaText, interactionText].filter(
    Boolean,
  ).length;
  const qualityReasons = buildQualityReasons(group, {
    targetRef,
    textFieldCount,
    visibleTextFields,
  });
  const confidence = clampConfidence(
    0.52 +
      (targetRef ? 0.16 : 0) +
      Math.min(0.24, textFieldCount * 0.06) +
      (qualityReasons.includes('repeated_card_region') ? 0.04 : 0),
  );

  return {
    rowId: `${group.regionId}_row_${group.container.order}`,
    title,
    primaryText: primaryText || null,
    secondaryText: secondaryText || null,
    summary,
    metaText: metaText || null,
    interactionText: interactionText || null,
    visibleTextFields,
    targetRef: targetRef || null,
    targetRefCoverageRate: targetRef ? 0.99 : 0,
    boundingBox: groupBoundingBox(group),
    regionId: group.regionId,
    sourceRegion: group.sourceRegion,
    confidence,
    qualityReasons,
  };
}

function buildQualityReasons(
  group: CandidateGroup,
  row: {
    targetRef: string | null | undefined;
    textFieldCount: number;
    visibleTextFields: string[];
  },
): string[] {
  const reasons: string[] = [];
  if (group.nodes.length >= 3) reasons.push('repeated_card_region');
  if (row.visibleTextFields.length >= 2) reasons.push('multi_text_fields');
  if (row.targetRef) reasons.push('target_ref_available');
  if (row.textFieldCount >= 2) reasons.push('metadata_or_interaction_present');
  if (hasVisibleCoordinate(group.container)) reasons.push('visible_bounding_box');
  return reasons.length > 0 ? reasons : ['minimal_visible_text'];
}

function pickTitleNode(
  nodes: ParsedVisibleNode[],
  searchShellContext: SearchShellContext,
): ParsedVisibleNode | null {
  const candidates = nodes
    .filter((node) => !CONTROL_ROLES.has(node.role) || node.role === 'link')
    .filter((node) => !isLowValueShellNode(node, searchShellContext))
    .filter((node) => !isTagLikeLink(node))
    .filter((node) => !isMetaOnlyText(node.name) && !INTERACTION_PATTERN.test(node.name))
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

function firstInteractionText(nodes: ParsedVisibleNode[]): string | null {
  return nodes.find((node) => isInteractionNode(node))?.name ?? null;
}

function firstNonMatchingText(nodes: ParsedVisibleNode[], patterns: RegExp[]): string | null {
  return nodes.find((node) => patterns.every((pattern) => !pattern.test(node.name)))?.name ?? null;
}

function groupBoundingBox(group: CandidateGroup): VisibleRegionBoundingBox | null {
  const xs = group.nodes
    .map((node) => node.x)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const ys = group.nodes
    .map((node) => node.y)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (xs.length === 0 && ys.length === 0) return null;
  return {
    x: xs.length > 0 ? Math.min(...xs) : null,
    y: ys.length > 0 ? Math.min(...ys) : null,
    width: xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : null,
    height: ys.length > 1 ? Math.max(...ys) - Math.min(...ys) : null,
  };
}

function hasVisibleCoordinate(node: ParsedVisibleNode): boolean {
  return (
    typeof node.x === 'number' &&
    Number.isFinite(node.x) &&
    typeof node.y === 'number' &&
    Number.isFinite(node.y)
  );
}

function uniqueCompactStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isLowValueShellText(value: string, searchShellContext?: SearchShellContext): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized.length <= 1) return true;
  if (/^image:/i.test(normalized)) return true;
  if (/^\d+(?:\.\d+)?(?:万|k|m)?$/i.test(normalized)) return true;
  if (isSearchShellText(normalized, searchShellContext)) return true;
  if (isShortStandaloneTopicLabel(normalized)) return true;
  if (FOOTER_LEGAL_REPORT_PATTERN.test(normalized)) return true;
  if (UTILITY_LINK_TEXT_PATTERN.test(normalized) && normalized.length < 48) return true;
  if (SEARCH_CONTROL_TEXT_PATTERN.test(normalized) && normalized.length < 48) return true;
  return SHELL_TEXT_PATTERN.test(normalized) && normalized.length < 24;
}

function isLowValueShellNode(
  node: ParsedVisibleNode,
  searchShellContext?: SearchShellContext,
): boolean {
  if (isInteractionNode(node)) return false;
  return isLowValueShellText(node.name, searchShellContext);
}

function isInteractionNode(node: ParsedVisibleNode): boolean {
  if (INTERACTION_PATTERN.test(node.name)) return true;
  if (!node.href) return false;
  const normalized = normalizeText(node.name);
  if (!/^\d+(?:\.\d+)?\s*(?:k|m)?$/i.test(normalized)) return false;
  return /(?:stars?|stargazers?|forks?|likes?|watchers?)(?:\/|$|\?)/i.test(node.href);
}

function isTagLikeLink(node: ParsedVisibleNode): boolean {
  if (node.role !== 'link') return false;
  const label = normalizeText(node.name);
  if (!label || label.length > 32) return false;
  if (label.includes('/')) return false;
  if (/\s/.test(label) && label.split(/\s+/).length > 2) return false;
  if (isShortStandaloneTopicLabel(label)) return true;
  if (!node.href) return false;
  return /(?:^|\/)(?:topics?|tags?|tag|labels?)(?:\/|$|\?)/i.test(node.href);
}

function isShortStandaloneTopicLabel(label: string): boolean {
  return /^(?:automation|browser|browse)$/i.test(normalizeText(label));
}

function isSearchShellText(
  label: string,
  searchShellContext: SearchShellContext | undefined,
): boolean {
  const normalized = normalizeSearchShellText(label);
  if (!normalized) return false;
  if (SEARCH_RESULT_TITLE_ROW_PATTERN.test(label)) return true;
  if (!searchShellContext) return false;
  if (
    searchShellContext.titleLooksSearchShell &&
    searchShellContext.pageTitle &&
    normalized === searchShellContext.pageTitle
  ) {
    return true;
  }
  return searchShellContext.searchTerms.has(normalized);
}

const SEARCH_RESULT_TITLE_ROW_PATTERN =
  /^(?:[a-z0-9][\w\s-]{0,40}\s+)?search results?(?:\s+(?:for|of)\s+|\s*[·:|>\-–—]\s*).{2,}$/i;

function buildSearchShellContext(url: unknown, title: unknown): SearchShellContext {
  const searchTerms = new Set<string>();
  const pageTitle = normalizeSearchShellText(title);
  const titleText = normalizeText(title);
  const titleLooksSearchShell = SEARCH_RESULT_TITLE_ROW_PATTERN.test(titleText);

  addSearchTerm(searchTerms, extractSearchQueryFromTitle(titleText));

  try {
    const parsedUrl = new URL(normalizeText(url), 'https://tabrix.invalid');
    for (const key of ['q', 'query', 'search', 'keyword', 'keywords', 'text']) {
      addSearchTerm(searchTerms, parsedUrl.searchParams.get(key));
    }
  } catch {
    // Ignore malformed or non-URL inputs; search-shell filtering remains text-only.
  }

  return { searchTerms, pageTitle, titleLooksSearchShell };
}

function extractSearchQueryFromTitle(title: string): string {
  const match = title.match(/(?:search results?(?:\s+(?:for|of)\s+|\s*[·:|>\-–—]\s*))(.+)$/i);
  return match?.[1] ?? '';
}

function addSearchTerm(target: Set<string>, value: unknown): void {
  const normalized = normalizeSearchShellText(value);
  if (normalized.length >= 3) target.add(normalized);
}

function normalizeSearchShellText(value: unknown): string {
  return normalizeText(value)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .toLowerCase();
}

function isFooterLikeText(value: string): boolean {
  return FOOTER_LEGAL_REPORT_PATTERN.test(value);
}

function isUtilityLinkNode(node: ParsedVisibleNode): boolean {
  const label = normalizeText(node.name);
  if (label && UTILITY_LINK_TEXT_PATTERN.test(label) && label.length < 64) return true;
  return Boolean(node.href && isUtilityHref(node.href));
}

function isUtilityHref(href: string): boolean {
  return UTILITY_LINK_HREF_PATTERN.test(href.toLowerCase());
}

function isNavigationLikeText(value: string): boolean {
  return /\b(navigation|menu|home|sidebar|skip to content)\b|导航|菜单|首页|侧边栏/i.test(value);
}

function isMetaOnlyText(value: string): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (/^\d{4}年\d{1,2}月\d{1,2}日(?:\s+GMT[+-]?\d*\s+\d{1,2}:\d{2})?$/i.test(normalized)) {
    return true;
  }
  if (/^\d{1,2}:\d{2}$/.test(normalized)) return true;
  if (/^(?:yesterday|today|updated|posted)$/i.test(normalized)) return true;
  if (
    /^\d+\s*(?:h|hr|hrs|hour|hours|d|day|days|m|min|mins|minute|minutes)(?:\s+ago)?$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(?:刚刚|分钟前|小时前|昨天|今天|发布|更新)$/.test(normalized)) return true;
  return false;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(0.99, value)).toFixed(2));
}

function emptyRejectedDistribution(): Record<VisibleRegionRejectionReason, number> {
  return {
    low_value_region: 0,
    footer_like_region: 0,
    navigation_like_region: 0,
    target_ref_coverage_insufficient: 0,
    single_isolated_text: 0,
    empty_shell: 0,
    broad_page_shell: 0,
    dom_region_rows_unavailable: 0,
  };
}

function firstRejectedReason(
  distribution: Record<VisibleRegionRejectionReason, number>,
): VisibleRegionRejectionReason {
  const ordered: VisibleRegionRejectionReason[] = [
    'footer_like_region',
    'navigation_like_region',
    'target_ref_coverage_insufficient',
    'low_value_region',
    'single_isolated_text',
    'empty_shell',
    'broad_page_shell',
  ];
  return ordered.find((reason) => distribution[reason] > 0) ?? 'dom_region_rows_unavailable';
}
