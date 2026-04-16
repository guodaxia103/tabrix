# Tabrix CLI Reference

## Executables

- `tabrix`: primary command-line interface.
- `tabrix-stdio`: stdio MCP server entrypoint.

## Remote Auth Reminder

- Remote mode (`0.0.0.0` / LAN) must include bearer-token auth.
- Manage token in extension `Token 管理` page.
- Token validity can be customized in `Token 管理` when refreshing.
- `MCP_AUTH_TOKEN_TTL` sets default token TTL (`0` means never expire).

## Primary Commands

| Command                     | Purpose                               | Typical Use                                        |
| --------------------------- | ------------------------------------- | -------------------------------------------------- |
| `tabrix setup`              | Guided first-time setup.              | New machine, first install.                        |
| `tabrix register`           | Register Native Messaging host.       | Manual registration/re-registration.               |
| `tabrix fix-permissions`    | Fix local execution permissions.      | Permission denied on scripts/host.                 |
| `tabrix update-port <port>` | Update stdio config port.             | Custom local MCP port alignment.                   |
| `tabrix status`             | Check local server runtime health.    | Fast sanity check before use.                      |
| `tabrix doctor`             | Diagnose installation/runtime issues. | Troubleshooting connectivity issues.               |
| `tabrix config`             | Print MCP client connection config.   | Copy local/remote/stdio config with current token. |
| `tabrix clients`            | Show MCP client connection state.     | Inspect active client groups and recent sessions.  |
| `tabrix smoke`              | Browser-path smoke test.              | End-to-end verification with Chrome.               |
| `tabrix stdio-smoke`        | Stdio transport smoke test.           | Verify stdio-only setup.                           |
| `tabrix report`             | Generate diagnostics report.          | Share reproducible issue context.                  |
| `tabrix daemon <action>`    | Manage daemon lifecycle.              | Long-running background service mode.              |

## Recommended Command Set

If you want one stable mental model, keep these commands in this order:

1. `tabrix setup`: first-time install and next steps.
2. `tabrix status`: quick health check.
3. `tabrix doctor --fix`: diagnose and auto-recover common issues.
4. `tabrix config`: print ready-to-copy MCP connection config.
5. `tabrix clients`: inspect who is currently connected.
6. `tabrix smoke`: verify the real browser path end to end.
7. `tabrix report --copy`: export context for issue filing.

Everything else should be treated as advanced or compatibility-oriented, not part of the default day-to-day command set.

## Important Options

- `tabrix register --browser <chrome|chromium|all>`: register specific browser targets.
- `tabrix register --detect`: auto-detect installed browser targets.
- `tabrix doctor --fix`: auto-fix common install/runtime issues.
- `tabrix report --copy`: copy Markdown diagnostics to clipboard.
- `tabrix report --output <file>`: write diagnostics to file.
- `tabrix status --json`: machine-readable status output.
- `tabrix config --json`: machine-readable MCP config output.
- `tabrix clients --json`: machine-readable client/session snapshot.
- `tabrix smoke --json`: machine-readable smoke output.
- `tabrix smoke --separate-window`: run smoke in a separate browser window instead of the default temporary tab in the current window.

## Advanced / Compatibility Commands

- `tabrix register`: keep for manual registration and re-registration.
- `tabrix fix-permissions`: keep as a focused recovery command when host or script permissions break.
- `tabrix update-port <port>`: keep as a low-frequency advanced command for custom port alignment.
- `tabrix stdio-smoke`: keep explicit because it validates a different transport path from normal browser smoke.
- `tabrix daemon <action>`: keep grouped under one namespace because it is operational, not daily interactive usage.

## Daemon Actions

- `tabrix daemon start`
- `tabrix daemon stop`
- `tabrix daemon status`
- `tabrix daemon install-autostart`
- `tabrix daemon remove-autostart`

## Quick Recipes

```bash
# 1) First install
tabrix setup

# 2) Verify everything
tabrix status
tabrix doctor
tabrix config
tabrix clients
tabrix smoke

# 3) Troubleshoot + share report
tabrix doctor --fix
tabrix report --copy
```
