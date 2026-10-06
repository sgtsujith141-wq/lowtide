# Connecting Claude to LOWTIDE

Claude Code and Claude Desktop launch a local command, so they use LOWTIDE's **stdio
bridge** from the installed runtime. Claude Code can also use the **HTTP** endpoint
directly. Both reach the same tools with the same permissions ([MCP.md](MCP.md)).

## 1. Give Claude access

LOWTIDE → **AI** → **Give access** → Claude Code (or Claude), preset **Full LOWTIDE
operator** (or less). Copy the token: it is shown once.

## 2. Claude Code (stdio, recommended)

```sh
claude mcp add lowtide --scope user -e LOWTIDE_TOKEN=<token> -- \
  node "$HOME/Library/Application Support/LOWTIDE/current/mcp/lowtide-mcp.js"
```

`current` always points at the installed build, so this keeps working across LOWTIDE
updates and never depends on the development repository. If LOWTIDE isn't running when
Claude Code starts, the bridge asks launchd to start it.

### Already connected from the repository?

Earlier versions configured `node /Volumes/…/lowtide/companion/lowtide-mcp.ts`. That
still works while the volume is mounted. To move to the installed bridge and keep the
same grant, run this once in a terminal, then restart Claude Code (the token is read
from Claude Code's own config and not printed):

```sh
TOKEN=$(node -e 'const c=require(require("os").homedir()+"/.claude.json");process.stdout.write(c.mcpServers?.lowtide?.env?.LOWTIDE_TOKEN??"")')
claude mcp remove lowtide --scope user
claude mcp add lowtide --scope user -e LOWTIDE_TOKEN="$TOKEN" -- \
  node "$HOME/Library/Application Support/LOWTIDE/current/mcp/lowtide-mcp.js"
unset TOKEN
```

## 3. Claude Code over HTTP (alternative)

```sh
claude mcp add --transport http lowtide http://127.0.0.1:4318/mcp \
  --header "Authorization: Bearer <token>" --scope user
```

LOWTIDE must already be running (no automatic start over HTTP).

## 4. Claude Desktop

In `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lowtide": {
      "command": "node",
      "args": ["/Users/<you>/Library/Application Support/LOWTIDE/current/mcp/lowtide-mcp.js"],
      "env": { "LOWTIDE_TOKEN": "<token>" }
    }
  }
}
```

Use the absolute path to `node` if Claude Desktop can't find it (`which node`).

## Checking

In Claude Code: `/mcp` lists `lowtide` as connected; ask it to call
`get_lowtide_capabilities`. In LOWTIDE → AI, the client shows as connected, and every
call it makes appears in the audit under the grant's name.

## Troubleshooting

- **"LOWTIDE isn’t reachable"**: open the LOWTIDE app, or turn on Settings → Start
  LOWTIDE at login.
- **"refused this grant token"**: the grant was revoked or the token mistyped; give
  access again and update the config.
- **Tools missing**: the grant's preset doesn't allow them; change it in LOWTIDE → AI.
