/**
 * Read-only façade exposing Experience layer queries to the MCP layer.
 *
 * `SessionManager` owns the `ExperienceRepository` instance because it
 * also owns the underlying SQLite handle. The MCP handler must NOT
 * open its own DB — that would race the aggregator and could read
 * partially-projected state. Instead, the MCP handler asks
 * `sessionManager.experience` for this façade and only sees the
 * read-side methods exposed here.
 *
 * Keeping this as a thin wrapper (rather than handing out the
 * repository directly) makes the read surface explicit: the façade
 * never exposes `upsertActionPath` / `clear`, so a future MCP tool
 * cannot accidentally mutate Experience by going through the same
 * pointer.
 */

import type { ExperienceSuggestPlanInput } from '@tabrix/shared';
import type { ExperienceActionPathRow, ExperienceRepository } from './experience-repository';

export class ExperienceQueryService {
  constructor(private readonly repository: ExperienceRepository) {}

  /**
   * Direct passthrough to `ExperienceRepository.suggestActionPaths`.
   * The repository handles SQL ordering + clamping; we keep the wrapper
   * so the call site can later add caching, telemetry, or ACL hooks
   * without touching the repository contract.
   */
  public suggestActionPaths(input: ExperienceSuggestPlanInput): ExperienceActionPathRow[] {
    return this.repository.suggestActionPaths({
      intentSignature: input.intentSignature,
      pageRole: input.pageRole,
      limit: input.limit,
    });
  }
}
