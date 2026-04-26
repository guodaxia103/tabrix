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
let configFileOverride: string | null = null;

const ALLOWED_HOSTS = ['127.0.0.1', '0.0.0.0', 'localhost', '::'];

interface HostConfig {
  host?: string;
  policyCapabilities?: string;
}

function getConfigFile(): string {
  return configFileOverride ?? CONFIG_FILE;
}

function getConfigDir(): string {
  return path.dirname(getConfigFile());
}

function readConfig(): HostConfig {
  try {
    const configFile = getConfigFile();
    if (!fs.existsSync(configFile)) return {};
    const raw = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(raw) as HostConfig;
  } catch {
    return {};
  }
}

function writeConfig(cfg: HostConfig): void {
  try {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const existing = readConfig();
    const merged = { ...existing, ...cfg };
    fs.writeFileSync(getConfigFile(), JSON.stringify(merged, null, 2), 'utf8');
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

export function getPersistedPolicyCapabilities(): string | undefined {
  const cfg = readConfig();
  return typeof cfg.policyCapabilities === 'string' ? cfg.policyCapabilities : undefined;
}

export function setPersistedPolicyCapabilities(policyCapabilities: string): void {
  writeConfig({ policyCapabilities });
}

export const __hostConfigInternals = {
  setConfigFileForTesting(configFile: string | null): void {
    configFileOverride = configFile;
  },
};
