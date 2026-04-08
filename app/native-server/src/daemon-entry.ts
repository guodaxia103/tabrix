#!/usr/bin/env node

import serverInstance from './server';
import { NATIVE_SERVER_PORT } from './constant';

let shuttingDown = false;

function logError(label: string, err: unknown): void {
  const ts = new Date().toISOString();
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  const line = `[${ts}] ${label}: ${msg}\n`;
  try {
    process.stderr.write(line);
  } catch {
    // stderr may be closed; nothing we can do
  }
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await serverInstance.stop();
  } catch {
    // ignore shutdown errors
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const port = Number(process.env.CHROME_MCP_PORT || NATIVE_SERVER_PORT);
  process.stderr.write(`[${new Date().toISOString()}] daemon starting on port ${port}\n`);
  await serverInstance.start(port);
  process.stderr.write(`[${new Date().toISOString()}] daemon ready\n`);
}

main().catch(async (err) => {
  logError('main() failed', err);
  await shutdown(1);
});

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  void shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason);
  void shutdown(1);
});
