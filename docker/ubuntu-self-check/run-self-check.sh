#!/usr/bin/env bash
set -euo pipefail

echo "[ubuntu-self-check] node: $(node -v)"
echo "[ubuntu-self-check] npm: $(npm -v)"
echo "[ubuntu-self-check] pnpm: $(pnpm -v)"
echo "[ubuntu-self-check] chrome: $(command -v google-chrome-stable || true)"

pnpm install --frozen-lockfile
pnpm --filter @tabrix/shared build
pnpm -C app/native-server build

REGISTER_OUTPUT="$(node app/native-server/dist/cli.js register --detect 2>&1)"
echo "[ubuntu-self-check] register output:"
echo "$REGISTER_OUTPUT"

MANIFEST_PATH="/etc/opt/chrome/native-messaging-hosts/com.tabrix.nativehost.json"
if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "[ubuntu-self-check] expected manifest not found: ${MANIFEST_PATH}" >&2
  exit 1
fi
echo "[ubuntu-self-check] manifest path: ${MANIFEST_PATH}"

set +e
node app/native-server/dist/cli.js doctor --json > /tmp/tabrix-doctor.json
DOCTOR_EXIT=$?
set -e
echo "[ubuntu-self-check] doctor exit code: ${DOCTOR_EXIT}"

node <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync('/tmp/tabrix-doctor.json', 'utf8'));
const findCheck = (id) => report.checks.find((check) => check.id === id);
const browserCheck = findCheck('browser.executable');
if (!browserCheck || browserCheck.status !== 'ok') {
  console.error('[ubuntu-self-check] browser.executable check is not ok');
  process.exit(1);
}
console.log('[ubuntu-self-check] doctor browser executable:', browserCheck.message);
NODE

node app/native-server/dist/cli.js daemon start
sleep 2
node app/native-server/dist/cli.js status --json > /tmp/tabrix-status.json

node <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/tabrix-status.json', 'utf8'));
if (payload.status !== 'ok') {
  console.error('[ubuntu-self-check] status payload is not ok');
  process.exit(1);
}
if (!payload.data || payload.data.port !== 12306) {
  console.error('[ubuntu-self-check] unexpected status payload port');
  process.exit(1);
}
if (!payload.data.isRunning) {
  console.error('[ubuntu-self-check] daemon-backed status is not running');
  process.exit(1);
}
console.log('[ubuntu-self-check] status bridge state:', payload.data.bridge?.bridgeState ?? 'unknown');
NODE

node app/native-server/dist/cli.js daemon stop
echo "[ubuntu-self-check] completed"
