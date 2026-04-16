import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const requiredFiles = [
  'AGENTS.md',
  'README.md',
  'README_zh.md',
  'docs/README.md',
  'docs/AI_CONTRIBUTOR_QUICKSTART_zh.md',
  'docs/AI_DEV_RULES_zh.md',
  'docs/PRODUCT_SURFACE_MATRIX.md',
  'docs/PRODUCT_SURFACE_MATRIX_zh.md',
  'docs/TESTING.md',
  'docs/TESTING_zh.md',
  'docs/PLATFORM_SUPPORT.md',
  'docs/PLATFORM_SUPPORT_zh.md',
  'docs/COMPATIBILITY_MATRIX.md',
  'docs/COMPATIBILITY_MATRIX_zh.md',
  'docs/USE_CASES.md',
  'docs/USE_CASES_zh.md',
];

const mustReference = [
  {
    file: 'AGENTS.md',
    includes: [
      'docs/AI_CONTRIBUTOR_QUICKSTART_zh.md',
      'docs/AI_DEV_RULES_zh.md',
      'docs/PRODUCT_SURFACE_MATRIX.md',
      'docs/TESTING.md',
      'docs/PLATFORM_SUPPORT.md',
    ],
  },
  {
    file: 'README.md',
    includes: [
      'docs/README.md',
      'docs/AI_CONTRIBUTOR_QUICKSTART_zh.md',
      'docs/AI_DEV_RULES_zh.md',
      'docs/USE_CASES.md',
      'docs/PRODUCT_SURFACE_MATRIX.md',
      'docs/TESTING.md',
      'docs/PLATFORM_SUPPORT.md',
      'docs/COMPATIBILITY_MATRIX.md',
    ],
  },
  {
    file: 'README_zh.md',
    includes: [
      'docs/README.md',
      'docs/AI_CONTRIBUTOR_QUICKSTART_zh.md',
      'docs/AI_DEV_RULES_zh.md',
      'docs/USE_CASES_zh.md',
      'docs/PRODUCT_SURFACE_MATRIX_zh.md',
      'docs/TESTING_zh.md',
      'docs/PLATFORM_SUPPORT_zh.md',
      'docs/COMPATIBILITY_MATRIX_zh.md',
    ],
  },
  {
    file: 'docs/README.md',
    includes: [
      'AI_CONTRIBUTOR_QUICKSTART_zh.md',
      'AI_DEV_RULES_zh.md',
      'USE_CASES.md',
      'PRODUCT_SURFACE_MATRIX.md',
      'TESTING.md',
      'PLATFORM_SUPPORT.md',
      'COMPATIBILITY_MATRIX.md',
    ],
  },
];

const forbiddenPatterns = [
  /internal-docs[\\/]/,
  /E:\\projects\\AI\\codex\\internal-docs/i,
];

const codeSearchRoots = ['app', 'packages', 'scripts'];
const githubDocsBlobPattern =
  /https:\/\/github\.com\/guodaxia103\/tabrix\/blob\/main\/(docs\/[A-Za-z0-9_./-]+\.md)/g;

let failed = false;

function collectFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const result = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'coverage', 'releases', '.git'].includes(entry.name)) {
          continue;
        }
        stack.push(nextPath);
        continue;
      }

      if (entry.isFile()) {
        result.push(nextPath);
      }
    }
  }

  return result;
}

for (const relativeFile of requiredFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  if (!fs.existsSync(absoluteFile)) {
    console.error(`[docs:check] missing required file: ${relativeFile}`);
    failed = true;
  }
}

for (const rule of mustReference) {
  const absoluteFile = path.join(repoRoot, rule.file);
  if (!fs.existsSync(absoluteFile)) {
    continue;
  }
  const content = fs.readFileSync(absoluteFile, 'utf8');
  for (const expected of rule.includes) {
    if (!content.includes(expected)) {
      console.error(`[docs:check] ${rule.file} is missing expected reference: ${expected}`);
      failed = true;
    }
  }
}

const publicDocsFiles = [
  'AGENTS.md',
  'README.md',
  'README_zh.md',
  ...fs.readdirSync(path.join(repoRoot, 'docs')).map((name) => path.join('docs', name)),
].filter((relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
});

for (const relativeFile of publicDocsFiles) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const content = fs.readFileSync(absoluteFile, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      console.error(`[docs:check] forbidden internal reference found in ${relativeFile}: ${pattern}`);
      failed = true;
    }
  }
}

const codeFiles = codeSearchRoots.flatMap((root) => collectFiles(path.join(repoRoot, root)));
for (const absoluteFile of codeFiles) {
  const content = fs.readFileSync(absoluteFile, 'utf8');
  const matches = content.matchAll(githubDocsBlobPattern);
  for (const match of matches) {
    const relativeDocPath = match[1];
    const absoluteDocPath = path.join(repoRoot, relativeDocPath);
    if (!fs.existsSync(absoluteDocPath)) {
      console.error(
        `[docs:check] code references missing public doc: ${relativeDocPath} (from ${path.relative(repoRoot, absoluteFile)})`,
      );
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('[docs:check] OK');
