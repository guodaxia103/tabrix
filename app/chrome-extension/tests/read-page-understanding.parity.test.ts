import { describe, expect, it } from 'vitest';
import { inferPageUnderstanding } from '@/entrypoints/background/tools/browser/read-page-understanding';
import { buildUnderstandingContext } from '@/entrypoints/background/tools/browser/read-page-understanding-core';
import { githubPageFamilyAdapter } from '@/entrypoints/background/tools/browser/read-page-understanding-github';

/**
 * Parity suite — asserts the Knowledge Registry path (the default runtime
 * in `KNOWLEDGE_REGISTRY_MODE='on'`) produces the same
 * `PageUnderstandingSummary` as the legacy TS family adapter.
 *
 * Strategy:
 *   - Registry path: call `inferPageUnderstanding(url, title, content)` —
 *     this is what production code ships with the flag on.
 *   - Legacy path: call `githubPageFamilyAdapter.infer(context)` directly —
 *     bypasses the registry entirely.
 *
 * Any divergence here means a seed was translated incorrectly from
 * `read-page-understanding-github.ts`. Stage 1 is explicitly bit-compatible
 * with the legacy adapter for GitHub; Douyin is out of scope and excluded
 * from this suite.
 */

interface ParityFixture {
  readonly name: string;
  readonly url: string;
  readonly title: string;
  readonly content: string;
}

const GITHUB_PARITY_FIXTURES: readonly ParityFixture[] = [
  {
    name: 'repo_home with primary nav',
    url: 'https://github.com/example/project',
    title: 'example/project',
    content: 'Issues Pull requests Actions Go to file Code',
  },
  {
    name: 'repo_home with only shell signals',
    url: 'https://github.com/example/project',
    title: 'example/project',
    content: 'Code README Latest commit main branch',
  },
  {
    name: 'repo_home with hash in url',
    url: 'https://github.com/example/project#readme',
    title: 'example/project',
    content: 'Code README',
  },
  {
    name: 'issues_list with full filter toolbar',
    url: 'https://github.com/example/project/issues',
    title: 'Issues · example/project',
    content: 'Search Issues Filter by assignee New issue',
  },
  {
    name: 'issues_list with shell signals',
    url: 'https://github.com/example/project/issues',
    title: 'Issues · example/project',
    content: 'Issues Loading repository',
  },
  {
    name: 'actions_list with run controls',
    url: 'https://github.com/example/project/actions',
    title: 'Actions · example/project',
    content: 'Filter workflow runs completed successfully: Run 1052 of CI',
  },
  {
    name: 'actions_list with only shell signals',
    url: 'https://github.com/example/project/actions',
    title: 'Actions · example/project',
    content: 'Actions Workflows Loading',
  },
  {
    name: 'workflow_run_detail with summary signals',
    url: 'https://github.com/example/project/actions/runs/42',
    title: 'Release Tabrix',
    content: 'Summary Show all jobs Jobs Artifacts Logs',
  },
  {
    name: 'workflow_run_detail promoted despite shell hints',
    url: 'https://github.com/example/project/actions/runs/42',
    title: 'Release Tabrix',
    content: 'Actions Run 42 Loading Summary Show all jobs Jobs Artifacts Logs',
  },
  {
    // T5.4.5: pageRole stays `workflow_run_detail` even when only the
    // shell skeleton has hydrated; `primaryRegion` carries the readiness
    // signal independently.
    name: 'workflow_run_detail stable even when only shell hints visible',
    url: 'https://github.com/example/project/actions/runs/42',
    title: 'Release Tabrix',
    content: 'Workflow run Loading Checks Queued Started',
  },
];

describe('read_page understanding — registry/legacy parity (github)', () => {
  for (const fixture of GITHUB_PARITY_FIXTURES) {
    it(`parity: ${fixture.name}`, () => {
      const viaRegistry = inferPageUnderstanding(fixture.url, fixture.title, fixture.content);
      const legacyContext = buildUnderstandingContext(fixture.url, fixture.title, fixture.content);
      const viaLegacy = githubPageFamilyAdapter.infer(legacyContext);

      expect(viaLegacy).not.toBeNull();
      expect(viaRegistry).toEqual(viaLegacy);
    });
  }
});
