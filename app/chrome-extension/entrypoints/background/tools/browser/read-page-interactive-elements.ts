import type { ReadPageInteractiveElement, ReadPageMode } from '@tabrix/shared';

interface SnapshotNode {
  role: string;
  name: string;
  ref: string;
  depth: number;
  href: string | null;
}

export type SnapshotInteractiveElement = ReadPageInteractiveElement;

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'option',
  'menuitem',
  'tab',
  'treeitem',
  'spinbutton',
]);

const COMPACT_ROLE_PRIORITY = new Map<string, number>([
  ['textbox', 70],
  ['searchbox', 70],
  ['combobox', 68],
  ['button', 56],
  ['tab', 52],
  ['menuitem', 48],
  ['link', 34],
]);

const COMPACT_ACTION_KEYWORDS =
  /(issues?|pull requests?|actions?|search|filter|label|milestone|assignee|summary|jobs?|run\b|login|sign in|submit|save|continue|next|confirm|apply|checkout|export|archive|details?|settings|手机号|验证码|登录|提交|保存|搜索|筛选|过滤|详情|设置|导出)/i;

const COMPACT_SHELL_NAME_PATTERNS = [/^skip to content$/i, /^search or jump to/i, /^open copilot/i];

const COMPACT_STATUS_LABEL_PATTERNS =
  /\b\d+\s+jobs?\b|completed|failed|cancelled|succeeded|in progress|queued/i;

