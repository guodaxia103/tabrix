import type { CompiledKnowledgeRegistry, CompiledSiteProfile } from '../types';
import { getCompiledKnowledgeRegistry } from '../registry/knowledge-registry';

/**
 * Given a lowercased URL, determine which siteId (if any) owns it by
 * consulting the Knowledge Registry's Site Profile index.
 *
 * Matching semantics:
 * 1. If any `match.hosts` entry is a substring of the URL's host, the
 *    site wins (used for the stable `github.com` / `douyin.com` cases).
 * 2. Else if any `match.urlPatterns` RegExp matches the full URL, the
 *    site wins.
 *
 * The registry may be absent (compile failed in runtime) — callers treat
 * `null` as "fall back to the TS family adapters" so Stage 1 degrades
 * gracefully.
 */
export function resolveSiteProfile(
  lowerUrl: string,
  registry: CompiledKnowledgeRegistry | null = getCompiledKnowledgeRegistry(),
): string | null {
  if (!registry) {
    return null;
  }
  const host = extractHost(lowerUrl);
  for (const profile of registry.siteProfiles.values()) {
    if (matchesProfile(profile, lowerUrl, host)) {
      return profile.siteId;
    }
  }
  return null;
}

function matchesProfile(
  profile: CompiledSiteProfile,
  lowerUrl: string,
  host: string | null,
): boolean {
  if (host) {
    for (const candidateHost of profile.match.hosts) {
      if (candidateHost && host.endsWith(candidateHost.toLowerCase())) {
        return true;
      }
    }
  }
  for (const compiled of profile.match.urlPatterns) {
    if (compiled.pattern.test(lowerUrl)) {
      return true;
    }
  }
  return false;
}

function extractHost(lowerUrl: string): string | null {
  try {
    return new URL(lowerUrl).host.toLowerCase();
  } catch {
    return null;
  }
}
