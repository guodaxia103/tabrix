import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MODES = ['compact', 'normal', 'full'];

export function estimateTokensFromBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 0;
  }
  return Math.ceil(bytes / 4);
}

export function payloadSizeBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

export function validateStableSnapshotContract(snapshot, expectedMode) {
  const failures = [];
  if (!snapshot || typeof snapshot !== 'object') {
    failures.push('snapshot must be an object');
    return { passed: false, failures };
  }

  if (snapshot.mode !== expectedMode) {
    failures.push(`mode mismatch: expected ${expectedMode}, got ${String(snapshot.mode)}`);
  }

  const page = snapshot.page;
  if (!page || typeof page !== 'object') {
    failures.push('page must exist');
  } else {
    if (typeof page.url !== 'string' || !page.url) failures.push('page.url must be a non-empty string');
    if (typeof page.title !== 'string') failures.push('page.title must be a string');
    if (typeof page.pageType !== 'string' || !page.pageType) {
      failures.push('page.pageType must be a non-empty string');
    }
  }

  const summary = snapshot.summary;
  if (!summary || typeof summary !== 'object') {
    failures.push('summary must exist');
  }

  if (!Array.isArray(snapshot.interactiveElements)) {
    failures.push('interactiveElements must be an array');
  }

  if (!Array.isArray(snapshot.artifactRefs)) {
    failures.push('artifactRefs must be an array');
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

export function summarizeInteractiveElements(snapshot, limit = 8) {
  const elements = Array.isArray(snapshot?.interactiveElements) ? snapshot.interactiveElements : [];
  const names = [];
  for (const element of elements) {
    const label = String(element?.name ?? element?.role ?? '').trim();
    if (!label) continue;
    names.push(label);
    if (names.length >= limit) break;
  }
  return names;
}

export function parseTabrixJsonOutput(rawStdout) {
  const text = String(rawStdout ?? '').trim();
  if (!text) {
    throw new Error('tabrix command returned empty stdout');
  }

  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error(`failed to parse tabrix json output: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  }
}

export function parseCliArgs(argv) {
  const options = {
    owner: 'microsoft',
    repo: 'TypeScript',
    outDir: path.join('.tmp', 't4-github-baseline'),
    strict: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--owner') {
      options.owner = argv[index + 1] ?? options.owner;
      index += 1;
    } else if (part === '--repo') {
      options.repo = argv[index + 1] ?? options.repo;
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
    `tabrix-t4-call-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
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

function buildScenarioDefinitions(baseUrl) {
  return [
    {
      scenarioId: 'GH-L1-001',
      pageType: 'repo_home',
      url: baseUrl,
      semanticExpectation: /issues|pull requests|actions|go to file|watch|star|main branch|commits/i,
    },
    {
      scenarioId: 'GH-L2-001',
      pageType: 'issues_list',
      url: `${baseUrl}/issues`,
      semanticExpectation: /issue|new issue|label|milestone/i,
    },
    {
      scenarioId: 'GH-L2-002',
      pageType: 'actions_list',
      url: `${baseUrl}/actions`,
      semanticExpectation: /workflow|run|summary|jobs|details/i,
    },
    {
      scenarioId: 'GH-L2-003',
      pageType: 'workflow_run_detail',
      url: null,
      semanticExpectation: /summary|show all jobs|jobs/i,
    },
  ];
}

export function normalizeWorkflowRunUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+/i.test(text)) {
    return text;
  }
  if (/^\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+/i.test(text)) {
    return `https://github.com${text}`;
  }
  return null;
}

function extractRunDetailUrlFromActions(timeoutMs, tabId) {
  const runLinkResult = callTool(
    'chrome_javascript',
    {
      code: `
        const anchors = Array.from(document.querySelectorAll('a[href*="/actions/runs/"]'));
        const pick = anchors.find((item) => /\\/actions\\/runs\\/\\d+/.test(item.getAttribute('href') || ''));
        return pick ? pick.href : '';
      `,
      timeoutMs: Math.min(timeoutMs, 20_000),
      tabId,
    },
    timeoutMs,
  );

  return normalizeWorkflowRunUrl(runLinkResult?.parsed?.result ?? '');
}

function clickFirstWorkflowRun(timeoutMs, tabId) {
  const compact = callTool(
    'chrome_read_page',
    {
      mode: 'compact',
      filter: 'interactive',
      depth: 3,
      ...(typeof tabId === 'number' ? { tabId } : {}),
    },
    timeoutMs,
  );

  const interactiveElements = Array.isArray(compact?.parsed?.interactiveElements)
    ? compact.parsed.interactiveElements
    : [];
  const target =
    interactiveElements.find((item) => {
      const name = String(item?.name ?? '');
      const role = String(item?.role ?? '');
      return /link|button/i.test(role) && /run\s+\d+/i.test(name);
    }) ??
    interactiveElements.find((item) => {
      const name = String(item?.name ?? '');
      const role = String(item?.role ?? '');
      return /link|button/i.test(role) && /completed successfully/i.test(name);
    });

  if (!target?.ref) {
    return {
      clicked: false,
      reason: 'no workflow run ref found in compact snapshot',
      compactSnapshot: compact.parsed,
    };
  }

  const clickResult = callTool(
    'chrome_click_element',
    {
      ref: target.ref,
      ...(typeof tabId === 'number' ? { tabId } : {}),
    },
    timeoutMs,
  );

  return {
    clicked: true,
    targetRef: target.ref,
    targetName: String(target.name ?? ''),
    targetHref: normalizeWorkflowRunUrl(clickResult?.parsed?.elementInfo?.href ?? ''),
    compactSnapshot: compact.parsed,
    clickResult,
  };
}

export function evaluateSemanticSignal(snapshot, semanticExpectation) {
  const names = summarizeInteractiveElements(snapshot, 16);
  const candidateActions = Array.isArray(snapshot?.candidateActions) ? snapshot.candidateActions : [];
  const actionReasons = candidateActions
    .map((item) => String(item?.matchReason ?? item?.actionType ?? ''))
    .filter(Boolean)
    .slice(0, 12);
  const highValueLabels = Array.isArray(snapshot?.highValueObjects)
    ? snapshot.highValueObjects
        .map((item) => String(item?.label ?? ''))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const l0Summary = String(snapshot?.L0?.summary ?? '');
  const gateText = `${names.join(' | ')} | ${actionReasons.join(' | ')}`;
  return {
    matched: semanticExpectation.test(gateText),
    interactiveHead: names,
    actionHead: actionReasons,
    highValueHead: highValueLabels,
    l0Summary,
  };
}

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function timestampForPath() {
  return new Date().toISOString().replaceAll(':', '-');
}

async function runScenario(definition, options, evidenceDir, tabId, runOptions = {}) {
  const scenarioStartedAt = Date.now();
  let activeTabId = tabId;
  let navigateResult = null;
  if (!runOptions.skipNavigate) {
    const navigateArgs = {
      url: definition.url,
      ...(runOptions.forceNewWindow ? { newWindow: true } : {}),
      ...(!runOptions.forceNewWindow && typeof tabId === 'number' ? { tabId } : {}),
    };
    navigateResult = callTool(
      'chrome_navigate',
      navigateArgs,
      options.timeoutMs,
    );
    if (typeof navigateResult?.parsed?.tabId === 'number') {
      activeTabId = navigateResult.parsed.tabId;
    }
  }

  const modeResults = [];
  const allArtifacts = [];
  let semantic = { matched: false, interactiveHead: [], actionHead: [] };

  for (const mode of DEFAULT_MODES) {
    const startedAt = Date.now();
    const readOutput = callTool(
      'chrome_read_page',
      {
        mode,
        filter: 'interactive',
        depth: 3,
        ...(typeof activeTabId === 'number' ? { tabId: activeTabId } : {}),
      },
      options.timeoutMs,
    );
    const elapsedMs = Date.now() - startedAt;
    const snapshot = readOutput.parsed;
    const contractCheck = validateStableSnapshotContract(snapshot, mode);
    const bytes = payloadSizeBytes(snapshot);
    const artifacts = collectArtifactRefs(snapshot);
    allArtifacts.push(...artifacts);
    if (mode === 'compact') {
      semantic = evaluateSemanticSignal(snapshot, definition.semanticExpectation);
    }

    modeResults.push({
      mode,
      passed: contractCheck.passed,
      failures: contractCheck.failures,
      durationMs: elapsedMs,
      payloadBytes: bytes,
      tokenEstimate: estimateTokensFromBytes(bytes),
      interactiveCount: Array.isArray(snapshot?.interactiveElements)
        ? snapshot.interactiveElements.length
        : 0,
      candidateActionCount: Array.isArray(snapshot?.candidateActions) ? snapshot.candidateActions.length : 0,
      artifactRefCount: artifacts.length,
      snapshot,
      toolResponse: readOutput,
    });
  }

  const passedModeCount = modeResults.filter((item) => item.passed).length;
  const semanticPassed = semantic.matched;
  const checkTotal = modeResults.length + 1;
  const checkPassed = passedModeCount + (semanticPassed ? 1 : 0);
  const scenarioPassed = checkPassed === checkTotal;
  const durationMs = Date.now() - scenarioStartedAt;
  const payloadBytes = modeResults.reduce((total, item) => total + item.payloadBytes, 0);
  const tokenEstimate = modeResults.reduce((total, item) => total + item.tokenEstimate, 0);
  const artifactRefs = uniqueArtifacts(allArtifacts);

  const evidence = {
    scenarioId: definition.scenarioId,
    pageType: definition.pageType,
    url: definition.url,
    navigateResult,
    activeTabId,
    semantic,
    preAction: runOptions.preAction ?? null,
    modeResults,
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
    keyResultSummary:
      semantic.l0Summary ||
      `compact interactive head: ${semantic.interactiveHead.join(' | ') || '(none)'}`,
    evidenceRef: evidenceFile.replaceAll('\\', '/'),
    artifactRefs,
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
    semanticSignal: {
      passed: semanticPassed,
      interactiveHead: semantic.interactiveHead,
      actionHead: semantic.actionHead,
      highValueHead: semantic.highValueHead,
      l0Summary: semantic.l0Summary,
    },
  };
}

export async function runGithubBaseline(options) {
  const baseUrl = `https://github.com/${options.owner}/${options.repo}`;
  const runDir = path.resolve(options.outDir, `${options.owner}-${options.repo}-${timestampForPath()}`);
  const evidenceDir = path.join(runDir, 'evidence');
  ensureDir(evidenceDir);

  const definitions = buildScenarioDefinitions(baseUrl);
  const results = [];
  let workingTabId = null;

  const bootstrap = callTool(
    'chrome_navigate',
    {
      url: baseUrl,
      newWindow: true,
    },
    options.timeoutMs,
  );
  if (typeof bootstrap?.parsed?.tabId === 'number') {
    workingTabId = bootstrap.parsed.tabId;
  }

  let workflowRunDetailUrl = null;
  for (const definition of definitions) {
    const scenarioDef = { ...definition };
    const runOptions = {};
    if (scenarioDef.pageType === 'workflow_run_detail') {
      const clickResult = clickFirstWorkflowRun(options.timeoutMs, workingTabId);
      runOptions.preAction = clickResult;

      if (!workflowRunDetailUrl && clickResult.targetHref) {
        workflowRunDetailUrl = clickResult.targetHref;
      }
      if (!workflowRunDetailUrl) {
        workflowRunDetailUrl = extractRunDetailUrlFromActions(options.timeoutMs, workingTabId);
      }
      scenarioDef.url = workflowRunDetailUrl || `${baseUrl}/actions`;
      if (workflowRunDetailUrl) {
        runOptions.forceNewWindow = true;
      }
    }

    const result = await runScenario(scenarioDef, options, evidenceDir, workingTabId, runOptions);
    results.push(result);

    if (scenarioDef.pageType === 'actions_list' && !workflowRunDetailUrl) {
      workflowRunDetailUrl = extractRunDetailUrlFromActions(options.timeoutMs, workingTabId);
    }
  }

  const totalDurationMs = results.reduce((sum, item) => sum + item.durationMs, 0);
  const totalTokens = results.reduce((sum, item) => sum + item.tokenEstimate, 0);
  const totalBytes = results.reduce((sum, item) => sum + item.payloadBytes, 0);
  const passedCount = results.filter((item) => item.passed).length;
  const suiteSummary = {
    suiteId: 'T4-GH-PUBLIC-BASELINE',
    generatedAt: new Date().toISOString(),
    repository: `${options.owner}/${options.repo}`,
    scenarioCount: results.length,
    passedCount,
    successRate: Number((passedCount / Math.max(results.length, 1)).toFixed(3)),
    durationMs: totalDurationMs,
    tokenEstimate: totalTokens,
    payloadBytes: totalBytes,
    blocked: passedCount !== results.length,
    scenarios: results,
  };

  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(suiteSummary, null, 2), 'utf8');

  return {
    runDir,
    summaryFile,
    summary: suiteSummary,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await runGithubBaseline(options);
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  process.stdout.write(`\nsummary file: ${result.summaryFile.replaceAll('\\', '/')}\n`);

  if (options.strict && result.summary.blocked) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[t4-github-baseline] ${message}\n`);
    process.exit(1);
  });
}
