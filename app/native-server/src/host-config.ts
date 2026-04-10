/**
 * Persistent host configuration stored at ~/.tabrix/config.json
 *
 * Priority for resolving listen host:
 *   1. MCP_HTTP_HOST environment variable (explicit override)
 *   2. config.json "host" field (user preference from extension toggle)
 *   3. Default: '127.0.0.1'
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.tabrix');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const ALLOWED_HOSTS = ['127.0.0.1', '0.0.0.0', 'localhost', '::'];

interface HostConfig {
  host?: string;
}

function readConfig(): HostConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw) as HostConfig;
  } catch {
    return {};
  }
}

function writeConfig(cfg: HostConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const existing = readConfig();
    const merged = { ...existing, ...cfg };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  } catch {
    // best-effort; if home dir is unwritable, fall back to in-memory
  }
}

export function getPersistedHost(): string | undefined {
  const cfg = readConfig();
  if (cfg.host && ALLOWED_HOSTS.includes(cfg.host)) return cfg.host;
  return undefined;
}

export function setPersistedHost(host: string): void {
  if (!ALLOWED_HOSTS.includes(host)) return;
  writeConfig({ host });
}
