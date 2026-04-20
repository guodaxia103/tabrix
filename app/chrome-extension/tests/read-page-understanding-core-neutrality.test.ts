import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildUnderstandingContext,
  collectAnchorTexts,
  detectLegalFooter,
} from '@/entrypoints/background/tools/browser/read-page-understanding-core';

/**
 * T5.3.2 Core Neutrality Invariants
 *
 * These tests enforce Gate A (Architecture Neutrality) of the Release
 * Readiness Criteria v2: `read-page-understanding-core.ts` must contain zero
 * site-specific vocabulary and zero site-specific behavior.
 *
 * If a future change re-introduces family-specific logic into core, these
 * tests MUST fail.
 */
describe('read_page core neutrality', () => {
  const coreFilePath = resolve(
    __dirname,
    '..',
    'entrypoints',
    'background',
    'tools',
    'browser',
    'read-page-understanding-core.ts',
  );
  const coreFileSource = readFileSync(coreFilePath, 'utf8');

  it('core source contains no site-specific Douyin anchors', () => {
    const forbiddenDouyinStrings = [
      '视频总榜',
      '话题榜',
      '热度趋势',
      '热度值',
      '播放量',
      '稿均播放量',
      '发布视频',
      '账号总览',
      '创作者',
      '抖音',
    ];
    for (const forbidden of forbiddenDouyinStrings) {
      expect(coreFileSource).not.toContain(forbidden);
    }
  });

  it('core source contains no GitHub-specific page-role literals', () => {
    const githubSpecificIdentifiers = [
      "'repo_home'",
      "'issues_list'",
      "'actions_list'",
      "'workflow_run_detail'",
    ];
    for (const forbidden of githubSpecificIdentifiers) {
      expect(coreFileSource).not.toContain(forbidden);
    }
  });

  it('collectAnchorTexts returns empty list when no anchor dictionary is supplied', () => {
    const anchors = collectAnchorTexts('播放量 视频量 话题名称 热度值');
    expect(anchors).toEqual([]);
  });

  it('collectAnchorTexts filters only by supplied dictionary, not hard-coded vocabulary', () => {
    const customAnchors = ['custom-anchor-a', 'custom-anchor-b'];
    const anchors = collectAnchorTexts('... custom-anchor-a ... something else ...', customAnchors);
    expect(anchors).toEqual(['custom-anchor-a']);
  });

  it('default footer detector requires legal pattern AND short content', () => {
    const shortLegal = buildUnderstandingContext(
      'https://example.com',
      'Example',
      '用户服务协议 隐私政策 联系我们',
    );
    expect(shortLegal.footerOnly).toBe(true);

    const longContentWithLegal = buildUnderstandingContext(
      'https://example.com',
      'Example',
      '隐私政策 ' + 'x'.repeat(500),
    );
    expect(longContentWithLegal.footerOnly).toBe(false);
  });

  it('default footer detector returns false when no legal pattern exists', () => {
    const nonLegal = buildUnderstandingContext(
      'https://example.com',
      'Example',
      'Some generic content with no legal keywords',
    );
    expect(nonLegal.footerOnly).toBe(false);
  });

  it('detectLegalFooter accepts generic English and Chinese legal patterns only', () => {
    expect(detectLegalFooter('Terms of Service · Privacy Policy')).toBe(true);
    expect(detectLegalFooter('用户服务协议')).toBe(true);
    expect(detectLegalFooter('Nothing relevant here')).toBe(false);
    expect(detectLegalFooter('播放量 100w')).toBe(false);
  });

  it('buildUnderstandingContext with custom anchors populates anchorTexts', () => {
    const ctx = buildUnderstandingContext('https://example.com', 'Example', 'foo bar baz', {
      anchors: ['foo', 'baz'],
    });
    expect(ctx.anchorTexts).toEqual(['foo', 'baz']);
  });

  it('buildUnderstandingContext with a custom footer detector overrides default heuristic', () => {
    const ctx = buildUnderstandingContext(
      'https://example.com',
      'Example',
      'no legal pattern here',
      { footerDetector: () => true },
    );
    expect(ctx.footerOnly).toBe(true);
  });
});
