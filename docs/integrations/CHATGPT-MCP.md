# Connecting ChatGPT to LOWTIDE

**Status: prepared, not tested.** LOWTIDE has everything on its side (a standard
Streamable HTTP endpoint, grants, a ChatGPT client kind with the Full LOWTIDE operator
preset, audit), but no ChatGPT connection has been made or tested, and LOWTIDE doesn't
claim one works.

## Why it needs a tunnel

ChatGPT's MCP connectors (Developer mode custom connectors) reach servers **over the
internet, over HTTPS**; they don't launch local commands. LOWTIDE deliberately listens
only on `127.0.0.1:4318` and never exposes itself: it doesn't bind `0.0.0.0`, open
firewall ports or start a tunnel by itself. So a ChatGPT connection needs a secure tunnel
**you** set up, forwarding a public HTTPS URL to `http://127.0.0.1:4318/mcp`.

## Authentication: check this first

LOWTIDE authenticates with a static **Bearer grant token** and has no OAuth. Reports
differ on what ChatGPT's connector accepts: some setups offer a token field, others
expect OAuth for any non-public connector. Before setting anything up, check what your
ChatGPT plan's connector screen offers:

- **It accepts a bearer token**: use a LOWTIDE grant token (below).
- **It only offers OAuth or "no authentication"**: don't connect LOWTIDE as
  "no authentication". You'd need an authenticating proxy in front of it (one that
  enforces its own sign-in and adds the LOWTIDE token), which LOWTIDE doesn't provide.

## Steps (when your connector accepts a token)

1. LOWTIDE → **AI** → **Give access** → **ChatGPT**, preset **Full LOWTIDE operator**
   (still never Protected Time, tokens, backup restore or permanent deletion). Copy
   the token.
2. Start a tunnel to `127.0.0.1:4318` that **rewrites the Host header** to
   `127.0.0.1:4318` (LOWTIDE rejects any other Host as a DNS-rebinding defence), for
   example:
   - Cloudflare Tunnel: `cloudflared tunnel --url http://127.0.0.1:4318
--http-host-header 127.0.0.1:4318` (a named tunnel with Cloudflare Access in front
     is better than a quick tunnel);
   - ngrok: `ngrok http 127.0.0.1:4318 --host-header=rewrite`;
   - Tailscale Funnel: expose `http://127.0.0.1:4318` and confirm the Host header
     LOWTIDE receives.
3. In ChatGPT (Settings → Connectors → Developer mode): add a custom connector with the
   URL `https://<your tunnel host>/mcp` and the token.
4. In LOWTIDE → AI, ChatGPT shows as connected once it calls; every call is in the audit
   under its grant.

## Keeping it safe

- Expose only `/mcp` if your tunnel can restrict paths; `/api` needs LOWTIDE's owner
  token anyway, and never share that.
- Revoke the ChatGPT grant in LOWTIDE → AI when you stop using it; stop the tunnel.
- The tunnel is optional and separate: LOWTIDE works fully locally without it.

## What LOWTIDE shows

Settings → Health → **ChatGPT**: "Not configured", with any supported tunnel client it
finds on this Mac (cloudflared, ngrok, Tailscale). LOWTIDE doesn't manage a tunnel yet,
so it can't report "connected" or "offline" for one.
