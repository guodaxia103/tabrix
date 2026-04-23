/**
 * Façade exposing Experience layer queries to the MCP layer.
 *
 * `SessionManager` owns the `ExperienceRepository` instance because it
 * also owns the underlying SQLite handle. The MCP handler must NOT
 * open its own DB — that would race the aggregator and could read
 * partially-projected state. Instead, the MCP handler asks
 * `sessionManager.experience` for this façade and only sees the
 * methods exposed here.
 *
 * Keeping this as a thin wrapper (rather than handing out the
 * repository directly) makes the public surface explicit: the façade
 * never exposes `upsertActionPath` / `clear`, so a future MCP tool
 * cannot accidentally bulk-mutate Experience by going through the
 * same pointer.
 *
 * V24-02: the surface is no longer strictly read-only. Two write-back
 * methods (`recordReplayStepOutcome`, `recordWritebackWarning`) land
 * here so the `experience_score_step` MCP handler can persist replay
 * outcomes through the same façade as `findActionPathById`. They are
 * intentionally narrow — they only touch counters / warning rows, not
 * `step_sequence` itself, so the aggregator remains the canonical
 * shape writer.
 */

import type { ExperienceSuggestPlanInput } from '@tabrix/shared';
import type {
  ExperienceActionPathRow,
  ExperienceRepository,
  RecordReplayStepOutcomeInput,
  RecordReplayStepOutcomeResult,
  RecordWritebackWarningInput,
} from './experience-repository';

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

  /**
   * V24-01: targeted point-lookup by `actionPathId`. Used by the
   * `experience_replay` MCP handler before opening per-step Memory
   * rows. Read-only — see {@link ExperienceRepository.findActionPathById}
   * for stale-id semantics.
   */
  public findActionPathById(actionPathId: string): ExperienceActionPathRow | undefined {
    return this.repository.findActionPathById(actionPathId);
  }

  /**
   * V24-02: per-step write-back from `experience_score_step`. Pure
   * passthrough; isolation (catching SQLite errors) is the handler's
   * responsibility because only the handler knows whether to write a
   * structured warning row or to surface `'isolated'` to the upstream
   * caller.
   */
  public recordReplayStepOutcome(
    input: RecordReplayStepOutcomeInput,
  ): RecordReplayStepOutcomeResult {
    return this.repository.recordReplayStepOutcome(input);
  }

  /**
   * V24-02: append a structured isolation warning row. Used by the
   * `experience_score_step` handler when the per-step UPDATE throws
   * (e.g. SQLite lock or schema mismatch in legacy DBs); also used by
   * the aggregator's session-end composite-score writer for the same
   * reason. The row is testable / queryable so an operator can see
   * why an Experience write was lost.
   */
  public recordWritebackWarning(input: RecordWritebackWarningInput): void {
    this.repository.recordWritebackWarning(input);
  }
}
