/**
 * V26-FIX-02 — `tabrix_choose_context` observe-mode advisory tests.
 *
 * Pin the four-branch derivation that decides whether the upstream
 * MCP loop should drive a foreground `chrome_network_capture_*`
 * round-trip:
 *
 *   1. `learning_requested` (env opt-in) — ALWAYS wins, even when
 *      Knowledge has a high-confidence candidate. The point of a
 *      learning pass is to observe traffic; suppressing capture
 *      would defeat the purpose.
 *   2. `not_needed` — Knowledge has a high-confidence candidate;
 *      the chooser asserts capture is wasted work.
 *   3. `confidence_low` — Knowledge has rows but no usable
 *      candidate. Background passive observe is acceptable; the
 *      foreground round-trip is not driven.
 *   4. `knowledge_missing` — no Knowledge for the resolved site;
 *      foreground capture is the only way to seed the catalog.
 *
 * No SQLite, no MCP server: the chooser is run in-process with a
 * synthetic experience stub and a tiny in-memory `KnowledgeApi` to
 * exercise the four-state matrix without standing up persistence.
 */

import { runTabrixChooseContext } from './choose-context';
import type { ExperienceQueryService } from '../memory/experience';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';

function emptyExperience(): ExperienceQueryService {
  return {
    suggestActionPaths: jest.fn().mockReturnValue([]),
  } as unknown as ExperienceQueryService;
}

function emptyKnowledgeApi(): Pick<KnowledgeApiRepository, 'listBySite' | 'countAll'> &
  Partial<Pick<KnowledgeApiRepository, 'listScoredBySite'>> {
  return {
    listBySite: jest.fn().mockReturnValue([]),
    listScoredBySite: jest.fn().mockReturnValue([]),
    countAll: jest.fn().mockReturnValue(0),
  };
}

function knowledgeApiWithRows(
  rows: Array<{ endpointSignature: string; usableForTask: boolean }>,
): Pick<KnowledgeApiRepository, 'listBySite' | 'countAll'> &
  Partial<Pick<KnowledgeApiRepository, 'listScoredBySite'>> {
  return {
    listBySite: jest.fn().mockReturnValue(rows),
    listScoredBySite: jest.fn().mockReturnValue(rows),
    countAll: jest.fn().mockReturnValue(rows.length),
  };
}

const CAPS_API_KNOWLEDGE = { TABRIX_POLICY_CAPABILITIES: 'api_knowledge' } as const;

describe('runTabrixChooseContext — V26-FIX-02 observe-mode advisory', () => {
  it('high-confidence Knowledge candidate → observeMode=disabled / not_needed', () => {
    const result = runTabrixChooseContext(
      { intent: '搜索 GitHub 上 AI助手 相关热门项目', url: 'https://github.com/search' },
      {
        experience: emptyExperience(),
        // No knowledgeApi rows needed — the api_knowledge candidate
        // resolver fires on the URL alone for the GitHub search
        // family, and that is what populates `apiCandidate`.
        knowledgeApi: emptyKnowledgeApi(),
        capabilityEnv: CAPS_API_KNOWLEDGE,
      },
    );
    expect(result.status).toBe('ok');
    expect(result.observeMode).toBe('disabled');
    expect(result.observeReason).toBe('not_needed');
  });

  it('Knowledge has rows but no usable candidate → background / confidence_low', () => {
    const result = runTabrixChooseContext(
      // Generic GitHub repo file URL — no read-only API candidate
      // fires (the intent has no search/list/issues vocabulary), but
      // the `listScoredBySite` stub returns a non-empty catalog so
      // `knowledgeCatalog` is populated.
      { intent: 'read this file', url: 'https://github.com/tabrix/tabrix/blob/main/README.md' },
      {
        experience: emptyExperience(),
        knowledgeApi: knowledgeApiWithRows([
          { endpointSignature: 'GET api.github.com/repos/{owner}/{repo}', usableForTask: true },
        ]),
        capabilityEnv: CAPS_API_KNOWLEDGE,
      },
    );
    expect(result.status).toBe('ok');
    expect(result.observeMode).toBe('background');
    expect(result.observeReason).toBe('confidence_low');
  });

  it('non-GitHub URL with no Knowledge → foreground / knowledge_missing', () => {
    const result = runTabrixChooseContext(
      { intent: 'read article', url: 'https://news.ycombinator.com/item?id=1' },
      {
        experience: emptyExperience(),
        knowledgeApi: emptyKnowledgeApi(),
        capabilityEnv: CAPS_API_KNOWLEDGE,
      },
    );
    expect(result.status).toBe('ok');
    expect(result.observeMode).toBe('foreground');
    expect(result.observeReason).toBe('knowledge_missing');
  });

  it('learningModeRequested overrides everything → foreground / learning_requested', () => {
    const result = runTabrixChooseContext(
      // Same input as the high-confidence candidate test above; the
      // learning override must still flip the advisory to foreground.
      { intent: '搜索 GitHub 上 AI助手 相关热门项目', url: 'https://github.com/search' },
      {
        experience: emptyExperience(),
        knowledgeApi: emptyKnowledgeApi(),
        capabilityEnv: CAPS_API_KNOWLEDGE,
        learningModeRequested: true,
      },
    );
    expect(result.status).toBe('ok');
    expect(result.observeMode).toBe('foreground');
    expect(result.observeReason).toBe('learning_requested');
  });

  it('observeMode/observeReason are absent from invalid_input results', () => {
    const result = runTabrixChooseContext(
      { intent: '' },
      {
        experience: emptyExperience(),
        knowledgeApi: null,
        capabilityEnv: {},
      },
    );
    expect(result.status).toBe('invalid_input');
    expect(result.observeMode).toBeUndefined();
    expect(result.observeReason).toBeUndefined();
  });
});
