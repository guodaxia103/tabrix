#!/usr/bin/env bash
set -euo pipefail

echo "[ubuntu-xvfb-self-check] node: $(node -v)"
echo "[ubuntu-xvfb-self-check] npm: $(npm -v)"
echo "[ubuntu-xvfb-self-check] pnpm: $(pnpm -v)"
echo "[ubuntu-xvfb-self-check] chrome: $(command -v google-chrome-stable || true)"

pnpm install --frozen-lockfile
pnpm --filter @tabrix/shared build
pnpm -C app/native-server build

REGISTER_OUTPUT="$(node app/native-server/dist/cli.js register --detect 2>&1)"
echo "[ubuntu-xvfb-self-check] register output:"
echo "$REGISTER_OUTPUT"

node app/native-server/dist/cli.js doctor --json > /tmp/tabrix-doctor.json
node <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('/tmp/tabrix-doctor.json', 'utf8'));
const findCheck = (id) => report.checks.find((check) => check.id === id);
const browserCheck = findCheck('browser.executable');
if (!browserCheck || browserCheck.status !== 'ok') {
  console.error('[ubuntu-xvfb-self-check] browser.executable check is not ok');
  process.exit(1);
}
console.log('[ubuntu-xvfb-self-check] doctor browser executable:', browserCheck.message);
NODE

echo "[ubuntu-xvfb-self-check] launching Chrome under Xvfb"
XVFB_DISPLAY=":99"
export DISPLAY="${XVFB_DISPLAY}"
Xvfb "${XVFB_DISPLAY}" -screen 0 1440x900x24 >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
cleanup() {
  if [[ -n "${CHROME_PID:-}" ]]; then
    kill "${CHROME_PID}" >/dev/null 2>&1 || true
  fi
  kill "${XVFB_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
sleep 2

google-chrome-stable \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --no-sandbox \
  --user-data-dir=/tmp/tabrix-xvfb-profile \
  --new-window \
  about:blank >/tmp/chrome.log 2>&1 &
CHROME_PID=$!
sleep 4

if ! ps -p "${CHROME_PID}" >/dev/null 2>&1; then
  echo "[ubuntu-xvfb-self-check] chrome failed to stay alive under Xvfb" >&2
  cat /tmp/chrome.log >&2 || true
  exit 1
fi

echo "[ubuntu-xvfb-self-check] chrome launched successfully under Xvfb with pid=${CHROME_PID}"

kill "${CHROME_PID}" >/dev/null 2>&1 || true
wait "${CHROME_PID}" 2>/dev/null || true
unset CHROME_PID

echo "[ubuntu-xvfb-self-check] completed"
