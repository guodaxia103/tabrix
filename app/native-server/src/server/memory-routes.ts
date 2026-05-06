/**
 * MKEP Memory read routes.
 *
 * These routes expose the persisted Memory tables (`memory_sessions`
 * + `memory_tasks` + `memory_steps`) to the sidepanel Memory tab. They
 * are intentionally **read-only** — the Memory write path is owned by
 * `SessionManager` via the MCP post-processor and must not be exposed
 * over HTTP.
 *
 * Auth: relies on the global `onRequest` hook in `server/index.ts`
 * (localhost is allowed through; non-localhost must present a Bearer
 * token when `tokenManager.enabled` is true). The routes themselves
 * add no extra auth. Public paths (`/ping`, `/status`, `/auth/token`,
 * `/auth/refresh`) are intentionally **not** extended — these routes
 * are protected by the same token as `/mcp`.
 *
 * Contract:
 * - `GET /memory/sessions?limit=&offset=` → recent sessions, newest first
 * - `GET /memory/sessions/:sessionId/steps` → steps for one session
 * - `GET /memory/tasks/:taskId` → single task + its sessions
 *
 * Write verbs (POST/PUT/PATCH/DELETE) are not registered; Fastify
 * will respond 404 for them, which is the intended "read-only"
 * signal.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../constant';
import type { SessionManager } from '../execution/session-manager';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';
import { SESSION_SUMMARY_LIMIT_MAX } from '../memory/db';

/**
 * Default page size for `GET /memory/sessions`. Matches the sidepanel
 * Memory tab's initial render budget (20 rows).
 */
export const MEMORY_SESSIONS_DEFAULT_LIMIT = 20;

interface SessionsQuery {
  limit?: string;
  offset?: string;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.max(0, Math.floor(n)));
}

/**
 * Register the MKEP Memory read routes on `fastify`.
 *
 * @param fastify         Fastify instance owned by {@link Server}.
 * @param sessionManager  Defaults to the module-level singleton. Tests
 *                        may inject a scratch instance pointing at an
 *                        in-memory DB.
 */
export function registerMemoryRoutes(
  fastify: FastifyInstance,
  sessionManager: SessionManager = defaultSessionManager,
): void {
  fastify.get(
    '/memory/sessions',
    async (request: FastifyRequest<{ Querystring: SessionsQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(
        request.query.limit,
        MEMORY_SESSIONS_DEFAULT_LIMIT,
        SESSION_SUMMARY_LIMIT_MAX,
      );
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const sessions = sessionManager.listRecentSessionSummaries(limit, offset);
      const total = sessionManager.countAllSessions();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          sessions,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/sessions/:sessionId/steps',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          status: 'error',
          message: 'sessionId is required',
        });
      }
      const steps = sessionManager.getStepsForSession(sessionId);
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          sessionId,
          steps,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/tasks/:taskId',
    async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
      const { taskId } = request.params;
      if (!taskId || typeof taskId !== 'string') {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          status: 'error',
          message: 'taskId is required',
        });
      }
      const task = sessionManager.getTaskOrNull(taskId);
      const persistence = sessionManager.getPersistenceStatus();

      if (!task) {
        return reply.status(HTTP_STATUS.NOT_FOUND).send({
          status: 'error',
          message: 'Task not found',
          data: { persistenceMode: persistence.mode },
        });
      }

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          task,
          persistenceMode: persistence.mode,
        },
      });
    },
  );
}
