/**
 * V25-03 — Sidepanel "Execution" tab read-only HTTP routes.
 *
 * Surface the V25-02 layer-dispatch + V24-03 ranked-replay telemetry
 * persisted in `tabrix_choose_context_decisions` and
 * `tabrix_choose_context_outcomes`. These routes intentionally
 * mirror the read-only invariant of `memory-routes.ts`:
 *   - all four endpoints are GET-only; write verbs are not registered
 *   - response envelopes are `{ status: 'ok', data }`
 *   - localhost is allowed through by the global onRequest hook in
 *     `server/index.ts`; non-localhost requires the standard Bearer
 *     token. No extra auth lives here.
 *
 * Privacy contract (M4 binding — enforced by negative tests in
 * `execution-routes.test.ts`):
 *   - response bodies MUST NOT contain full URLs / query strings
 *   - response bodies MUST NOT include any field from
 *     `memory_sessions.user_input`
 *   - response bodies MUST NOT include cookie or auth header values
 *   - intent is only echoed as the structural `intent_signature`
 *     (lower-cased + redacted upstream by B-013)
 *
 * Routes:
 *   - `GET /execution/decisions/recent?limit=`
 *   - `GET /execution/savings/summary`
 *   - `GET /execution/action-paths/top?limit=`
 *   - `GET /execution/reliability/signals`
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
  EXECUTION_RECENT_DECISIONS_LIMIT_MAX,
  EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
  EXECUTION_TOP_ACTION_PATHS_LIMIT_MAX,
  type ExecutionRecentDecisionsResponseData,
  type ExecutionReliabilitySignalSummary,
  type ExecutionSavingsSummary,
  type ExecutionTopActionPathsResponseData,
} from '@tabrix/shared';
import { HTTP_STATUS } from '../constant';
import type { SessionManager } from '../execution/session-manager';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';

interface RecentDecisionsQuery {
  limit?: string;
}

interface TopActionPathsQuery {
  limit?: string;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

/**
 * Empty-state response when telemetry is disabled (in-memory tests
 * without a chooser repo, or persistence:'off'). Returning a
 * well-formed envelope is the M4 contract — the UI must never see a
 * 500 just because no decisions exist yet.
 */
function emptyRecentDecisions(
  limit: number,
  persistenceMode: 'disk' | 'memory' | 'off',
): ExecutionRecentDecisionsResponseData {
  return { decisions: [], total: 0, limit, persistenceMode };
}

function emptySavings(persistenceMode: 'disk' | 'memory' | 'off'): ExecutionSavingsSummary {
  return {
    decisionCount: 0,
    tokensSavedEstimateSum: 0,
    layerCounts: { L0: 0, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 },
    lastReplay: null,
    persistenceMode,
  };
}

function emptyActionPaths(
  limit: number,
  persistenceMode: 'disk' | 'memory' | 'off',
): ExecutionTopActionPathsResponseData {
  return { paths: [], limit, persistenceMode };
}

function emptyReliability(
  persistenceMode: 'disk' | 'memory' | 'off',
): ExecutionReliabilitySignalSummary {
  return {
    decisionCount: 0,
    fallbackSafeCount: 0,
    fallbackSafeRate: 0,
    sourceRouteCounts: {
      read_page_required: 0,
      experience_replay_skip_read: 0,
      knowledge_supported_read: 0,
      dispatcher_fallback_safe: 0,
      unknown: 0,
    },
    replayBlockedByCounts: {},
    persistenceMode,
  };
}

export function registerExecutionRoutes(
  fastify: FastifyInstance,
  sessionManager: SessionManager = defaultSessionManager,
): void {
  fastify.get(
    '/execution/decisions/recent',
    async (request: FastifyRequest<{ Querystring: RecentDecisionsQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(
        request.query.limit,
        EXECUTION_RECENT_DECISIONS_DEFAULT_LIMIT,
        EXECUTION_RECENT_DECISIONS_LIMIT_MAX,
      );
      const persistence = sessionManager.getPersistenceStatus();
      const repo = sessionManager.chooseContextTelemetry;
      if (!repo) {
        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: emptyRecentDecisions(limit, persistence.mode),
        });
      }
      const decisions = repo.listRecentExecutionDecisions(limit);
      const total = repo.countAllExecutionDecisions();
      const data: ExecutionRecentDecisionsResponseData = {
        decisions,
        total,
        limit,
        persistenceMode: persistence.mode,
      };
      return reply.status(HTTP_STATUS.OK).send({ status: 'ok', data });
    },
  );

  fastify.get('/execution/savings/summary', async (_request, reply: FastifyReply) => {
    const persistence = sessionManager.getPersistenceStatus();
    const repo = sessionManager.chooseContextTelemetry;
    if (!repo) {
      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: emptySavings(persistence.mode),
      });
    }
    const summary = repo.summarizeExecutionSavings();
    const data: ExecutionSavingsSummary = { ...summary, persistenceMode: persistence.mode };
    return reply.status(HTTP_STATUS.OK).send({ status: 'ok', data });
  });

  fastify.get(
    '/execution/action-paths/top',
    async (request: FastifyRequest<{ Querystring: TopActionPathsQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(
        request.query.limit,
        EXECUTION_TOP_ACTION_PATHS_DEFAULT_LIMIT,
        EXECUTION_TOP_ACTION_PATHS_LIMIT_MAX,
      );
      const persistence = sessionManager.getPersistenceStatus();
      const repo = sessionManager.chooseContextTelemetry;
      if (!repo) {
        return reply.status(HTTP_STATUS.OK).send({
          status: 'ok',
          data: emptyActionPaths(limit, persistence.mode),
        });
      }
      const paths = repo.topExecutionActionPaths(limit);
      const data: ExecutionTopActionPathsResponseData = {
        paths,
        limit,
        persistenceMode: persistence.mode,
      };
      return reply.status(HTTP_STATUS.OK).send({ status: 'ok', data });
    },
  );

  fastify.get('/execution/reliability/signals', async (_request, reply: FastifyReply) => {
    const persistence = sessionManager.getPersistenceStatus();
    const repo = sessionManager.chooseContextTelemetry;
    if (!repo) {
      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: emptyReliability(persistence.mode),
      });
    }
    const signals = repo.reliabilitySignals();
    const data: ExecutionReliabilitySignalSummary = {
      ...signals,
      persistenceMode: persistence.mode,
    };
    return reply.status(HTTP_STATUS.OK).send({ status: 'ok', data });
  });
}
