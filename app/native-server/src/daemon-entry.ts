#!/usr/bin/env node

import serverInstance from './server';
import { NATIVE_SERVER_PORT } from './constant';

let shuttingDown = false;

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
  await serverInstance.start(port);
}

main().catch(async () => {
  await shutdown(1);
});

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

process.on('uncaughtException', () => {
  void shutdown(1);
});

process.on('unhandledRejection', () => {
  void shutdown(1);
});
