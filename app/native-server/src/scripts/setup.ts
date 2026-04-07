/**
 * One-shot onboarding: register Native Messaging host and print next steps.
 * Goal: shortest path from `npm i -g mcp-chrome-bridge` to "load extension + connect".
 */
import fs from 'fs';
import path from 'path';
import { colorText, tryRegisterUserLevelHost, writeNodePathFile, getLogDir } from './utils';
import { detectInstalledBrowsers } from './browser-config';

const UPSTREAM_RELEASE = 'https://github.com/hangwin/mcp-chrome/releases';

export async function runSetup(): Promise<number> {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor < 20) {
    console.error(
      colorText(`Node.js 20+ required (found ${process.version}). Upgrade Node and retry.`, 'red'),
    );
    return 2;
  }

  console.log(colorText('mcp-chrome-bridge setup', 'blue'));
  console.log(colorText(`  Node ${process.version}`, 'green'));

  try {
    // Compiled to dist/scripts — bridge root is dist/
    writeNodePathFile(path.join(__dirname, '..'));

    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    console.log(colorText(`  Log dir: ${logDir}`, 'green'));

    const browsers = detectInstalledBrowsers();
    if (browsers.length > 0) {
      console.log(colorText(`  Detected browsers: ${browsers.join(', ')}`, 'green'));
    }

    console.log(colorText('  Registering Native Messaging host...', 'blue'));
    const ok = await tryRegisterUserLevelHost(browsers.length > 0 ? browsers : undefined);
    if (!ok) {
      console.error(
        colorText(
          'Registration failed. Try: sudo mcp-chrome-bridge register   or   mcp-chrome-bridge register --system',
          'yellow',
        ),
      );
      return 1;
    }

    console.log(colorText('  Native Messaging host registered.', 'green'));
    console.log('');
    console.log(colorText('Next steps (required):', 'blue'));
    console.log(`  1) Download the Chrome extension (CRX or unpacked) from:`);
    console.log(`     ${UPSTREAM_RELEASE}`);
    console.log(`  2) Chrome → chrome://extensions → Developer mode → Load unpacked`);
    console.log(`  3) Open the extension popup → Connect / Start server`);
    console.log(`  4) In your AI client, point MCP to: http://127.0.0.1:12306/mcp (default port)`);
    console.log('');
    console.log(colorText('Verify:', 'blue'));
    console.log(`  mcp-chrome-bridge doctor`);
    console.log(`  mcp-chrome-bridge smoke`);
    return 0;
  } catch (e: any) {
    console.error(colorText(`Setup failed: ${e?.message ?? e}`, 'red'));
    return 1;
  }
}