const COMPACT_RUN_DETAIL_PATTERNS = /\brun\s+\d+\s+of\b|workflow run/i;
const GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN =
  /https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN = /\/actions\/runs\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN = /\/actions\/runs\/\d+(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN = /\/actions\/runs\/\d+\/job\/\d+/i;
const WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN = /\/actions\/runs\/\d+\/usage(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN = /\/actions\/runs\/\d+\/workflow(?:[/?#]|$)/i;
const WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN = /#step(?::|=)|\/actions\/runs\/\d+\/job\/\d+.*#step/i;

const WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN =
  /(summary|show all jobs|jobs?|artifacts?|annotations?|logs?|steps?)/i;

const WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN = /^(main|master|develop|dev)$/i;
const WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN = /^\d+[smhd]$/i;

interface CompactScoringContext {
  workflowRunDetail: boolean;
}

const DEFAULT_COMPACT_SCORING_CONTEXT: CompactScoringContext = {
  workflowRunDetail: false,
};

function isGithubWorkflowRunDetailUrl(url: string): boolean {
  return GITHUB_WORKFLOW_RUN_DETAIL_URL_PATTERN.test(String(url || '').trim());
}

function inferWorkflowRunDetailLabelFromHref(href: string): string {
  const normalizedHref = String(href || '')
    .trim()
    .toLowerCase();
  if (!normalizedHref) return '';

  if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(normalizedHref)) return 'Logs';
  if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(normalizedHref)) return 'Jobs';
  if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(normalizedHref)) return 'Artifacts';
  if (
    WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(normalizedHref) ||
    WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(normalizedHref)
  ) {
    return 'Summary';
  }

  return '';
}

function scoreWorkflowRunDetailNode(node: SnapshotNode): number {
  const name = String(node.name || '').trim();
  const href = String(node.href || '')
    .trim()
    .toLowerCase();
  let score = 0;

  if (WORKFLOW_RUN_DETAIL_NAME_PRIORITY_PATTERN.test(name)) score += 72;

  if (href) {
    if (WORKFLOW_RUN_DETAIL_HREF_BASE_PATTERN.test(href)) score += 18;
    if (WORKFLOW_RUN_DETAIL_HREF_SUMMARY_PATTERN.test(href)) score += 82;
    if (WORKFLOW_RUN_DETAIL_HREF_JOB_PATTERN.test(href)) score += 94;
    if (WORKFLOW_RUN_DETAIL_HREF_USAGE_PATTERN.test(href)) score += 76;
    if (WORKFLOW_RUN_DETAIL_HREF_WORKFLOW_PATTERN.test(href)) score += 78;
    if (WORKFLOW_RUN_DETAIL_HREF_STEP_PATTERN.test(href)) score += 102;

    if (/\/commit\//i.test(href)) score -= 130;
    if (/\/tree\/refs\/heads\//i.test(href)) score -= 120;
    if (/^\/[^/]+$/.test(href) || /github\.com\/[^/]+\/?$/.test(href)) score -= 98;
  }

  if (WORKFLOW_RUN_DETAIL_METADATA_COMMIT_PATTERN.test(name)) score -= 86;
  if (WORKFLOW_RUN_DETAIL_METADATA_BRANCH_PATTERN.test(name)) score -= 72;
  if (WORKFLOW_RUN_DETAIL_METADATA_DURATION_PATTERN.test(name)) score -= 66;

  return score;
}

function parseSnapshotNodesFromPageContent(pageContent: string): SnapshotNode[] {
  const lines = String(pageContent || '')
    .split('\n')
    .filter((line) => line.trim());

  const nodes: SnapshotNode[] = [];
  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    const match = trimmedLine.match(/^- ([^\s"]+)(?: "([^"]*)")? \[ref=([^\]]+)\]/);
    if (!match) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const hrefMatch = trimmedLine.match(/\shref="([^"]+)"/i);
    nodes.push({
      role: String(match[1] || 'generic')
        .trim()
        .toLowerCase(),
      name: String(match[2] || '')
        .replace(/\\"/g, '"')
        .trim(),
      ref: String(match[3] || '').trim(),
      depth: Math.max(0, Math.floor(indent / 2)),
      href: hrefMatch ? String(hrefMatch[1] || '').trim() : null,
    });
    if (nodes.length >= 300) break;
  }
  return nodes;
}

function findDescendantLabel(nodes: SnapshotNode[], index: number): string {
  const node = nodes[index];
  let bestLabel = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const candidate = nodes[cursor];
    if (candidate.depth <= node.depth) break;
    if (!candidate.name) continue;
    if (INTERACTIVE_ROLES.has(candidate.role)) continue;
    let score = 0;
    if (COMPACT_ACTION_KEYWORDS.test(candidate.name)) score += 24;
    if (
      /show|open|view|go to|filter|search|summary|jobs?|artifacts?|logs?|workflow/i.test(
        candidate.name,
      )
    )
      score += 18;
    if (candidate.name.length >= 8) score += 6;
    if (candidate.name.length >= 40) score -= 12;
    if (COMPACT_STATUS_LABEL_PATTERNS.test(candidate.name)) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      bestLabel = candidate.name;
    }
  }
  return bestLabel;
}

function scoreCompactInteractiveNode(
  node: SnapshotNode,
  index: number,
  context: CompactScoringContext,
): number {
  const role = String(node.role || '').toLowerCase();
  const name = String(node.name || '').trim();
  const normalizedName = name.toLowerCase();
  const isRunDetail = COMPACT_RUN_DETAIL_PATTERNS.test(name);
  let score = 0;

  score += COMPACT_ROLE_PRIORITY.get(role) ?? 24;
  score += name ? 90 : -120;

  if (name.length >= 4) score += 8;
  if (name.length >= 12) score += 6;
  if (name.length >= 48) score -= 28;
  if (name.length >= 80) score -= 44;
  if (COMPACT_ACTION_KEYWORDS.test(name)) score += 28;
  if (isRunDetail) score += 56;
  if (COMPACT_SHELL_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) score -= 80;
  if (context.workflowRunDetail) {
    score += scoreWorkflowRunDetailNode(node);
  }

  // Keep nearby content slightly preferred without letting early chrome dominate compact mode.
  score -= Math.floor(index / 12);
  return score;
}

function toInteractiveElement(node: SnapshotNode): SnapshotInteractiveElement {
  const element: SnapshotInteractiveElement = {
    ref: node.ref,
    role: node.role || 'generic',
    name: node.name || '',
  };
  const href = typeof node.href === 'string' ? node.href.trim() : '';
  if (href) element.href = href;
  return element;
}

function prioritizeCompactNodes(
  nodes: SnapshotNode[],
  limit: number,
  context: CompactScoringContext = DEFAULT_COMPACT_SCORING_CONTEXT,
): SnapshotInteractiveElement[] {
  return nodes
    .filter((node) => node.ref)
    .map((node, index) => ({
      node,
      index,
      score: scoreCompactInteractiveNode(node, index, context),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ node }) => toInteractiveElement(node));
}

export function buildInteractiveElements(
  pageContent: string,
  fallbackElements: any[],
  limit: number,
  mode: ReadPageMode,
  currentUrl: string,
): SnapshotInteractiveElement[] {
  const scoringContext: CompactScoringContext = {
    workflowRunDetail: isGithubWorkflowRunDetailUrl(currentUrl),
  };
  const nodes = parseSnapshotNodesFromPageContent(pageContent);
  const parsedInteractive = nodes
    .filter((node) => INTERACTIVE_ROLES.has(node.role))
    .map((node) => {
      const nodeIndex = nodes.findIndex((candidate) => candidate.ref === node.ref);
      const descendantLabel = nodeIndex >= 0 ? findDescendantLabel(nodes, nodeIndex) : '';
      const hrefLabel = scoringContext.workflowRunDetail
        ? inferWorkflowRunDetailLabelFromHref(node.href || '')
        : '';
      return {
        ...node,
        name: node.name || descendantLabel || hrefLabel,
      };
    });
  const source = parsedInteractive.length > 0 ? parsedInteractive : nodes;
  const fromSnapshot =
    mode === 'compact'
      ? prioritizeCompactNodes(source, limit, scoringContext)
      : source
          .filter((node) => node.ref)
          .slice(0, limit)
          .map((node) => toInteractiveElement(node));

  if (fromSnapshot.length > 0) return fromSnapshot;

  const fromFallback = Array.isArray(fallbackElements) ? fallbackElements : [];
  const fallbackNodes: SnapshotNode[] = fromFallback.map((item: any, index: number) => ({
    ref: String(item?.ref || item?.selector || `fallback_${index + 1}`),
    role: String(item?.type || 'generic').toLowerCase(),
    name: String(item?.text || '').trim(),
    depth: 0,
    href: typeof item?.href === 'string' ? item.href : null,
  }));
  if (mode === 'compact') {
    return prioritizeCompactNodes(fallbackNodes, limit, scoringContext);
  }
  return fallbackNodes.slice(0, limit).map((node) => toInteractiveElement(node));
}
