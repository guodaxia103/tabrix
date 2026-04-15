import { spawnSync } from 'node:child_process';

const HIGH_SEVERITY_LEVELS = new Set(['HIGH', 'CRITICAL']);
const PNPM_LIST_ARGS = ['list', '-r', '--prod', '--json', '--depth', 'Infinity'];
const QUERY_BATCH_SIZE = 100;

function getPnpmRunner() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: [],
  };
}

function run(command, args, extraArgs = []) {
  const result = spawnSync(command, [...extraArgs, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `${command} ${[...extraArgs, ...args].join(' ')} exited with code ${result.status}${stderr ? `\n${stderr}` : stdout ? `\n${stdout}` : ''}`,
    );
  }

  return result.stdout;
}

function isExternalVersion(version) {
  return (
    typeof version === 'string' &&
    version.length > 0 &&
    !version.startsWith('link:') &&
    !version.startsWith('file:') &&
    !version.startsWith('workspace:')
  );
}

function collectPackageQueries(listOutput) {
  const tree = JSON.parse(listOutput);
  const packages = new Map();

  function visitDependencies(dependencies) {
    if (!dependencies) return;

    for (const [name, meta] of Object.entries(dependencies)) {
      if (!meta || typeof meta !== 'object') continue;
      if (isExternalVersion(meta.version)) {
        packages.set(`${name}@${meta.version}`, {
          package: { name, ecosystem: 'npm' },
          version: meta.version,
        });
      }
      visitDependencies(meta.dependencies);
    }
  }

  for (const item of tree) {
    visitDependencies(item.dependencies);
  }

  return Array.from(packages.values());
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }

  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url} failed with ${response.status}: ${text}`);
  }
  return response.json();
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function queryPackageVulns(packages) {
  const packageToVulnIds = new Map();
  const vulnIds = new Set();

  for (const batch of chunk(packages, QUERY_BATCH_SIZE)) {
    const payload = await postJson('https://api.osv.dev/v1/querybatch', {
      queries: batch,
    });

    for (const [index, result] of payload.results.entries()) {
      const pkg = batch[index];
      const key = `${pkg.package.name}@${pkg.version}`;
      const ids = (result.vulns ?? []).map((vuln) => vuln.id).filter(Boolean);
      if (ids.length === 0) continue;
      packageToVulnIds.set(key, ids);
      for (const id of ids) vulnIds.add(id);
    }
  }

  return { packageToVulnIds, vulnIds: Array.from(vulnIds) };
}

function parseSeverity(detail) {
  const value = detail?.database_specific?.severity;
  return typeof value === 'string' ? value.toUpperCase() : 'UNKNOWN';
}

async function fetchVulnDetails(vulnIds) {
  const details = new Map();
  for (const id of vulnIds) {
    const detail = await getJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
    details.set(id, detail);
  }
  return details;
}

function buildHighSeverityFindings(packageToVulnIds, vulnDetails) {
  const findings = [];

  for (const [pkg, ids] of packageToVulnIds.entries()) {
    const matched = ids
      .map((id) => vulnDetails.get(id))
      .filter(Boolean)
      .map((detail) => ({
        id: detail.id,
        severity: parseSeverity(detail),
        summary: detail.summary || detail.details?.split('\n')[0] || '(no summary)',
      }))
      .filter((detail) => HIGH_SEVERITY_LEVELS.has(detail.severity));

    if (matched.length > 0) {
      findings.push({ packageName: pkg, vulns: matched });
    }
  }

  findings.sort((left, right) => left.packageName.localeCompare(right.packageName));
  return findings;
}

async function main() {
  console.log('tabrix audit: collecting production dependency graph...');
  const pnpmRunner = getPnpmRunner();
  const listOutput = run(pnpmRunner.command, PNPM_LIST_ARGS, pnpmRunner.args);
  const packages = collectPackageQueries(listOutput);

  console.log(`tabrix audit: querying OSV for ${packages.length} production packages...`);
  const { packageToVulnIds, vulnIds } = await queryPackageVulns(packages);

  if (vulnIds.length === 0) {
    console.log('tabrix audit: no known vulnerabilities found for production dependencies.');
    return;
  }

  console.log(`tabrix audit: fetching details for ${vulnIds.length} advisories...`);
  const vulnDetails = await fetchVulnDetails(vulnIds);
  const highSeverityFindings = buildHighSeverityFindings(packageToVulnIds, vulnDetails);

  if (highSeverityFindings.length === 0) {
    console.log(
      `tabrix audit: advisories found (${vulnIds.length}), but none are HIGH/CRITICAL in production dependencies.`,
    );
    return;
  }

  console.error('tabrix audit: HIGH/CRITICAL production vulnerabilities detected:');
  for (const finding of highSeverityFindings) {
    console.error(`- ${finding.packageName}`);
    for (const vuln of finding.vulns) {
      console.error(`  - [${vuln.severity}] ${vuln.id}: ${vuln.summary}`);
    }
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`tabrix audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
