/**
 * Data directory helpers for Tabrix native-server.
 *
 * Provides unified path resolution for MKEP layers (Memory, Knowledge,
 * Policy, Experience) and any other components that need to persist
 * state on the user's machine.
 *
 * Environment variable names are kept as CHROME_MCP_AGENT_* for
 * backwards compatibility with existing user installations that may
 * already have data under `~/.chrome-mcp-agent/`.
 */
import os from 'node:os';
import path from 'node:path';

const DEFAULT_DATA_DIR = path.join(os.homedir(), '.chrome-mcp-agent');

/**
 * Resolve the base data directory for Tabrix native-server state.
 *
 * Environment:
 * - CHROME_MCP_AGENT_DATA_DIR: overrides the default base directory.
 */
export function getTabrixDataDir(): string {
  const raw = process.env.CHROME_MCP_AGENT_DATA_DIR;
  if (raw && raw.trim()) {
    return path.resolve(raw.trim());
  }
  return DEFAULT_DATA_DIR;
}

/**
 * Legacy alias kept for backwards compatibility with existing consumers
 * (Memory layer, future migrations).
 *
 * @deprecated Prefer `getTabrixDataDir`. This alias will be removed
 * once all consumers migrate.
 */
export function getAgentDataDir(): string {
  return getTabrixDataDir();
}
