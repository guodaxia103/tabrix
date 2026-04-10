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

| Command                     | Purpose                               | Typical Use                           |
| --------------------------- | ------------------------------------- | ------------------------------------- |
| `tabrix setup`              | Guided first-time setup.              | New machine, first install.           |
| `tabrix register`           | Register Native Messaging host.       | Manual registration/re-registration.  |
| `tabrix fix-permissions`    | Fix local execution permissions.      | Permission denied on scripts/host.    |
| `tabrix update-port <port>` | Update stdio config port.             | Custom local MCP port alignment.      |
| `tabrix status`             | Check local server runtime health.    | Fast sanity check before use.         |
| `tabrix doctor`             | Diagnose installation/runtime issues. | Troubleshooting connectivity issues.  |
| `tabrix smoke`              | Browser-path smoke test.              | End-to-end verification with Chrome.  |
| `tabrix stdio-smoke`        | Stdio transport smoke test.           | Verify stdio-only setup.              |
| `tabrix report`             | Generate diagnostics report.          | Share reproducible issue context.     |
| `tabrix daemon <action>`    | Manage daemon lifecycle.              | Long-running background service mode. |

## Important Options

- `tabrix register --browser <chrome|chromium|all>`: register specific browser targets.
- `tabrix register --detect`: auto-detect installed browser targets.
- `tabrix doctor --fix`: auto-fix common install/runtime issues.
- `tabrix report --copy`: copy Markdown diagnostics to clipboard.
- `tabrix report --output <file>`: write diagnostics to file.
- `tabrix status --json`: machine-readable status output.
- `tabrix smoke --json`: machine-readable smoke output.

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
tabrix smoke

# 3) Troubleshoot + share report
tabrix doctor --fix
tabrix report --copy
```
