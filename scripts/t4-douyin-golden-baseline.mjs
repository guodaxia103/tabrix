import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  estimateTokensFromBytes,
  payloadSizeBytes,
  parseTabrixJsonOutput,
  summarizeInteractiveElements,
  validateStableSnapshotContract,
} from './t4-github-baseline.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MODES = ['compact', 'normal', 'full'];
const DEFAULT_HOTSPOT_URL =
  process.env.TABRIX_DY_HOTSPOT_URL ||
  'https://creator.douyin.com/creator-micro/data/hotspot?active_tab=hotspot_topic';
const DEFAULT_CREATOR_URL =
  process.env.TABRIX_DY_CREATOR_URL || 'https://creator.douyin.com/creator-micro/home';

const HIGH_RISK_TOOL_NAMES = new Set([
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_computer',
  'chrome_javascript',
  'chrome_keyboard',
  'chrome_upload_file',
]);

const HOTSPOT_METRIC_LABELS = [
  '话题名称',
  '热度趋势',
  '热度值',
  '视频量',
  '播放量',
  '稿均播放量',
  '发布视频',
  '查看',
  '视频总榜',
  '话题榜',
];

const CREATOR_METRIC_LABELS = ['账号总览', '播放量', '互动指数', '视频完播率', '近30天未发布新作品'];

function sleepSync(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return;
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(lock, 0, 0, duration);
}

function isRetriableToolError(message) {
  const text = String(message ?? '');
  return /tabs cannot be edited right now|navigation is in progress|no tab with id|temporarily unavailable/i.test(
    text,
  );
}

function callToolOnce(toolName, args, timeoutMs) {
  const argsFile = path.join(
    os.tmpdir(),
    `tabrix-t4-dy-call-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  fs.writeFileSync(argsFile, JSON.stringify(args ?? {}), 'utf8');

  const command = [
    'tabrix',
    'mcp',
    'call',
    toolName,
    '--args-file',
    `"${argsFile}"`,
    '--json',
    '--timeout',
    String(timeoutMs),
  ].join(' ');

  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  try {
    if (result.error) {
      throw new Error(`failed to run tabrix CLI: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      throw new Error(`tabrix ${toolName} failed (exit ${result.status}): ${detail}`);
    }
  } finally {
    try {
      fs.unlinkSync(argsFile);
    } catch {
      // ignore temp cleanup failures
    }
  }

  const parsedOutput = parseTabrixJsonOutput(result.stdout);
  if (parsedOutput?.raw?.isError) {
    throw new Error(`${toolName} returned tool error: ${JSON.stringify(parsedOutput.parsed ?? parsedOutput.raw)}`);
  }

  return parsedOutput;
}

function callTool(toolName, args, timeoutMs, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 2;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 500;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return callToolOnce(toolName, args, timeoutMs);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const canRetry = attempt < retries && isRetriableToolError(message);
      if (!canRetry) {
        throw error;
      }
      sleepSync(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown tool call error'));
}

function collectArtifactRefs(snapshot) {
  const artifactRefs = Array.isArray(snapshot?.artifactRefs) ? snapshot.artifactRefs : [];
  return artifactRefs
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      kind: String(item.kind ?? ''),
      ref: String(item.ref ?? ''),
    }))
    .filter((item) => item.kind && item.ref);
}

