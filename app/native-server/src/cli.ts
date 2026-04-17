#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  tryRegisterUserLevelHost,
  colorText,
  registerWithElevatedPermissions,
  ensureExecutionPermissions,
  writeNodePathFile,
} from './scripts/utils';
import { BrowserType, parseBrowserType, detectInstalledBrowsers } from './scripts/browser-config';
import { runDoctor } from './scripts/doctor';
import { runReport } from './scripts/report';
import { runStatus } from './scripts/status';
import { runConfig } from './scripts/config';
import { runClients } from './scripts/clients';
import { runMcpCall, runMcpTools } from './scripts/mcp-inspect';
import { runSmoke } from './scripts/smoke';
import { runStdioSmoke } from './scripts/stdio-smoke';
import { runSetup } from './scripts/setup';
import {
  daemonStart,
  daemonStatus,
  daemonStop,
  installDaemonAutostart,
  removeDaemonAutostart,
} from './scripts/daemon';

const VALID_COMMAND_CHANNEL_RECOVERY_MODES = [
  'fail-next-send',
  'fail-all-sends',
  'unavailable',
] as const;
type CommandChannelRecoveryMode = (typeof VALID_COMMAND_CHANNEL_RECOVERY_MODES)[number];

function parseCommandChannelRecoveryMode(rawMode: unknown): CommandChannelRecoveryMode | undefined {
  if (typeof rawMode !== 'string') return undefined;
  const normalized = rawMode.trim();
  return (
    VALID_COMMAND_CHANNEL_RECOVERY_MODES.includes(normalized as CommandChannelRecoveryMode)
      ? normalized
      : undefined
  ) as CommandChannelRecoveryMode | undefined;
}

