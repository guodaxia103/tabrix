import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';

const DEFAULT_EXTENSION_ID = 'njlidkjgkcccdoffkfcbgiefdpaipfdn';
const BROWSER_CONFIG_PATH = path.join(os.homedir(), '.tabrix', 'browser.json');
const CALLBACK_TIMEOUT_MS = 15_000;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function readUserExtensionId() {
  if (process.platform !== 'win32') return '';
  try {
    return execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "[Environment]::GetEnvironmentVariable('TABRIX_EXTENSION_ID','User')",
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

function resolveExtensionId() {
  return process.env.TABRIX_EXTENSION_ID?.trim() || readUserExtensionId() || DEFAULT_EXTENSION_ID;
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
    const finishWithPayload = (payloadRaw) => {
      res.statusCode = 204;
      res.end();

      if (!payloadRaw) {
        clearTimeout(timer);
        try {
          server.close();
        } catch {
          // ignore close failures after callback
        }
        rejectPayload(new Error('Extension reload callback did not include payload.'));
        return;
      }

      try {
        const parsed = JSON.parse(payloadRaw);
        if (parsed && typeof parsed === 'object' && parsed.status === 'pending') {
          return;
        }
        clearTimeout(timer);
        try {
          server.close();
        } catch {
          // ignore close failures after callback
        }
        resolvePayload(parsed);
      } catch (error) {
        clearTimeout(timer);
        try {
          server.close();
        } catch {
          // ignore close failures after callback
        }
        rejectPayload(error);
      }
    };

    if (req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        finishWithPayload(body);
      });
      req.on('error', (error) => {
        clearTimeout(timer);
        rejectPayload(error);
      });
      return;
    }

    finishWithPayload(url.searchParams.get('payload'));
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
  const extensionId = resolveExtensionId();
  const browserCommand = resolveBrowserCommand();
  const callbackSetup = await startCallbackServer();

  const reloadUrl = `chrome-extension://${extensionId}/connect.html?action=reload&callback=${encodeURIComponent(callbackSetup.callbackUrl)}`;

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
