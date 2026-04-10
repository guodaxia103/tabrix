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
  tabrix doctor
  tabrix smoke

Common Workflows
  First install
    tabrix setup

  Diagnose and auto-fix
    tabrix doctor --fix
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
              'No supported browsers detected, will register for Chrome and Chromium',
              'yellow',
            ),
          );
          targetBrowsers = undefined; // Will use default behavior
        }
      }
      // If neither option specified, tryRegisterUserLevelHost will detect browsers

      // Detect if running with root/administrator privileges
      const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac

      const isAdmin = hasWindowsAdminRights();

      const hasElevatedPermissions = isRoot || isAdmin;

      // If --system option is specified or running with root/administrator privileges
      if (options.system || hasElevatedPermissions) {
        // TODO: Update registerWithElevatedPermissions to support multiple browsers
        await registerWithElevatedPermissions();
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
              'User-level registration failed, please try the following methods:',
              'yellow',
            ),
          );
          console.log(colorText('  1. sudo tabrix register', 'yellow'));
          console.log(colorText('  2. tabrix register --system', 'yellow'));
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
  .command('smoke')
  .description('Run a live browser smoke test against the local MCP server')
  .option('--json', 'Output smoke test results as JSON')
  .option('--keep-tab', 'Keep the temporary smoke-test tab open for inspection')
  .action(async (options) => {
    try {
      const exitCode = await runSmoke({
        json: Boolean(options.json),
        keepTab: Boolean(options.keepTab),
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
