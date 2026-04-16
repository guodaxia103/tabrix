# Tabrix Native Server

`app/native-server` is the local Node service behind the `tabrix` and `tabrix-stdio` executables.

It is responsible for:

- exposing the MCP bridge over `Streamable HTTP` at `http://127.0.0.1:12306/mcp` by default
- providing the `tabrix-stdio` stdio transport, which proxies to the local HTTP MCP endpoint
- communicating with the Chrome extension through Native Messaging
- shipping diagnostics and lifecycle commands such as `setup`, `register`, `status`, `doctor`, `smoke`, `stdio-smoke`, `report`, and `daemon`

## Common Tasks

Install dependencies from the monorepo root:

```bash
pnpm install
```

Build the native server:

```bash
pnpm --filter @tabrix/tabrix build
```

Run tests:

```bash
pnpm -C app/native-server test:ci
```

Run typecheck:

```bash
pnpm -C app/native-server typecheck
```

## Important Paths

- `src/cli.ts`: CLI entrypoint for `tabrix`
- `src/mcp/mcp-server-stdio.ts`: stdio MCP server entrypoint for `tabrix-stdio`
- `src/server/`: Fastify server, `/mcp`, `/status`, auth, and route wiring
- `src/native-messaging-host.ts`: bridge between Node and the extension
- `src/scripts/`: implementations of `setup`, `register`, `doctor`, `status`, `smoke`, `stdio-smoke`, `report`, and `daemon`
- `src/mcp/register-tools.ts`: tool registration from `@tabrix/shared`

## Transport Notes

- `Streamable HTTP` is the default local and remote MCP path
- `stdio` is also officially supported and is implemented as a local proxy to the HTTP MCP service
- the legacy `GET /sse` + `POST /messages` path is not part of the current transport surface

## Verification

For native-server or MCP changes, start with the smallest relevant set:

```bash
pnpm -C app/native-server build
tabrix status
tabrix doctor
tabrix smoke
tabrix stdio-smoke
```
