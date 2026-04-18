import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const GITHUB_API_BASE = 'https://api.github.com';

const NON_BLOCKING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const ENVIRONMENT_CONCLUSIONS = new Set(['cancelled', 'timed_out', 'startup_failure']);

export function parseRepositoryFromGitRemote(remoteUrl) {
  const raw = String(remoteUrl ?? '').trim();
  if (!raw) return null;

  const httpsMatch = raw.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

export function isBlockingStatus(status, conclusion) {
  if (status !== 'completed') return true;
  return !NON_BLOCKING_CONCLUSIONS.has(String(conclusion ?? '').toLowerCase());
}

export function classifyExceptionCategory(name, conclusion) {
  const lowerName = String(name ?? '').toLowerCase();
  const lowerConclusion = String(conclusion ?? '').toLowerCase();

  if (ENVIRONMENT_CONCLUSIONS.has(lowerConclusion)) {
    return 'environment';
  }

  if (/(smoke|acceptance|baseline|e2e|real)/.test(lowerName)) {
    return 'product';
  }

  if (/(quality|typecheck|build|test|lint|docs|i18n|audit|security|release)/.test(lowerName)) {
    return 'quality';
  }

  return 'quality';
}

export function parseRunIdFromDetailsUrl(url) {
  const text = String(url ?? '');
  const match = text.match(/\/actions\/runs\/(\d+)/i);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

export function parseCliArgs(argv) {
  const options = {
    owner: '',
    repo: '',
    commit: '',
    outFile: '',
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
    strict: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--owner') {
      options.owner = argv[index + 1] ?? '';
      index += 1;
    } else if (part === '--repo') {
      options.repo = argv[index + 1] ?? '';
      index += 1;
    } else if (part === '--commit') {
      options.commit = argv[index + 1] ?? '';
      index += 1;
    } else if (part === '--out-file') {
      options.outFile = argv[index + 1] ?? '';
      index += 1;
    } else if (part === '--token') {
      options.token = argv[index + 1] ?? '';
      index += 1;
    } else if (part === '--non-strict') {
      options.strict = false;
    }
  }

  return options;
}

function shell(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout ?? '').trim();
}

function resolveRepoAndCommit(options) {
  const resolved = { ...options };
  if (!resolved.commit) {
    resolved.commit = shell('git', ['rev-parse', 'HEAD']);
  }

  if (!resolved.owner || !resolved.repo) {
    const remoteUrl = shell('git', ['config', '--get', 'remote.origin.url']);
    const parsed = parseRepositoryFromGitRemote(remoteUrl);
    if (parsed) {
      resolved.owner = resolved.owner || parsed.owner;
      resolved.repo = resolved.repo || parsed.repo;
    }
  }

  if (!resolved.owner || !resolved.repo || !resolved.commit) {
    throw new Error('owner/repo/commit could not be resolved');
  }

  if (!resolved.outFile) {
    const dir = path.join('.tmp', 't4-post-submit');
    resolved.outFile = path.join(dir, `${resolved.commit}.json`);
  }
  return resolved;
}

async function fetchGitHubJson(endpoint, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tabrix-t4-post-submit-tracker',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${endpoint} failed: ${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
  }
  return response.json();
}

function summarizeWorkflowJobs(run, jobsPayload) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  return jobs.map((job) => {
    const failedStep = Array.isArray(job.steps)
      ? job.steps.find((step) => step.conclusion && step.conclusion !== 'success')
      : null;
    return {
      jobName: job.name,
      status: job.status,
      conclusion: job.conclusion,
      detailsUrl: job.html_url,
      failedStep: failedStep ? failedStep.name : null,
    };
  });
}

function nextActionForCategory(category) {
  if (category === 'environment') {
    return 'Re-run the failed workflow once and confirm runner/network health before code changes.';
  }
  if (category === 'product') {
    return 'Reproduce in real-browser T4 scenario and inspect snapshot quality or action ranking regressions.';
  }
  return 'Reproduce locally with the same gate command, fix root cause, then re-run checks.';
}

export async function collectPostSubmitTracking(options) {
  const resolved = resolveRepoAndCommit(options);
  const { owner, repo, commit, token } = resolved;

  const checkRunsPayload = await fetchGitHubJson(
    `/repos/${owner}/${repo}/commits/${commit}/check-runs?per_page=100`,
    token,
  );
  const workflowRunsPayload = await fetchGitHubJson(
    `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(commit)}&per_page=20`,
    token,
  );

  const workflowRuns = Array.isArray(workflowRunsPayload?.workflow_runs)
    ? workflowRunsPayload.workflow_runs
    : [];

  const workflowJobsMap = new Map();
  for (const run of workflowRuns) {
    try {
      const jobsPayload = await fetchGitHubJson(
        `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
        token,
      );
      workflowJobsMap.set(run.id, summarizeWorkflowJobs(run, jobsPayload));
    } catch {
      workflowJobsMap.set(run.id, []);
    }
  }

  const checkRuns = Array.isArray(checkRunsPayload?.check_runs) ? checkRunsPayload.check_runs : [];
  const checks = checkRuns.map((item) => {
    const runId = parseRunIdFromDetailsUrl(item.details_url);
    const jobs = runId ? workflowJobsMap.get(runId) ?? [] : [];
    const failedJob = jobs.find((job) => job.conclusion && job.conclusion !== 'success');
    const blocking = isBlockingStatus(item.status, item.conclusion);
    const category = blocking ? classifyExceptionCategory(item.name, item.conclusion) : null;

    return {
      name: item.name,
      status: item.status,
      conclusion: item.conclusion,
      startedAt: item.started_at,
      completedAt: item.completed_at,
      detailsUrl: item.details_url,
      workflowRunId: runId,
      failedJob: failedJob
        ? {
            name: failedJob.jobName,
            failedStep: failedJob.failedStep,
            detailsUrl: failedJob.detailsUrl,
          }
        : null,
      blocking,
      exceptionCategory: category,
    };
  });

  const exceptions = checks
    .filter((item) => item.blocking)
    .map((item) => ({
      checkName: item.name,
      status: item.status,
      conclusion: item.conclusion,
      category: item.exceptionCategory ?? classifyExceptionCategory(item.name, item.conclusion),
      blocking: true,
      failedJob: item.failedJob,
      nextAction: nextActionForCategory(
        item.exceptionCategory ?? classifyExceptionCategory(item.name, item.conclusion),
      ),
    }));

  const tracking = {
    generatedAt: new Date().toISOString(),
    repository: `${owner}/${repo}`,
    commitSha: commit,
    checks,
    workflowRuns: workflowRuns.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      jobs: workflowJobsMap.get(run.id) ?? [],
    })),
    summary: {
      checkCount: checks.length,
      blockingCount: exceptions.length,
      blocked: exceptions.length > 0,
      exceptionBreakdown: exceptions.reduce(
        (acc, item) => {
          acc[item.category] = (acc[item.category] ?? 0) + 1;
          return acc;
        },
        { environment: 0, quality: 0, product: 0 },
      ),
    },
    exceptions,
  };

  const outFile = path.resolve(resolved.outFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(tracking, null, 2), 'utf8');

  return {
    outFile,
    tracking,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await collectPostSubmitTracking(options);
  process.stdout.write(`${JSON.stringify(result.tracking, null, 2)}\n`);
  process.stdout.write(`\ntracking file: ${result.outFile.replaceAll('\\', '/')}\n`);
  if (options.strict && result.tracking.summary.blocked) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[t4-post-submit-tracker] ${message}\n`);
    process.exit(1);
  });
}
