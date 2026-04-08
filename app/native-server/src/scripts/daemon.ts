import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

interface DaemonStatus {
  running: boolean;
  pid: number | null;
  healthy: boolean;
}

const PID_DIR = path.join(os.homedir(), '.mcp-chrome');
const PID_FILE = path.join(PID_DIR, 'daemon.pid');
const TASK_NAME = 'McpChromeBridgeDaemon';

function resolveDistDir(): string {
  return path.resolve(__dirname, '..');
}

function resolveDaemonEntryPath(): string {
  return path.resolve(resolveDistDir(), 'daemon-entry.js');
}

function readPid(): number | null {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  fs.mkdirSync(PID_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(pid), 'utf8');
}

function clearPid(): void {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://127.0.0.1:12306/ping', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function daemonStatus(): Promise<DaemonStatus> {
  const pid = readPid();
  if (!pid || !isProcessAlive(pid)) {
    if (pid) clearPid();
    return { running: false, pid: null, healthy: await checkHealth() };
  }
  return { running: true, pid, healthy: await checkHealth() };
}

export async function daemonStart(): Promise<{ started: boolean; pid: number }> {
  const current = await daemonStatus();
  if (current.running && current.pid) {
    return { started: false, pid: current.pid };
  }

  const daemonEntry = resolveDaemonEntryPath();
  if (!fs.existsSync(daemonEntry)) {
    throw new Error(`Daemon entry not found: ${daemonEntry}. Please run build first.`);
  }

  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();

  if (!child.pid) {
    throw new Error('Failed to start daemon process.');
  }

  writePid(child.pid);
  return { started: true, pid: child.pid };
}

export async function daemonStop(): Promise<{ stopped: boolean; pid: number | null }> {
  const pid = readPid();
  if (!pid) {
    return { stopped: false, pid: null };
  }
  if (!isProcessAlive(pid)) {
    clearPid();
    return { stopped: false, pid };
  }
  process.kill(pid);
  clearPid();
  return { stopped: true, pid };
}

export function installDaemonAutostart(): void {
  if (process.platform !== 'win32') {
    throw new Error('Autostart installation is currently supported on Windows only.');
  }
  const cliPath = path.resolve(resolveDistDir(), 'cli.js');
  const command = `"${process.execPath}" "${cliPath}" daemon start`;
  execFileSync(
    'schtasks',
    ['/create', '/tn', TASK_NAME, '/sc', 'onlogon', '/rl', 'LIMITED', '/tr', command, '/f'],
    { stdio: 'pipe', windowsHide: true },
  );
}

export function removeDaemonAutostart(): void {
  if (process.platform !== 'win32') {
    throw new Error('Autostart removal is currently supported on Windows only.');
  }
  execFileSync('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], {
    stdio: 'pipe',
    windowsHide: true,
  });
}
