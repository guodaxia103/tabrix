/**
 * TokenManager — handles auth token lifecycle for remote MCP access.
 *
 * Token resolution priority:
 *   1. MCP_AUTH_TOKEN environment variable (always wins)
 *   2. Persisted file at ~/.mcp-chrome/auth-token.json
 *   3. Auto-generated on first use when listening on 0.0.0.0
 *
 * Tokens have an optional TTL (default 7 days, configurable via
 * MCP_AUTH_TOKEN_TTL env var in days; 0 = never expire).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'node:crypto';

const TOKEN_DIR = path.join(os.homedir(), '.mcp-chrome');
const TOKEN_FILE = path.join(TOKEN_DIR, 'auth-token.json');
const DEFAULT_TTL_DAYS = 7;

export interface TokenData {
  token: string;
  createdAt: number;
  expiresAt: number | null;
  /** Days used when this token was generated (0 = never expire). Persisted for display / next refresh default. */
  ttlDays?: number;
}

const MAX_TTL_DAYS = 3650;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeTtlDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_DAYS;
  return Math.min(MAX_TTL_DAYS, Math.floor(n));
}

function getTtlDays(): number {
  const raw = process.env.MCP_AUTH_TOKEN_TTL;
  if (raw === undefined || raw === '') return DEFAULT_TTL_DAYS;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_TTL_DAYS;
}

function computeExpiresAt(createdAt: number, days: number): number | null {
  if (days === 0) return null;
  return createdAt + days * MS_PER_DAY;
}

class TokenManager {
  private data: TokenData | null = null;

  private envToken(): string | undefined {
    return process.env.MCP_AUTH_TOKEN || undefined;
  }

  private loadFromFile(): TokenData | null {
    try {
      if (!fs.existsSync(TOKEN_FILE)) return null;
      const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
      const parsed = JSON.parse(raw) as TokenData;
      if (typeof parsed.token !== 'string' || !parsed.token) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveToFile(data: TokenData): void {
    try {
      fs.mkdirSync(TOKEN_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Best effort — if home dir is read-only, token still works in memory
    }
  }

  /**
   * @param ttlDaysOverride if set, use this many days (0 = never expire). Otherwise use MCP_AUTH_TOKEN_TTL / default.
   */
  generate(ttlDaysOverride?: number): TokenData {
    const now = Date.now();
    const days = ttlDaysOverride !== undefined ? normalizeTtlDays(ttlDaysOverride) : getTtlDays();
    const data: TokenData = {
      token: randomUUID(),
      createdAt: now,
      expiresAt: computeExpiresAt(now, days),
      ttlDays: days,
    };
    this.data = data;
    this.saveToFile(data);
    return data;
  }

  /**
   * Load or create a token. Call once at server startup.
   * If MCP_AUTH_TOKEN env var is set, it always takes precedence.
   */
  resolve(): TokenData {
    const env = this.envToken();
    if (env) {
      const now = Date.now();
      this.data = { token: env, createdAt: now, expiresAt: null };
      return this.data;
    }

    const fromFile = this.loadFromFile();
    if (fromFile) {
      this.data = fromFile;
      return this.data;
    }

    return this.generate();
  }

  /** Refresh: generate a new token, invalidating the old one. */
  refresh(ttlDays?: number): TokenData {
    if (this.envToken()) {
      throw new Error('Cannot refresh token when MCP_AUTH_TOKEN environment variable is set.');
    }
    return ttlDays !== undefined ? this.generate(ttlDays) : this.generate();
  }

  /** Get current token data, or null if not yet resolved. */
  current(): TokenData | null {
    return this.data;
  }

  get enabled(): boolean {
    return this.data !== null;
  }

  get token(): string | undefined {
    return this.data?.token;
  }

  isExpired(): boolean {
    if (!this.data) return true;
    if (this.data.expiresAt === null) return false;
    return Date.now() > this.data.expiresAt;
  }

  /** Verify a bearer token. Returns 'ok' | 'expired' | 'invalid'. */
  verify(bearerToken: string): 'ok' | 'expired' | 'invalid' {
    if (!this.data) return 'invalid';
    if (bearerToken !== this.data.token) return 'invalid';
    if (this.isExpired()) return 'expired';
    return 'ok';
  }

  /** Get a sanitized view for API responses. */
  info(): {
    token: string;
    createdAt: number;
    expiresAt: number | null;
    fromEnv: boolean;
    ttlDays: number | null;
  } | null {
    if (!this.data) return null;
    const fromEnv = !!this.envToken();
    let ttlDays: number | null = null;
    if (!fromEnv) {
      if (this.data.ttlDays !== undefined) {
        ttlDays = this.data.ttlDays;
      } else if (this.data.expiresAt !== null) {
        const span = this.data.expiresAt - this.data.createdAt;
        ttlDays = Math.round(span / MS_PER_DAY);
      } else {
        ttlDays = 0;
      }
    }
    return {
      token: this.data.token,
      createdAt: this.data.createdAt,
      expiresAt: this.data.expiresAt,
      fromEnv,
      ttlDays,
    };
  }
}

export const tokenManager = new TokenManager();
