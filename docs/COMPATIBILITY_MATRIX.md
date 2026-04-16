# Tabrix Compatibility Matrix

This document explains the current public compatibility posture for MCP clients and common environments.

## Compatibility Labels

| Label | Meaning |
| --- | --- |
| `Primary` | Core public path and actively represented in docs |
| `Supported` | Expected to work with the documented configuration path |
| `Cautious` | Possible, but may require extra validation or environment-specific setup |

## MCP Client Compatibility

| Client / Surface | Transport | Status | Notes |
| --- | --- | --- | --- |
| Claude Desktop | Streamable HTTP | `Primary` | One of the main documented client paths |
| Cursor | Streamable HTTP | `Primary` | One of the main documented client paths |
| Claude Code CLI | HTTP config path | `Primary` | Clear command-based setup path |
| Codex CLI | HTTP config path | `Supported` | Public config guidance exists |
| Cherry Studio | Streamable HTTP | `Supported` | Public config guidance exists |
| Dify | Streamable HTTP | `Supported` | Works with environment-specific host addressing notes |
| Other MCP clients with Streamable HTTP support | Streamable HTTP | `Supported` | Usually workable if they follow normal MCP server URL configuration |
| Stdio-only or custom client environments | `stdio` | `Cautious` | Publicly important, but setup details vary more by client |

## Platform Compatibility

| Platform | Status | Notes |
| --- | --- | --- |
| Windows | `Primary` | Main public validation baseline |
| macOS | `Supported` | Use with normal caution; more real-machine validation remains helpful |
| Ubuntu / Linux | `Supported` | Use with normal caution; more real-machine validation remains helpful |

## Browser Compatibility

| Browser | Status | Notes |
| --- | --- | --- |
| Chrome | `Primary` | Main product surface |
| Chromium | `Supported` | Covered by setup and detection flows where available |

## Guidance

- For first success, prefer the documented `Streamable HTTP` path
- Treat Windows as the strongest current public baseline
- For deeper environment claims, verify against `TESTING.md` and `PLATFORM_SUPPORT.md`

## Related Docs

- `CLIENT_CONFIG_QUICKREF.md`
- `STABLE_QUICKSTART.md`
- `PLATFORM_SUPPORT.md`
- `TESTING.md`
