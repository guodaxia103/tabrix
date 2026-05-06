import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './names';

export const CONTEXT_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.CONTEXT.CHOOSE,
    description:
      'Tabrix MKEP context selector. Given an `intent` (free text) and optional `url` / `pageRole` / `siteId`, deterministically pick which existing native asset to use as context: `experience_reuse` (a previously-successful action path), `knowledge_light` (captured site API catalog / endpoint evidence), or `read_page_required` (fallback: caller should issue `chrome_read_page`). Pure SELECT against local SQLite. Unsupported or uncertain inputs resolve to `read_page_required`.',
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
            'Caller intent in natural language. Trimmed and matched on the same normalized signature as `experience_suggest_plan`.intent so a hit there is also a hit here. Empty string is rejected.',
          minLength: 1,
          maxLength: 1024,
        },
        url: {
          type: 'string',
          description:
            'Optional URL of the page being reasoned about. Used only to derive a site family. Unparseable values are silently ignored (not an error) so a templating bug upstream cannot break selection.',
        },
        pageRole: {
          type: 'string',
          description:
            'Optional `pageRole` filter (e.g. `repo_home`, `issues_list`). Forwarded to the Experience lookup verbatim.',
          maxLength: 128,
        },
        siteId: {
          type: 'string',
          description:
            'Optional explicit site-family override. Currently only honours `"github"`; other values are ignored (URL-derived family is used instead).',
          enum: ['github'],
        },
      },
      required: ['intent'],
    },
  },
  {
    name: TOOL_NAMES.CONTEXT.RECORD_OUTCOME,
    description:
      "Outcome write-back for `tabrix_choose_context`. Closes the loop on whether the suggested strategy actually saved a `chrome_read_page` round-trip. Pure-INSERT P0: appends one telemetry row keyed by `decisionId` and never reads, mutates, or replays anything else. `outcome` is one of `'reuse'` (acted on the suggestion), `'fallback'` (had to fall back to `chrome_read_page` anyway), `'completed'` (the whole task completed on top of the suggestion), `'retried'` (re-issued `tabrix_choose_context`). Returns `{ status: 'unknown_decision' }` when the id has no matching row so the caller can distinguish a lost decision from a permission / transport error.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: {
          type: 'string',
          description:
            'Opaque decision id returned by a prior `tabrix_choose_context` call (`result.decisionId`). UUIDv4-shaped string; rejected when missing / empty / over 128 chars.',
          minLength: 1,
          maxLength: 128,
        },
        outcome: {
          type: 'string',
          description:
            'Closed outcome label: `reuse` | `fallback` | `completed` | `retried`. Anything else is rejected so aggregation in `release:choose-context-stats` stays deterministic.',
          enum: ['reuse', 'fallback', 'completed', 'retried'],
        },
      },
      required: ['decisionId', 'outcome'],
    },
  },
];
