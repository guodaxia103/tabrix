import { createHash } from 'node:crypto';
import type { SqliteDatabase } from '../db';
import type { PageSnapshotRepository } from '../db/page-snapshot-repository';
import type { PendingAggregationSession, SessionRepository } from '../db/session-repository';
import type { StepRepository } from '../db/step-repository';
import type { ExperienceActionPathStep } from './experience-repository';
import { ExperienceRepository } from './experience-repository';

export interface ExperienceAggregationResult {
  scanned: number;
  projected: number;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ');
}

export function normalizeIntentSignature(intent: string): string {
  return collapseSpaces(
    String(intent || '')
      .trim()
      .toLowerCase(),
  );
}

export function buildActionPathId(pageRole: string, intentSignature: string): string {
  const digest = createHash('sha256').update(`${pageRole}\n${intentSignature}`).digest('hex');
  return `action_path_${digest}`;
}

function pickFirstHistoryRef(artifactRefs: string[]): string | null {
  for (const ref of artifactRefs) {
    if (typeof ref === 'string' && ref.trim().length > 0) {
      return ref;
    }
  }
  return null;
}

function toStepSequence(
  steps: ReturnType<StepRepository['listBySession']>,
): ExperienceActionPathStep[] {
  return steps.map((step) => ({
    toolName: step.toolName,
    status: step.status,
    historyRef: pickFirstHistoryRef(step.artifactRefs),
  }));
}

function toCounterDelta(status: PendingAggregationSession['status']): {
  successDelta: number;
  failureDelta: number;
} {
  if (status === 'completed') {
    return { successDelta: 1, failureDelta: 0 };
  }
  return { successDelta: 0, failureDelta: 1 };
}

export class ExperienceAggregator {
  private readonly upsertAndMarkTxn;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly sessions: SessionRepository,
    private readonly steps: StepRepository,
    private readonly snapshots: PageSnapshotRepository,
    private readonly experience: ExperienceRepository = new ExperienceRepository(db),
  ) {
    this.upsertAndMarkTxn = this.db.transaction(
      (input: {
        actionPathId: string;
        pageRole: string;
        intentSignature: string;
        stepSequence: ExperienceActionPathStep[];
        successDelta: number;
        failureDelta: number;
        lastUsedAt: string;
        nowIso: string;
        sessionId: string;
      }) => {
        this.experience.upsertActionPath({
          actionPathId: input.actionPathId,
          pageRole: input.pageRole,
          intentSignature: input.intentSignature,
          stepSequence: input.stepSequence,
          successDelta: input.successDelta,
          failureDelta: input.failureDelta,
          lastUsedAt: input.lastUsedAt,
          createdAt: input.nowIso,
          updatedAt: input.nowIso,
        });
        const marked = this.sessions.markAggregated(input.sessionId, input.nowIso);
        if (marked !== 1) {
          throw new Error(`session ${input.sessionId} was already aggregated`);
        }
      },
    );
  }

  public projectPendingSessions(nowIso?: string): ExperienceAggregationResult {
    const pending = this.sessions.listPendingAggregationSessions();
    let projected = 0;

    for (const session of pending) {
      const intentSignature = normalizeIntentSignature(session.taskIntent);
      const pageRole = this.snapshots.findLatestPageRoleForSession(session.sessionId) ?? 'unknown';
      const stepSequence = toStepSequence(this.steps.listBySession(session.sessionId));
      const { successDelta, failureDelta } = toCounterDelta(session.status);
      const actionPathId = buildActionPathId(pageRole, intentSignature);
      const sessionLastUsedAt = session.endedAt ?? session.startedAt;
      const markTime = nowIso ?? new Date().toISOString();

      this.upsertAndMarkTxn({
        actionPathId,
        pageRole,
        intentSignature,
        stepSequence,
        successDelta,
        failureDelta,
        lastUsedAt: sessionLastUsedAt,
        nowIso: markTime,
        sessionId: session.sessionId,
      });
      projected += 1;
    }

    return { scanned: pending.length, projected };
  }
}