function hasWindowsAdminRights(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    execSync('fltmc', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

program
  .name('tabrix')
  .version(require('../package.json').version)
  .usage('<command> [options]')
  .showSuggestionAfterError()
  .showHelpAfterError('\nRun `tabrix --help` to view all commands.')
  .description('Tabrix CLI - local MCP bridge service for the Tabrix Chrome extension');

program.addHelpText(
  'after',
  `
Quick Start
  tabrix setup
  tabrix status
  tabrix doctor --fix
  tabrix config
  tabrix clients
  tabrix mcp tools
  tabrix mcp call get_windows_and_tabs
  tabrix smoke

Common Workflows
  First install
    tabrix setup

  Diagnose, inspect, and auto-fix
    tabrix doctor --fix
    tabrix config
    tabrix clients
    tabrix mcp tools
    tabrix report --copy

  Daemon mode
    tabrix daemon start
    tabrix daemon status
    tabrix daemon stop
`,
);

// Guided first-time setup (register + next steps)
program
  .command('setup')
  .description('Register Native Messaging host and print extension / MCP next steps')
  .action(async () => {
    const code = await runSetup();
    process.exit(code);
  });

// Register Native Messaging host
program
  .command('register')
  .description('Register Native Messaging host')
  .option('-f, --force', 'Force re-registration')
  .option('-s, --system', 'Use system-level installation (requires administrator/sudo privileges)')
  .option('-b, --browser <browser>', 'Register for specific browser (chrome, chromium, or all)')
  .option('-d, --detect', 'Auto-detect installed browsers')
  .action(async (options) => {
    try {
      // Write Node.js path for run_host scripts
      writeNodePathFile(__dirname);

      // Determine which browsers to register
      let targetBrowsers: BrowserType[] | undefined;

      if (options.browser) {
        if (options.browser.toLowerCase() === 'all') {
          targetBrowsers = [BrowserType.CHROME, BrowserType.CHROMIUM];
          console.log(colorText('Registering for all supported browsers...', 'blue'));
        } else {
          const browserType = parseBrowserType(options.browser);
          if (!browserType) {
            console.error(
              colorText(
                `Invalid browser: ${options.browser}. Use 'chrome', 'chromium', or 'all'`,
                'red',
              ),
            );
            process.exit(1);
          }
          targetBrowsers = [browserType];
        }
      } else if (options.detect) {
        targetBrowsers = detectInstalledBrowsers();
        if (targetBrowsers.length === 0) {
          console.log(
            colorText(
              'No supported Chrome/Chromium executable detected. Registration will stop until a supported browser is installed.',
              'yellow',
            ),
          );
          targetBrowsers = [];
        }
      }
      // If neither option specified, tryRegisterUserLevelHost will detect browsers

      // Detect if running with root/administrator privileges
      const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac

      const isAdmin = hasWindowsAdminRights();

      const hasElevatedPermissions = isRoot || isAdmin;

      // If --system option is specified or running with root/administrator privileges
      if (options.system || hasElevatedPermissions) {
        await registerWithElevatedPermissions(targetBrowsers);
        console.log(
          colorText('System-level Native Messaging host registered successfully!', 'green'),
        );
        console.log(
          colorText(
            'You can now use connectNative in Chrome extension to connect to this service.',
            'blue',
          ),
        );
      } else {
        // Regular user-level installation
        console.log(colorText('Registering user-level Native Messaging host...', 'blue'));
        const success = await tryRegisterUserLevelHost(targetBrowsers);

        if (success) {
          console.log(colorText('Native Messaging host registered successfully!', 'green'));
          console.log(
            colorText(
              'You can now use connectNative in Chrome extension to connect to this service.',
              'blue',
            ),
          );
        } else {
          console.log(
            colorText(
              'User-level registration did not complete. If Chrome/Chromium is not installed yet, install one first.',
              'yellow',
            ),
          );
          console.log(colorText('  1. tabrix register', 'yellow'));
          console.log(colorText('  2. tabrix doctor --fix', 'yellow'));
          console.log(colorText('  3. tabrix register --system', 'yellow'));
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(colorText(`Registration failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Fix execution permissions
program
  .command('fix-permissions')
  .description('Fix execution permissions for native host files')
  .action(async () => {
    try {
      console.log(colorText('Fixing execution permissions...', 'blue'));
      await ensureExecutionPermissions();
      console.log(colorText('✓ Execution permissions fixed successfully!', 'green'));
    } catch (error: any) {
      console.error(colorText(`Failed to fix permissions: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Update port in stdio-config.json
program
  .command('update-port <port>')
  .description('Update the port number in stdio-config.json')
  .action(async (port: string) => {
    try {
      const portNumber = parseInt(port, 10);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        console.error(colorText('Error: Port must be a valid number between 1 and 65535', 'red'));
        process.exit(1);
      }

      const configPath = path.join(__dirname, 'mcp', 'stdio-config.json');

      if (!fs.existsSync(configPath)) {
        console.error(colorText(`Error: Configuration file not found at ${configPath}`, 'red'));
        process.exit(1);
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      const currentUrl = new URL(config.url);
      currentUrl.port = portNumber.toString();
      config.url = currentUrl.toString();

      fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

      console.log(colorText(`✓ Port updated successfully to ${portNumber}`, 'green'));
      console.log(colorText(`Updated URL: ${config.url}`, 'blue'));
    } catch (error: any) {
      console.error(colorText(`Failed to update port: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Diagnose installation and environment issues
program
  .command('doctor')
  .description('Diagnose installation and environment issues')
  .option('--json', 'Output diagnostics as JSON')
  .option('--fix', 'Attempt to fix common issues automatically')
  .option('-b, --browser <browser>', 'Target browser (chrome, chromium, or all)')
  .action(async (options) => {
    try {
      const exitCode = await runDoctor({
        json: Boolean(options.json),
        fix: Boolean(options.fix),
        browser: options.browser,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Doctor failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Export diagnostic report for GitHub Issues
program
  .command('report')
  .description('Export a diagnostic report for GitHub Issues')
  .option('--json', 'Output report as JSON (default: Markdown)')
  .option('--output <file>', 'Write report to file instead of stdout')
  .option('--copy', 'Copy report to clipboard')
  .option('--no-redact', 'Disable redaction of usernames/paths/tokens')
  .option('--include-logs <mode>', 'Include wrapper logs: none | tail | full', 'tail')
  .option('--log-lines <n>', 'Lines to include when --include-logs=tail', '200')
  .option('-b, --browser <browser>', 'Target browser (chrome, chromium, or all)')
  .action(async (options) => {
    try {
      const exitCode = await runReport({
        json: Boolean(options.json),
        output: options.output,
        copy: Boolean(options.copy),
        redact: options.redact,
        includeLogs: options.includeLogs,
        logLines: options.logLines ? parseInt(options.logLines, 10) : undefined,
        browser: options.browser,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Report failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// Quick runtime status
program
  .command('status')
  .description('Show local MCP server runtime status')
  .option('--json', 'Output status as JSON')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '1500')
  .action(async (options) => {
    try {
      const exitCode = await runStatus({
        json: Boolean(options.json),
        timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Status failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show current MCP client connection config (local, remote, stdio, token)')
  .option('--json', 'Output config as JSON')
  .action(async (options) => {
    try {
      const exitCode = await runConfig({
        json: Boolean(options.json),
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Config failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program
  .command('clients')
  .description('Show active MCP client groups and recent transport sessions')
  .option('--json', 'Output clients snapshot as JSON')
  .action(async (options) => {
    try {
      const exitCode = await runClients({
        json: Boolean(options.json),
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Clients failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

const mcpCommand = program.command('mcp').description('Inspect the local or remote MCP endpoint');

mcpCommand.addHelpText(
  'after',
  `
Examples
  List tools from the local Tabrix MCP runtime
    tabrix mcp tools

  Inspect a GitHub repo page in the current browser session
    tabrix mcp call chrome_read_page --args '{"tabId":1850319377,"filter":"interactive","depth":2}'

  Triage a remote Tabrix MCP endpoint over LAN
    tabrix mcp tools --url http://192.168.1.50:12306/mcp --auth-token <token>
`,
);

mcpCommand
  .command('tools')
  .description('List tools exposed by the target Streamable HTTP MCP endpoint')
  .option('--json', 'Output tools as JSON')
  .option('--url <mcp-url>', 'Target MCP endpoint URL (default: current local Tabrix MCP URL)')
  .option('--auth-token <token>', 'Bearer token for remote MCP endpoints')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '15000')
  .action(async (options) => {
    try {
      const exitCode = await runMcpTools({
        json: Boolean(options.json),
        url: options.url,
        authToken: options.authToken,
        timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`MCP tools failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

mcpCommand
  .command('call <toolName>')
  .description('Call a tool on the target Streamable HTTP MCP endpoint')
  .option('--args <json>', 'Tool arguments as a JSON object string', '{}')
  .option('--json', 'Output result as JSON')
  .option('--url <mcp-url>', 'Target MCP endpoint URL (default: current local Tabrix MCP URL)')
  .option('--auth-token <token>', 'Bearer token for remote MCP endpoints')
  .option('--timeout <ms>', 'Request timeout in milliseconds', '30000')
  .action(async (toolName: string, options) => {
    try {
      const exitCode = await runMcpCall(toolName, {
        args: options.args,
        json: Boolean(options.json),
        url: options.url,
        authToken: options.authToken,
        timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`MCP call failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program
  .command('smoke')
  .description(
    'Run smoke tests against local browser control or a remote Streamable HTTP MCP endpoint',
  )
  .option('--json', 'Output smoke test results as JSON')
  .option('--keep-tab', 'Keep the temporary smoke-test tab open for inspection')
  .option(
    '--separate-window',
    'Open the smoke page in a separate browser window instead of the default temporary tab',
  )
  .option('--all-tools', 'Run extended full-tool validation (local mode only)')
  .option('--bridge-recovery', 'Inject a bridge recovery fault and validate recovery semantics')
  .option(
    '--command-channel-recovery <mode>',
    'Inject a command-channel fault mode: fail-next-send | fail-all-sends | unavailable',
  )
  .option(
    '--browser-path-unavailable',
    'Inject an unavailable browser launch candidate and validate recovery failure semantics',
  )
  .option(
    '--include-interactive-tools',
    'Include modal/download checks that may require browser-level auto-save settings',
  )
  .option('--url <mcp-url>', 'Target MCP endpoint URL (for example http://127.0.0.1:12306/mcp)')
  .option('--auth-token <token>', 'Bearer token for remote MCP endpoints')
  .option(
    '--protocol-only',
    'Only run MCP transport baseline checks (initialize/tools/list/tools/call)',
  )
  .option(
    '--repeat <n>',
    'Repeat protocol smoke N times (use with remote Streamable HTTP stability checks)',
    '1',
  )
  .option('--concurrency <n>', 'Run protocol smoke with N concurrent attempts', '1')
  .action(async (options) => {
    try {
      const commandChannelRecovery = parseCommandChannelRecoveryMode(
        options.commandChannelRecovery,
      );
      if (options.commandChannelRecovery && !commandChannelRecovery) {
        throw new Error(
          `Unsupported value for --command-channel-recovery: ${options.commandChannelRecovery}.` +
            ` Supported values: ${VALID_COMMAND_CHANNEL_RECOVERY_MODES.join(' | ')}`,
        );
      }

      const exitCode = await runSmoke({
        json: Boolean(options.json),
        keepTab: Boolean(options.keepTab),
        separateWindow: Boolean(options.separateWindow),
        allTools: Boolean(options.allTools),
        bridgeRecovery: Boolean(options.bridgeRecovery),
        browserPathUnavailable: Boolean(options.browserPathUnavailable),
        includeInteractiveTools: options.includeInteractiveTools === true,
        url: options.url,
        authToken: options.authToken,
        protocolOnly: Boolean(options.protocolOnly),
        commandChannelRecovery,
        repeat: options.repeat ? parseInt(options.repeat, 10) : undefined,
        concurrency: options.concurrency ? parseInt(options.concurrency, 10) : undefined,
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(colorText(`Smoke test failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program
  .command('stdio-smoke')
  .description('Run a smoke test against the stdio MCP transport (no HTTP server needed)')
  .option('--json', 'Output results as JSON')
  .action(async (options) => {
    try {
      const exitCode = await runStdioSmoke({
        json: Boolean(options.json),
      });
      process.exit(exitCode);
    } catch (error: any) {
      console.error(`Stdio smoke test failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('daemon')
  .description('Manage standalone MCP daemon process')
  .argument('<action>', 'start | stop | status | install-autostart | remove-autostart')
  .action(async (action: string) => {
    try {
      switch (action) {
        case 'start': {
          const result = await daemonStart();
          if (result.started) {
            console.log(colorText(`Daemon started (pid=${result.pid})`, 'green'));
          } else {
            console.log(colorText(`Daemon already running (pid=${result.pid})`, 'blue'));
          }
          break;
        }
        case 'stop': {
          const result = await daemonStop();
          if (result.stopped && result.graceful) {
            console.log(colorText(`Daemon stopped gracefully (pid=${result.pid})`, 'green'));
          } else if (result.stopped) {
            console.log(colorText(`Daemon force-killed (pid=${result.pid})`, 'yellow'));
          } else {
            console.log(colorText('Daemon is not running', 'yellow'));
          }
          break;
        }
        case 'status': {
          const result = await daemonStatus();
          const state = result.running ? 'running' : 'stopped';
          const health = result.healthy ? 'healthy' : 'unhealthy';
          console.log(
            colorText(`Daemon ${state} (${health})`, result.running ? 'green' : 'yellow'),
          );
          if (result.pid) {
            console.log(colorText(`PID: ${result.pid}`, 'blue'));
          }
          break;
        }
        case 'install-autostart': {
          installDaemonAutostart();
          console.log(colorText('Installed daemon autostart task', 'green'));
          break;
        }
        case 'remove-autostart': {
          removeDaemonAutostart();
          console.log(colorText('Removed daemon autostart task', 'green'));
          break;
        }
        default:
          console.error(
            colorText(
              `Invalid daemon action: ${action}. Use start|stop|status|install-autostart|remove-autostart`,
              'red',
            ),
          );
          process.exit(1);
      }
    } catch (error: any) {
      console.error(colorText(`Daemon command failed: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