function uniqueArtifacts(artifactRefs) {
  const seen = new Set();
  const deduped = [];
  for (const item of artifactRefs) {
    const key = `${item.kind}::${item.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function timestampForPath() {
  return new Date().toISOString().replaceAll(':', '-');
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

export function parseCliArgs(argv) {
  const options = {
    hotspotUrl: DEFAULT_HOTSPOT_URL,
    creatorUrl: DEFAULT_CREATOR_URL,
    outDir: path.join('.tmp', 't4-douyin-golden'),
    strict: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--hotspot-url') {
      options.hotspotUrl = argv[index + 1] ?? options.hotspotUrl;
      index += 1;
    } else if (part === '--creator-url') {
      options.creatorUrl = argv[index + 1] ?? options.creatorUrl;
      index += 1;
    } else if (part === '--out-dir') {
      options.outDir = argv[index + 1] ?? options.outDir;
      index += 1;
    } else if (part === '--timeout-ms') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.timeoutMs = parsed;
      }
      index += 1;
    } else if (part === '--non-strict') {
      options.strict = false;
    }
  }

  return options;
}

export function buildDyScenarioDefinitions(options) {
  return [
    {
      scenarioId: 'DY-L4-001',
      pageType: 'douyin_hotspot',
      startUrl: options.hotspotUrl,
      allowedActions: ['chrome_navigate', 'chrome_read_page'],
      outputTargets: ['pageRole', 'primaryRegion', 'hotspotMetricLabels', 'taskEntryHead'],
    },
    {
      scenarioId: 'DY-L4-002',
      pageType: 'douyin_creator_overview',
      startUrl: options.creatorUrl,
      allowedActions: ['chrome_navigate', 'chrome_read_page'],
      outputTargets: ['pageRole', 'primaryRegion', 'creatorMetricLabels', 'taskEntryHead'],
    },
  ];
}

function gatherSnapshotContext(modeResults) {
  const snapshotByMode = new Map();
  const interactiveNames = [];
  const pageContents = [];
  for (const result of modeResults) {
    snapshotByMode.set(result.mode, result.snapshot);
    const snapshotNames = summarizeInteractiveElements(result.snapshot, 32);
    interactiveNames.push(...snapshotNames);
    if (typeof result.snapshot?.fullSnapshot?.pageContent === 'string') {
      pageContents.push(result.snapshot.fullSnapshot.pageContent);
    }
  }
  const normalSnapshot = snapshotByMode.get('normal') || snapshotByMode.get('compact') || null;
  const compactSnapshot = snapshotByMode.get('compact') || normalSnapshot;
  const textCorpus = [
    JSON.stringify(normalSnapshot?.summary ?? {}),
    interactiveNames.join(' | '),
    pageContents.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
  return { compactSnapshot, normalSnapshot, textCorpus, interactiveNames };
}

function pickMatchedLabels(text, labels) {
  const source = String(text || '');
  const matched = [];
  for (const label of labels) {
    if (source.includes(label)) matched.push(label);
  }
  return matched;
}

function detectLoginRequired(text, normalSnapshot) {
  const role = String(normalSnapshot?.summary?.pageRole ?? '').trim();
  if (role === 'login_required') return true;
  return /手机号|验证码|登录|登录后继续/.test(String(text || ''));
}

export function evaluateDyScenario(definition, modeResults, toolsUsed) {
  const { compactSnapshot, normalSnapshot, textCorpus, interactiveNames } =
    gatherSnapshotContext(modeResults);

  const loginRequired = detectLoginRequired(textCorpus, normalSnapshot);
  const pageRole = String(normalSnapshot?.summary?.pageRole ?? 'unknown');
  const primaryRegion = String(normalSnapshot?.summary?.primaryRegion ?? '');
  const taskEntryHead = interactiveNames
    .filter((name) => /热度|热点|话题|视频|查看|发布|账号|概览|播放量|互动|完播|趋势/.test(name))
    .slice(0, 12);

  const highRiskActionsUsed = toolsUsed.some((toolName) => HIGH_RISK_TOOL_NAMES.has(toolName));
  const readOnlyBoundaryPassed = !highRiskActionsUsed;

  let businessPassed = false;
  let businessSignals = {};
  let businessFailures = [];

  if (definition.scenarioId === 'DY-L4-001') {
    const hotspotMetricLabels = pickMatchedLabels(textCorpus, HOTSPOT_METRIC_LABELS);
    const rolePassed = ['hotspot_topic_list', 'hotspot_rank_list', 'hotspot_detail'].includes(pageRole);
    const regionPassed = Boolean(primaryRegion);
    const metricPassed = hotspotMetricLabels.length >= 2;
    businessPassed = !loginRequired && rolePassed && regionPassed && metricPassed;
    businessSignals = {
      pageRole,
      primaryRegion: primaryRegion || null,
      hotspotMetricLabels,
      taskEntryHead,
      compactInteractiveHead: summarizeInteractiveElements(compactSnapshot, 12),
    };
    businessFailures = [
      !loginRequired ? null : 'login_required_detected',
      rolePassed ? null : `unexpected_page_role:${pageRole}`,
      regionPassed ? null : 'missing_primary_region',
      metricPassed ? null : 'insufficient_hotspot_metrics',
      readOnlyBoundaryPassed ? null : 'high_risk_action_detected',
    ].filter(Boolean);
  } else {
    const creatorMetricLabels = pickMatchedLabels(textCorpus, CREATOR_METRIC_LABELS);
    const rolePassed = ['creator_overview', 'creator_home'].includes(pageRole);
    const regionPassed = Boolean(primaryRegion);
    const metricPassed = creatorMetricLabels.length >= 2;
    businessPassed = !loginRequired && rolePassed && regionPassed && metricPassed;
    businessSignals = {
      pageRole,
      primaryRegion: primaryRegion || null,
      creatorMetricLabels,
      taskEntryHead,
      compactInteractiveHead: summarizeInteractiveElements(compactSnapshot, 12),
    };
    businessFailures = [
      !loginRequired ? null : 'login_required_detected',
      rolePassed ? null : `unexpected_page_role:${pageRole}`,
      regionPassed ? null : 'missing_primary_region',
      metricPassed ? null : 'insufficient_creator_metrics',
      readOnlyBoundaryPassed ? null : 'high_risk_action_detected',
    ].filter(Boolean);
  }

  return {
    passed: businessPassed && readOnlyBoundaryPassed,
    loginRequired,
    readOnlyBoundaryPassed,
    businessSignals,
    failures: businessFailures,
  };
}

async function runDyScenario(definition, options, evidenceDir, tabId, firstScenario = false) {
  const startedAt = Date.now();
  const toolsUsed = [];
  const navigateArgs = {
    url: definition.startUrl,
    ...(typeof tabId === 'number' ? { tabId } : {}),
    ...(firstScenario ? { newWindow: true } : {}),
  };
  const navigateResult = callTool('chrome_navigate', navigateArgs, options.timeoutMs);
  toolsUsed.push('chrome_navigate');

  let workingTabId = tabId;
  if (typeof navigateResult?.parsed?.tabId === 'number') {
    workingTabId = navigateResult.parsed.tabId;
  }

  const modeResults = [];
  const allArtifacts = [];
  for (const mode of DEFAULT_MODES) {
    const modeStartedAt = Date.now();
    const readOutput = callTool(
      'chrome_read_page',
      {
        mode,
        filter: 'interactive',
        depth: 3,
        ...(typeof workingTabId === 'number' ? { tabId: workingTabId } : {}),
      },
      options.timeoutMs,
    );
    toolsUsed.push('chrome_read_page');

    const elapsedMs = Date.now() - modeStartedAt;
    const snapshot = readOutput.parsed;
    const contractCheck = validateStableSnapshotContract(snapshot, mode);
    const payloadBytes = payloadSizeBytes(snapshot);
    const tokenEstimate = estimateTokensFromBytes(payloadBytes);
    const artifactRefs = collectArtifactRefs(snapshot);
    allArtifacts.push(...artifactRefs);

    modeResults.push({
      mode,
      passed: contractCheck.passed,
      failures: contractCheck.failures,
      durationMs: elapsedMs,
      payloadBytes,
      tokenEstimate,
      interactiveCount: Array.isArray(snapshot?.interactiveElements) ? snapshot.interactiveElements.length : 0,
      candidateActionCount: Array.isArray(snapshot?.candidateActions) ? snapshot.candidateActions.length : 0,
      artifactRefCount: artifactRefs.length,
      snapshot,
      toolResponse: readOutput,
    });
  }

  const business = evaluateDyScenario(definition, modeResults, toolsUsed);
  const passedModeCount = modeResults.filter((item) => item.passed).length;
  const checkTotal = modeResults.length + 1;
  const checkPassed = passedModeCount + (business.passed ? 1 : 0);
  const scenarioPassed = checkPassed === checkTotal;

  const durationMs = Date.now() - startedAt;
  const payloadBytes = modeResults.reduce((total, item) => total + item.payloadBytes, 0);
  const tokenEstimate = modeResults.reduce((total, item) => total + item.tokenEstimate, 0);

  const evidence = {
    scenarioId: definition.scenarioId,
    pageType: definition.pageType,
    input: {
      startUrl: definition.startUrl,
      allowedActions: definition.allowedActions,
      outputTargets: definition.outputTargets,
    },
    toolsUsed,
    navigateResult,
    modeResults,
    business,
  };

  const evidenceFile = path.join(evidenceDir, `${definition.scenarioId.toLowerCase()}.json`);
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2), 'utf8');

  return {
    scenarioId: definition.scenarioId,
    pageType: definition.pageType,
    passed: scenarioPassed,
    successRate: Number((checkPassed / checkTotal).toFixed(3)),
    durationMs,
    tokenEstimate,
    payloadBytes,
    keyResultSummary: JSON.stringify(business.businessSignals),
    keyIndicators: business.businessSignals,
    evidenceRef: evidenceFile.replaceAll('\\', '/'),
    artifactRefs: uniqueArtifacts(allArtifacts),
    modeMetrics: modeResults.map((item) => ({
      mode: item.mode,
      passed: item.passed,
      failures: item.failures,
      durationMs: item.durationMs,
      payloadBytes: item.payloadBytes,
      tokenEstimate: item.tokenEstimate,
      interactiveCount: item.interactiveCount,
      candidateActionCount: item.candidateActionCount,
      artifactRefCount: item.artifactRefCount,
    })),
    readOnlyBoundary: {
      passed: business.readOnlyBoundaryPassed,
      allowedActions: definition.allowedActions,
      toolsUsed,
    },
    loginState: {
      loginRequiredDetected: business.loginRequired,
    },
    failures: business.failures,
    tabId: typeof navigateResult?.parsed?.tabId === 'number' ? navigateResult.parsed.tabId : workingTabId,
  };
}

export async function runDouyinGoldenBaseline(options) {
  const runDir = path.resolve(options.outDir, `douyin-golden-${timestampForPath()}`);
  const evidenceDir = path.join(runDir, 'evidence');
  ensureDir(evidenceDir);

  const definitions = buildDyScenarioDefinitions(options);
  const results = [];
  let workingTabId = null;
  for (let index = 0; index < definitions.length; index += 1) {
    const scenarioResult = await runDyScenario(
      definitions[index],
      options,
      evidenceDir,
      workingTabId,
      index === 0,
    );
    results.push(scenarioResult);
    if (typeof scenarioResult.tabId === 'number') {
      workingTabId = scenarioResult.tabId;
    }
  }

  const passedCount = results.filter((item) => item.passed).length;
  const summary = {
    suiteId: 'T4-DY-LOGIN-GOLDEN',
    generatedAt: new Date().toISOString(),
    scenarioCount: results.length,
    passedCount,
    successRate: Number((passedCount / Math.max(results.length, 1)).toFixed(3)),
    durationMs: results.reduce((sum, item) => sum + item.durationMs, 0),
    tokenEstimate: results.reduce((sum, item) => sum + item.tokenEstimate, 0),
    payloadBytes: results.reduce((sum, item) => sum + item.payloadBytes, 0),
    blocked: passedCount !== results.length,
    releaseCandidateEligible: passedCount === results.length,
    scenarios: results.map(({ tabId, ...rest }) => rest),
  };

  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

  return {
    runDir,
    summaryFile,
    summary,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await runDouyinGoldenBaseline(options);
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  process.stdout.write(`\nsummary file: ${result.summaryFile.replaceAll('\\', '/')}\n`);
  if (options.strict && result.summary.blocked) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[t4-douyin-golden-baseline] ${message}\n`);
    process.exit(1);
  });
}
