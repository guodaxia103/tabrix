import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { NATIVE_SERVER_PORT } from '../constant';

interface DaemonStatus {
  running: boolean;
  pid: number | null;
  healthy: boolean;
}

const PID_DIR = path.join(os.homedir(), '.tabrix');
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

function resolvePort(): number {
  return Number(process.env.CHROME_MCP_PORT || NATIVE_SERVER_PORT);
}

async function checkHealth(): Promise<boolean> {
  try {
    const port = resolvePort();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: controller.signal });
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

  const logFile = path.join(PID_DIR, 'daemon.log');
  fs.mkdirSync(PID_DIR, { recursive: true });
  const logFd = fs.openSync(logFile, 'a');

  const child = spawn(process.execPath, [daemonEntry], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error('Failed to start daemon process.');
  }

  writePid(child.pid);
  return { started: true, pid: child.pid };
}

export async function daemonStop(): Promise<{
  stopped: boolean;
  pid: number | null;
  graceful: boolean;
}> {
  const pid = readPid();
  if (!pid) {
    return { stopped: false, pid: null, graceful: false };
  }
  if (!isProcessAlive(pid)) {
    clearPid();
    return { stopped: false, pid, graceful: false };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    clearPid();
    return { stopped: false, pid, graceful: false };
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      clearPid();
      return { stopped: true, pid, graceful: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already dead
  }

  await new Promise((r) => setTimeout(r, 300));
  const stillAlive = isProcessAlive(pid);
  clearPid();
  return { stopped: !stillAlive, pid, graceful: false };
}

const LAUNCHD_LABEL = 'com.tabrix.daemon';

function getLaunchdPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function getSystemdUnitPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configDir, 'systemd', 'user', 'tabrix.service');
}

function buildLaunchdPlist(nodePath: string, cliPath: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${LAUNCHD_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${nodePath}</string>`,
    `    <string>${cliPath}</string>`,
    '    <string>daemon</string>',
    '    <string>start</string>',
    '  </array>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><false/>',
    `  <key>StandardOutPath</key><string>${path.join(PID_DIR, 'daemon.log')}</string>`,
    `  <key>StandardErrorPath</key><string>${path.join(PID_DIR, 'daemon.log')}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function buildSystemdUnit(nodePath: string, cliPath: string): string {
  return [
    '[Unit]',
    'Description=MCP Chrome Bridge Daemon',
    'After=network.target',
    '',
    '[Service]',
    'Type=forking',
    `ExecStart=${nodePath} ${cliPath} daemon start`,
    `ExecStop=${nodePath} ${cliPath} daemon stop`,
    `PIDFile=${PID_FILE}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export function installDaemonAutostart(): void {
  const cliPath = path.resolve(resolveDistDir(), 'cli.js');
  const nodePath = process.execPath;

  if (process.platform === 'win32') {
    const command = `"${nodePath}" "${cliPath}" daemon start`;
    execFileSync(
      'schtasks',
      ['/create', '/tn', TASK_NAME, '/sc', 'onlogon', '/rl', 'LIMITED', '/tr', command, '/f'],
      { stdio: 'pipe', windowsHide: true },
    );
    return;
  }

  if (process.platform === 'darwin') {
    const plistPath = getLaunchdPlistPath();
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, buildLaunchdPlist(nodePath, cliPath), 'utf8');
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'pipe' });
    return;
  }

  const unitPath = getSystemdUnitPath();
  fs.mkdirSync(path.dirname(unitPath), { recursive: true });
  fs.writeFileSync(unitPath, buildSystemdUnit(nodePath, cliPath), 'utf8');
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  execFileSync('systemctl', ['--user', 'enable', 'tabrix.service'], {
    stdio: 'pipe',
  });
}

export function removeDaemonAutostart(): void {
  if (process.platform === 'win32') {
    execFileSync('schtasks', ['/delete', '/tn', TASK_NAME, '/f'], {
      stdio: 'pipe',
      windowsHide: true,
    });
    return;
  }

  if (process.platform === 'darwin') {
    const plistPath = getLaunchdPlistPath();
    if (fs.existsSync(plistPath)) {
      try {
        execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'pipe' });
      } catch {
        // may not be loaded
      }
      fs.unlinkSync(plistPath);
    }
    return;
  }

  try {
    execFileSync('systemctl', ['--user', 'disable', 'tabrix.service'], {
      stdio: 'pipe',
    });
  } catch {
    // may not be enabled
  }
  const unitPath = getSystemdUnitPath();
  if (fs.existsSync(unitPath)) {
    fs.unlinkSync(unitPath);
    try {
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
    } catch {
      // best effort
    }
  }
}
