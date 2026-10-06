# LOWTIDE as an MCP server

LOWTIDE is a standard [Model Context Protocol](https://modelcontextprotocol.io) server
(v2.3, ADR-074). Any MCP client can use it within a grant the owner gives it. This page
is the reference; [CLAUDE-MCP.md](CLAUDE-MCP.md) and [CHATGPT-MCP.md](CHATGPT-MCP.md)
are the client-specific steps.

## Architecture

```
 LOWTIDE domain and repositories (one SQLite database, one writer: the companion)
                      │
        one MCP tool registry (companion/server/tools.ts)
                      │
   permissions · scopes · private categories · audit · change log
                      │
       official MCP TypeScript SDK (Server + Streamable HTTP transport)
                      │
        http://127.0.0.1:4318/mcp ◄──── stdio bridge (lowtide-mcp.js)
                      ▲                        ▲
        HTTP clients (Bearer token)    Claude Code, Claude Desktop,
                                       any client that launches a command
```

- **One registry, two transports.** Streamable HTTP is served by the companion itself.
  stdio is a thin bridge process that forwards each JSON-RPC message to the same
  endpoint, so both transports list the same tools and enforce the same permissions
  (tested: `bridge.test.ts`, the installer's own check). The bridge never opens the
  database.
- **Official SDK.** `@modelcontextprotocol/sdk` 1.32 provides the protocol: version
  negotiation (2025-11-25 down to 2024-10-07), sessions (`Mcp-Session-Id`), batches,
  the GET event stream and DELETE. LOWTIDE adds its own authentication, Host and Origin
  checks, rate limits and per-grant session limits in front of it.
- **Tools only.** No resources, prompts or sampling; the server never calls the client.

## Connecting

| Transport       | How                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Streamable HTTP | `POST/GET/DELETE http://127.0.0.1:4318/mcp` with `Authorization: Bearer <grant token>`                                          |
| stdio           | `node "~/Library/Application Support/LOWTIDE/current/mcp/lowtide-mcp.js"` with `LOWTIDE_TOKEN=<grant token>` in its environment |

The stdio entry point is the installed runtime's stable path (`current` always points
at the running build). From a development checkout, `companion/lowtide-mcp.ts` is the
same bridge and still works with Node 22.22+.

If LOWTIDE isn't running when a stdio client starts the bridge, the bridge asks launchd
once to start the installed LOWTIDE (only for the default address, on macOS), waits for
it, and carries on.

## Authentication and grants

- Every request needs a **grant token**, made in LOWTIDE → AI → Give access. The token
  is shown once; LOWTIDE keeps only its SHA-256 fingerprint.
- Missing, mistyped, expired or **revoked** tokens get `401` with
  `WWW-Authenticate: Bearer realm="lowtide"`. Revoking a grant also ends its sessions.
- There is no OAuth. Clients that can't send a static bearer token (or launch the stdio
  bridge) can't connect directly.
- The audit names the client from its **grant**, never from what the client says about
  itself.

## Permissions

Presets: **Read only**, **Project operator**, **Workspace operator**, **Full LOWTIDE
operator**, or custom capabilities. A grant sees only the tools it may use (`tools/list`
is filtered), and a call it may not make is refused with what was refused, why, and the
permission that would allow it ("Cannot create Project. Grant lacks projects.create.").
The same rules hold over stdio and HTTP.

Never available to any AI client, whatever the grant: **Protected Time**, grant and
token management, the owner token, backup restore, and permanent deletion.

## What the server tells a model

- **Server instructions** (sent at `initialize`): LOWTIDE is the canonical personal
  operating system; use structured records for state and SPACE for documents; search
  before creating; never fabricate sessions, completions, progress, milestones,
  activity or Daily Pulse history; Protected Time is unavailable; respect the grant.
- **Tool descriptions** end with what the tool needs ("Needs projects.edit.").
- **Annotations** on every tool: `readOnlyHint`, `destructiveHint` (true when it may
  change or remove existing data), `idempotentHint` (true when repeating it has no
  further effect, e.g. creates that return the existing match), `openWorldHint: false`.
  They are hints for clients; LOWTIDE's permissions decide.
- **Strict schemas**: every tool's input is a closed JSON Schema object; no position is
  left untyped (checked by a test and by MCP Inspector).
- `get_lowtide_capabilities`: LOWTIDE, schema and MCP server versions, the client and
  grant, its preset, allowed and not-allowed permissions, a compact matrix of what can
  be done with each record type, and the rules.

## Live updates and audit

Every write goes through LOWTIDE's own repositories as the AI client, so the app
updates live (server-sent events) and History shows who did it. Every call, allowed or
refused, is in the audit (client, grant, time, tool, entity, result, a short before and
after); every write is in AI → What AI changed, most with an Undo. Hidden reasoning is
never stored.

## Health

`GET http://127.0.0.1:4318/api/health` (no token, no secrets):

```json
{ "app": "lowtide-companion", "version": "2.3.0", "status": "ok",
  "checks": { "runtime": {…}, "database": { "ok": true, "integrity": "ok", "schemaVersion": 11 },
              "frontend": {…}, "api": {…}, "sse": {…}, "mcp": { "ok": true, "sessions": 1 }, "workspace": {…} } }
```

## Checking it with MCP Inspector

```sh
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:4318/mcp --transport http \
  --header "Authorization: Bearer $TOKEN" --method tools/list
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:4318/mcp --transport http \
  --header "Authorization: Bearer $TOKEN" --method tools/call --tool-name get_context
```

The v2.3 rehearsal ran this against a copy of real data: connect, initialize,
`tools/list` (no schema portability warnings), reading context and a project, creating
a project, a SPACE page and a task, recording a decision, a server refusal, an invalid
and a revoked token, an ambiguous name (refused with candidates) and Protected Time
(absent everywhere). An invalid token makes Inspector try OAuth, which LOWTIDE doesn't
offer; the server's answer is the plain `401` above.

## Network exposure

LOWTIDE listens on **127.0.0.1 only**, checks the `Host` header (DNS rebinding) and an
Origin allow-list, and never opens firewall ports or binds `0.0.0.0`. Reaching it from
another machine means a secure, authenticated tunnel you set up (see
[CHATGPT-MCP.md](CHATGPT-MCP.md)).

## Troubleshooting

| Symptom                                            | Cause                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `LOWTIDE isn’t reachable at http://127.0.0.1:4318` | LOWTIDE isn't running: open the LOWTIDE app                                         |
| `401` / "refused this grant token"                 | revoked or mistyped token: make a new grant                                         |
| `404 Session not found`                            | LOWTIDE restarted; clients re-initialize (the bridge does it by itself)             |
| `403 Unexpected Host`                              | something forwarded the request with another Host header (a tunnel must rewrite it) |
| a tool is missing from `tools/list`                | the grant doesn't allow it (see `get_lowtide_capabilities`)                         |
