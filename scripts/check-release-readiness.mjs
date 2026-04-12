import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function parseArgs(argv) {
  const options = {
    tag: process.env.RELEASE_TAG || '',
    allowMissingNotes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag' && argv[i + 1]) {
      options.tag = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--allow-missing-notes') {
      options.allowMissingNotes = true;
    }
  }

  return options;
}

function normalizeTagVersion(tag) {
  if (!tag) return '';
  if (tag.startsWith('tabrix-v')) return tag.slice('tabrix-v'.length);
  if (tag.startsWith('v')) return tag.slice(1);
  return null;
}

function appendGitHubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  fs.appendFileSync(outputFile, `${name}=${value}\n`, 'utf8');
}

function findWorkspaceProtocolDeps(dependencies = {}) {
  return Object.entries(dependencies)
    .filter(([, version]) => typeof version === 'string' && version.startsWith('workspace:'))
    .map(([name, version]) => `${name}@${version}`);
}

function fail(errors) {
  console.error('release readiness check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const options = parseArgs(process.argv.slice(2));

const rootPkg = readJson('package.json');
const nativePkg = readJson(path.join('app', 'native-server', 'package.json'));
const extensionPkg = readJson(path.join('app', 'chrome-extension', 'package.json'));
const sharedPkg = readJson(path.join('packages', 'shared', 'package.json'));
const wasmSimdPkg = readJson(path.join('packages', 'wasm-simd', 'package.json'));

const errors = [];
const warnings = [];

if (!rootPkg.private) {
  errors.push('Root package must remain private=true.');
}

if (nativePkg.name !== '@tabrix/tabrix') {
  errors.push(`Unexpected native package name: ${nativePkg.name}`);
}

if (sharedPkg.name !== '@tabrix/shared') {
  errors.push(`Unexpected shared package name: ${sharedPkg.name}`);
}

const workspaceProtocolDeps = findWorkspaceProtocolDeps(nativePkg.dependencies);
if (workspaceProtocolDeps.length > 0) {
  errors.push(
    `Native package has workspace protocol dependencies, which break npm installs: ${workspaceProtocolDeps.join(', ')}`,
  );
}

if (rootPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: root=${rootPkg.version}, native=${nativePkg.version}. Keep root in sync with release version.`,
  );
}

if (extensionPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: extension=${extensionPkg.version}, native=${nativePkg.version}. Keep user-facing packages aligned.`,
  );
}

if (sharedPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: shared=${sharedPkg.version}, native=${nativePkg.version}. Keep core packages aligned.`,
  );
}

if (wasmSimdPkg.version !== nativePkg.version) {
  errors.push(
    `Version mismatch: wasm-simd=${wasmSimdPkg.version}, native=${nativePkg.version}. Keep workspace packages aligned.`,
  );
}

const nativeSharedDep = nativePkg.dependencies?.['@tabrix/shared'];
const expectedNativeSharedDep = `^${sharedPkg.version}`;
if (nativeSharedDep !== expectedNativeSharedDep) {
  errors.push(
    `Native dependency mismatch: @tabrix/shared=${nativeSharedDep ?? '(missing)'}, expected ${expectedNativeSharedDep}.`,
  );
}

let resolvedTag = options.tag || `v${nativePkg.version}`;
const normalizedTagVersion = normalizeTagVersion(resolvedTag);
if (normalizedTagVersion == null) {
  errors.push(`Invalid tag format: ${resolvedTag}. Use vX.Y.Z or tabrix-vX.Y.Z.`);
} else if (normalizedTagVersion !== nativePkg.version) {
  errors.push(
    `Tag/version mismatch: tag=${normalizedTagVersion}, native=${nativePkg.version}.`,
  );
}

const releaseNotesFile = `docs/RELEASE_NOTES_v${nativePkg.version}.md`;
const fallbackNotesFile = 'docs/CHANGELOG.md';
let selectedNotesFile = releaseNotesFile;

if (!fileExists(releaseNotesFile)) {
  if (options.allowMissingNotes) {
    if (fileExists(fallbackNotesFile)) {
      selectedNotesFile = fallbackNotesFile;
      warnings.push(
        `Release notes file missing (${releaseNotesFile}); fallback to ${fallbackNotesFile}.`,
      );
    } else {
      errors.push(
        `Missing release notes file (${releaseNotesFile}) and fallback changelog (${fallbackNotesFile}).`,
      );
    }
  } else {
    errors.push(
      `Missing release notes file: ${releaseNotesFile}. Create it before publishing.`,
    );
  }
}

if (errors.length > 0) fail(errors);

console.log('release readiness check passed');
console.log(`- tag: ${resolvedTag}`);
console.log(`- package: ${nativePkg.name}`);
console.log(`- version: ${nativePkg.version}`);
console.log(`- notes_file: ${selectedNotesFile}`);
if (warnings.length > 0) {
  for (const warning of warnings) console.log(`- warning: ${warning}`);
}

appendGitHubOutput('tag', resolvedTag);
appendGitHubOutput('package_name', nativePkg.name);
appendGitHubOutput('version', nativePkg.version);
appendGitHubOutput('notes_file', selectedNotesFile);
appendGitHubOutput('shared_package_name', sharedPkg.name);
appendGitHubOutput('shared_version', sharedPkg.version);
