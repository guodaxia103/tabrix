# Error Code Reference

This document maps the public Tabrix error-code families to the modules that
emit them. It is a troubleshooting aid, not a release-readiness report.

## Naming Families

| Family           | Source area                                  | Typical use                                                 |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `CONN_*`         | Chrome extension and Native Messaging bridge | Extension-to-native connection failures                     |
| `MCP_*`          | Native server MCP routes                     | Session, request, and server-side MCP failures              |
| `TOOL_*`         | Browser tool execution                       | Tool dispatch, validation, and browser execution failures   |
| `HTTP_*`         | Native server HTTP layer                     | HTTP status and route-level failures                        |
| `CLI_*`          | CLI scripts                                  | `doctor`, `smoke`, `register`, and release-gate diagnostics |
| `dynamic_flow_*` | Legacy dynamic-flow proxy                    | Compatibility errors for old flow proxy paths               |

## Connection Errors

Source files:

- `app/native-server/src/constant/index.ts` (`ERROR_MESSAGES`)
- `app/chrome-extension/common/constants.ts` (`ERROR_MESSAGES`)

| Constant                    | Message                                   | When it appears                                                                                     |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `NATIVE_HOST_NOT_AVAILABLE` | `Native host connection not established.` | The native server receives a browser-bound request before the Native Messaging bridge is available. |
| `NATIVE_CONNECTION_FAILED`  | `Failed to connect to native host`        | The extension cannot connect to the registered native host.                                         |
| `NATIVE_DISCONNECTED`       | `Native connection disconnected`          | The native host process exits or the bridge disconnects.                                            |
| `SERVER_STATUS_LOAD_FAILED` | `Failed to load server status`            | Extension storage cannot load server status.                                                        |
| `SERVER_STATUS_SAVE_FAILED` | `Failed to save server status`            | Extension storage cannot persist server status.                                                     |

Chrome may also emit Native Messaging errors directly. These are not Tabrix
project-defined constants.

| Chrome message                                               | Common cause                                         | First recovery step                   |
| ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| `Specified native messaging host not found`                  | The native host manifest is not registered.          | Run `tabrix register`.                |
| `Access to the specified native messaging host is forbidden` | The extension ID is not listed in `allowed_origins`. | Re-run `tabrix register`.             |
| `Native host has exited`                                     | The bridge process crashed or exited.                | Check logs and run `tabrix doctor`.   |
| `Error when communicating with the native messaging host`    | Invalid native-host output or runtime failure.       | Confirm Node.js 20+ and inspect logs. |

## MCP Server Errors

Source files:

- `app/native-server/src/constant/index.ts` (`ERROR_MESSAGES`)
- native-server MCP route handlers under `app/native-server/src/server/**`

| Constant                       | HTTP status | Message                                                 | When it appears                                                             |
| ------------------------------ | ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SERVER_NOT_RUNNING`           | `503`       | `Server is not actively running.`                       | The server is initialized but not ready to serve MCP work.                  |
| `INVALID_MCP_REQUEST`          | `400`       | `Invalid MCP request or session.`                       | The request body or MCP session state is invalid.                           |
| `STALE_MCP_SESSION`            | `400`       | `MCP session not found ...`                             | A client reused a session after server restart or expiry.                   |
| `INVALID_SESSION_ID`           | `400`       | `Invalid or missing MCP session ID.`                    | The `mcp-session-id` header is missing or unknown.                          |
| `INVALID_SSE_SESSION`          | `400/405`   | `Invalid or missing MCP session ID for SSE (GET /mcp).` | A Streamable HTTP SSE stream is opened without a valid initialized session. |
| `REQUEST_TIMEOUT`              | `504`       | `Request to extension timed out.`                       | The extension did not answer within the configured timeout.                 |
| `MCP_SESSION_DELETION_ERROR`   | `500`       | `Internal server error during MCP session deletion.`    | Session cleanup failed.                                                     |
| `MCP_REQUEST_PROCESSING_ERROR` | `500`       | `Internal server error during MCP request processing.`  | Request handling threw inside the MCP server.                               |
| `INTERNAL_SERVER_ERROR`        | `500`       | `Internal Server Error`                                 | Unclassified server-side error.                                             |

## Tool Execution Errors

Source files:

- `app/native-server/src/mcp/register-tools.ts`
- `app/native-server/src/execution/result-normalizer.ts`
- `app/chrome-extension/common/constants.ts` (`ERROR_MESSAGES`)

### MCP Tool Result `errorCode`

| `errorCode`                     | Meaning                                                                              | When it appears                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `tool_not_available`            | The requested tool is not registered or not available in the current policy surface. | Tool lookup failed before browser dispatch.                              |
| `tool_call_error`               | A tool returned an MCP error result and the native server normalized it.             | Browser-side tool execution failed.                                      |
| `tool_call_exception`           | A tool call raised an uncaught exception.                                            | Dispatch or execution threw before a normal error result was produced.   |
| `dynamic_flow_error`            | A legacy dynamic-flow proxy call failed.                                             | The compatibility proxy could resolve a flow but the proxied run failed. |
| `dynamic_flow_resolution_error` | A legacy dynamic-flow proxy could not resolve a requested flow.                      | The proxy could not map a `flow.*` tool name to a published flow.        |

### Extension Tool Constants

| Constant                | Meaning                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `TOOL_EXECUTION_FAILED` | Generic browser-side tool execution failure.                                                      |
| `INVALID_PARAMETERS`    | Tool input validation failed.                                                                     |
| `PERMISSION_DENIED`     | Browser permission or page-scheme restrictions blocked the action, for example `chrome://` pages. |
| `TAB_NOT_FOUND`         | The requested `tabId` does not exist.                                                             |
| `ELEMENT_NOT_FOUND`     | The requested selector, XPath, or element ref did not match a live element.                       |
| `NETWORK_ERROR`         | A browser-side network operation failed.                                                          |

