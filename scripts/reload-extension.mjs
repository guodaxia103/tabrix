import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const STABLE_EXTENSION_ID = process.env.TABRIX_EXTENSION_ID || 'njlidkjgkcccdoffkfcbgiefdpaipfdn';
const BROWSER_CONFIG_PATH = path.join(os.homedir(), '.tabrix', 'browser.json');
const CALLBACK_TIMEOUT_MS = 15_000;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readPersistedBrowserPath() {
  try {
    if (!fs.existsSync(BROWSER_CONFIG_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(BROWSER_CONFIG_PATH, 'utf8'));
    return typeof parsed?.executablePath === 'string' && parsed.executablePath.trim()
      ? parsed.executablePath
      : null;
  } catch {
    return null;
  }
}

function getBrowserCandidates() {
  const candidates = [];
  const persisted = readPersistedBrowserPath();
  if (persisted) candidates.push(persisted);

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'chrome.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(
        os.homedir(),
        'Applications',
        'Google Chrome.app',
        'Contents',
        'MacOS',
        'Google Chrome',
      ),
      'google-chrome',
    );
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }

  return [...new Set(candidates)];
}

function resolveBrowserCommand() {
  for (const candidate of getBrowserCandidates()) {
    if (!path.isAbsolute(candidate) || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No usable browser executable found. Checked: ${getBrowserCandidates().join(', ')}`,
  );
}

async function startCallbackServer() {
  const server = http.createServer();

  let resolvePayload;
  let rejectPayload;
  const resultPromise = new Promise((resolve, reject) => {
    resolvePayload = resolve;
    rejectPayload = reject;
  });

  const timer = setTimeout(() => {
    try {
      server.close();
    } catch {
      // ignore close failures during timeout handling
    }
    rejectPayload(
      new Error(
        'Timed out waiting for extension reload callback. Ensure Chrome is running and Tabrix is already loaded.',
      ),
    );
  }, CALLBACK_TIMEOUT_MS);

  server.on('request', (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const payloadRaw = url.searchParams.get('payload');
    res.statusCode = 204;
    res.end();
    clearTimeout(timer);
    try {
      server.close();
    } catch {
      // ignore close failures after callback
    }

    if (!payloadRaw) {
      rejectPayload(new Error('Extension reload callback did not include payload.'));
      return;
    }

    try {
      resolvePayload(JSON.parse(payloadRaw));
    } catch (error) {
      rejectPayload(error);
    }
  });

  server.on('error', (error) => {
    clearTimeout(timer);
    rejectPayload(error);
  });

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    clearTimeout(timer);
    try {
      server.close();
    } catch {
      // ignore
    }
    throw new Error('Failed to allocate callback listener.');
  }

  return {
    callbackUrl: `http://127.0.0.1:${address.port}/`,
    resultPromise,
  };
}

async function main() {
  const browserCommand = resolveBrowserCommand();
  const callbackSetup = await startCallbackServer();

  const reloadUrl = `chrome-extension://${STABLE_EXTENSION_ID}/connect.html?action=reload&callback=${encodeURIComponent(callbackSetup.callbackUrl)}`;

  const child = spawn(browserCommand, ['--new-tab', reloadUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  log(`tabrix extension reload: launched ${browserCommand}`);
  log(`tabrix extension reload: waiting for callback from ${reloadUrl}`);

  const payload = await callbackSetup.resultPromise;
  log(`tabrix extension reload: ${JSON.stringify(payload)}`);
}

main().catch((error) => {
  process.stderr.write(
    `tabrix extension reload failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
