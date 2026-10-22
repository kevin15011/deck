---
description: Show Supermemory authentication and connection status
allowed-tools: ["Bash", "Read"]
---

# Supermemory Status

Report the user's Supermemory status:

1. Read `~/.supermemory-claude/credentials.json` (may not exist). Never print the full API key — show at most the first 6 and last 4 characters. The key source is env `SUPERMEMORY_CC_API_KEY` when set, otherwise the credentials file.
2. **Probe real connectivity** — a stored key proves nothing by itself. With the resolved key, run:
   ```
   curl -sS -o /dev/null -w '%{http_code}' -m 8 -X POST "${SUPERMEMORY_API_URL:-https://api.supermemory.ai}/v4/profile" \
     -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "x-sm-source: claude-code" \
     -d '{"containerTag":"<this project's container tag>","q":"connectivity probe"}'
   ```
   Interpret loudly: `200` → reachable and the key works; `401`/`403` → reachable but the key is invalid or revoked (say so explicitly — this is the silent-failure case the probe exists to catch); timeout / connection error / `5xx` → API unreachable, report the exact error.
3. Call the `whoAmI` MCP tool if the supermemory MCP server is connected, and say whether the MCP path works too.
4. Report: authenticated or not, key source, the active project container tag, API reachability (with the probe's HTTP status), and MCP reachability.

If not authenticated, tell the user a new session will open the browser login automatically, or they can set `SUPERMEMORY_CC_API_KEY`.
