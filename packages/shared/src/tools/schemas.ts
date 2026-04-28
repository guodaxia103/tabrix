import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { BROWSER_SCHEMAS } from './schemas-browser';
import { EXPERIENCE_SCHEMAS } from './schemas-experience';
import { CONTEXT_SCHEMAS } from './schemas-context';

export const TOOL_SCHEMAS: Tool[] = [...BROWSER_SCHEMAS, ...EXPERIENCE_SCHEMAS, ...CONTEXT_SCHEMAS];
