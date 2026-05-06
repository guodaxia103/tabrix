import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './names';

export const EXPERIENCE_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.EXPERIENCE.SUGGEST_PLAN,
    description:
      'Tabrix MKEP Experience (read-only): given an `intent` (free text) and an optional `pageRole`, return the most-successful previously-observed action paths. The native server matches on a normalized intent signature (whitespace-collapsed, lowercased) so callers do not need to canonicalize. Pure SELECT against the local SQLite — no browser side-effects, no network. Returns `status: "no_match"` (with `plans: []`) when no paths match.',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description:
            'Caller intent in natural language; same shape that drives Memory `tasks.intent`. Trimmed and matched on a normalized signature so casing/whitespace differences hit the same bucket. Empty string is rejected.',
          minLength: 1,
          maxLength: 1024,
        },
        pageRole: {
          type: 'string',
          description:
            'Optional `pageRole` filter (e.g. `repo_home`, `issues_list`). When provided, only action paths recorded for that role are returned.',
          maxLength: 128,
        },
        limit: {
          type: 'integer',
          description:
            'Maximum number of action paths to return. Defaults to 1; clamped to [1, 5].',
          minimum: 1,
          maximum: 5,
          default: 1,
        },
      },
      required: ['intent'],
    },
  },
  {
    name: TOOL_NAMES.EXPERIENCE.REPLAY,
    description:
      'Tabrix MKEP Experience write/execute: replay a NAMED `actionPathId` previously surfaced by `experience_suggest_plan`. Re-runs the recorded `step_sequence` step-by-step against the named tab. Bounded, fail-closed: if any step fails, the replay halts at that step (no autonomous retry, no autonomous re-locator, no autonomous re-plan). Supports recorded `chrome_click_element` / `chrome_fill_or_select` steps, constrained pageRole matching, and the substitution whitelist `{queryText,targetLabel}`. Capability-gated by `TABRIX_POLICY_CAPABILITIES=experience_replay` (default-deny).',
    annotations: {
      // `requiresExplicitOptIn: true` is injected at listTools time by
      // `register-tools.ts::filterToolsByPolicy` (alongside `riskTier`)
      // so the static schema stays compatible with the upstream
      // MCP SDK `Tool['annotations']` shape. The capability gate
      // (CAPABILITY_GATED_TOOLS) drives both visibility and dispatch
      // for this tool family.
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        actionPathId: {
          type: 'string',
          description:
            'The action-path to replay. Must match `^action_path_[0-9a-f]{64}$` (the producer in `experience-aggregator.ts::buildActionPathId`). Caller obtains this id from a prior `experience_suggest_plan` response.',
          minLength: 1,
          maxLength: 256,
          pattern: '^action_path_[0-9a-f]{64}$',
        },
        variableSubstitutions: {
          type: 'object',
          description:
            "Optional substitution map. Keys are restricted to the current whitelist: 'queryText' (search/filter text) and 'targetLabel' (label/tag/state selector). Values are runtime strings to substitute into the per-step `templateFields` declared at capture time. A key not present in a step's `templateFields` is rejected (`failed-precondition`). Empty / omitted = replay verbatim.",
          properties: {
            queryText: {
              type: 'string',
              maxLength: 4096,
              description: 'Search / filter text for issue-search-style steps.',
            },
            targetLabel: {
              type: 'string',
              maxLength: 4096,
              description: 'Label / tag / state selector value.',
            },
          },
          additionalProperties: false,
        },
        targetTabId: {
          type: 'integer',
          description:
            'Optional Chrome tab id to replay against. Defaults to the active tab in the active window. Mismatched `pageRole` against the recorded `experience_action_paths.page_role` is `failed-precondition` (`page_role_mismatch`).',
          minimum: 1,
        },
        maxSteps: {
          type: 'integer',
          description:
            'Hard ceiling on attempted steps. Defaults to 16; clamped to [1, 16]. A row whose `step_sequence.length` exceeds this is `failed-precondition` (`step_budget_exceeded`), NOT "execute the first 16".',
          minimum: 1,
          maximum: 16,
          default: 16,
        },
      },
      required: ['actionPathId'],
    },
  },
  {
    name: TOOL_NAMES.EXPERIENCE.SCORE_STEP,
    description:
      'Tabrix MKEP Experience write-back: record one replay step outcome (success or failure) against a NAMED `actionPathId` and `stepIndex`. Re-uses the `ClickObservedOutcome` taxonomy (no parallel outcome enum). Native-handled, capability-gated by `experience_replay` (same gate as `experience_replay`). The replay engine calls this automatically per step; upstream callers normally do NOT need to invoke it. Failure of the underlying SQLite write is isolated and surfaced via a structured `experience_writeback_warnings` row instead of being thrown back to the caller — `status: "isolated"` indicates that path.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        actionPathId: {
          type: 'string',
          description:
            'The action-path being scored. Must match `^action_path_[0-9a-f]{64}$` — the same shape the aggregator emits and `experience_replay` consumes.',
          minLength: 1,
          maxLength: 256,
          pattern: '^action_path_[0-9a-f]{64}$',
        },
        stepIndex: {
          type: 'integer',
          description:
            '0-based index inside `experience_action_paths.step_sequence`. Bounded by the same step budget the replay engine enforces ([0, 15]).',
          minimum: 0,
          maximum: 15,
        },
        observedOutcome: {
          type: 'string',
          description:
            'Closed enum from `ClickObservedOutcome`. The persistence layer projects this onto a {success | failure} delta via `isClickSuccessOutcome`.',
          enum: [
            'click_recorded',
            'navigation_completed',
            'element_focused',
            'no_op',
            'invalid_target',
            'target_disappeared',
            'navigation_failed',
            'rejected_by_safety',
            'unknown_failure',
          ],
        },
        historyRef: {
          type: 'string',
          description:
            'Optional Memory `historyRef` (e.g. the per-step ref returned by the Chrome extension). Persisted on the warning row when isolation fires so an operator can grep correlated logs.',
          maxLength: 256,
        },
        replayId: {
          type: 'string',
          description:
            'Optional Memory replay session id (`memory_sessions.session_id`). Same audit purpose as `historyRef`.',
          maxLength: 256,
        },
        evidence: {
          type: 'object',
          description:
            'Optional structured evidence. `code` is a short identifier (e.g. a `TabrixReplayFailureCode`); `message` is short free text. Both are bounded.',
          properties: {
            code: { type: 'string', maxLength: 128 },
            message: { type: 'string', maxLength: 512 },
          },
          additionalProperties: false,
        },
      },
      required: ['actionPathId', 'stepIndex', 'observedOutcome'],
    },
  },
];