## HTTP Status Constants

Source file:

- `app/native-server/src/constant/index.ts` (`HTTP_STATUS`)

| Constant                | Value | Typical use                                          |
| ----------------------- | ----- | ---------------------------------------------------- |
| `OK`                    | `200` | Successful response.                                 |
| `CREATED`               | `201` | Resource was created.                                |
| `NO_CONTENT`            | `204` | Successful response with no body.                    |
| `BAD_REQUEST`           | `400` | Invalid input or session state.                      |
| `UNAUTHORIZED`          | `401` | Missing or invalid auth token.                       |
| `NOT_FOUND`             | `404` | Route or resource was not found.                     |
| `INTERNAL_SERVER_ERROR` | `500` | Unclassified server-side error.                      |
| `GATEWAY_TIMEOUT`       | `504` | Extension or downstream browser operation timed out. |

## Timeout Constants

Source files:

- `app/native-server/src/constant/index.ts` (`TIMEOUTS`)
- `app/chrome-extension/common/constants.ts` (`TIMEOUTS`)

| Constant                    | Default    | Meaning                                          |
| --------------------------- | ---------- | ------------------------------------------------ |
| `DEFAULT_REQUEST_TIMEOUT`   | `15000` ms | Native-server default request timeout.           |
| `EXTENSION_REQUEST_TIMEOUT` | `20000` ms | Native-server wait time for extension responses. |
| `PROCESS_DATA_TIMEOUT`      | `20000` ms | Native-server process-data timeout.              |
| `DEFAULT_WAIT`              | `1000` ms  | Extension-side default wait.                     |
| `NETWORK_CAPTURE_MAX`       | `30000` ms | Extension network-capture maximum duration.      |
| `NETWORK_CAPTURE_IDLE`      | `3000` ms  | Extension network-capture idle timeout.          |
| `SCREENSHOT_DELAY`          | `100` ms   | Screenshot stabilization delay.                  |
| `KEYBOARD_DELAY`            | `50` ms    | Keyboard event delay.                            |
| `CLICK_DELAY`               | `100` ms   | Click action delay.                              |

## Native Message Types

Source file:

- `app/native-server/src/constant/index.ts` (`NATIVE_MESSAGE_TYPE`)

| Type      | Meaning                       |
| --------- | ----------------------------- |
| `start`   | Start command.                |
| `started` | Start acknowledgement.        |
| `stop`    | Stop command.                 |
| `stopped` | Stop acknowledgement.         |
| `ping`    | Liveness probe.               |
| `pong`    | Liveness response.            |
| `error`   | Generic native-message error. |

## Maintenance Notes

- Keep this document aligned with the source files listed above.
- Do not document removed Record/Replay engines as current public surface.
- Public-safe release gates may reference private benchmark directories, but
  raw benchmark JSON, NDJSON, screenshots, and private browser evidence stay
  outside the public repository.
