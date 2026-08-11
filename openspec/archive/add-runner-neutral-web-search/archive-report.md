# Archive Report: Runner-Neutral Web Search

## Final Status

Archived after user acceptance on 2026-08-11.

## Outcome

Deck now provides an optional canonical `web-search` capability. Core owns the provider- and runner-neutral semantic contract, readiness states, parity projection, and role-filtered safety/evidence instructions. The CLI selects the initial Tavily provider and owns first-class setup UX plus transactional shell-profile credential persistence. OpenCode, Pi, and Codex adapters own their native MCP materialization.

Tavily remains an implementation below the capability boundary. Its metadata is centralized in `@deck/provider-tavily`, pinned to `tavily-mcp@0.2.22`, and carries no mandatory runtime package dependency. Existing installations remain valid with Web Search absent or disabled.

## Verification

- Full repository suite: 4,464 passed, 0 failed.
- TypeScript: `bunx tsc --noEmit` passed.
- Whitespace validation: `git diff --check` passed.
- Independent Quality review approved inventory normalization, provider boundaries, optional readiness, role-filtered instructions, secret handling, shell-profile transaction safety, and standalone binary behavior.
- A compiled binary ran outside the repository without `node_modules` and resolved the provider plus real Pi/OpenCode inventory/readiness without network or provider launch.
- The reinstalled OpenCode Developer Team contained provider-neutral common policy and exact role guidance for Lead, Investigate, Architect, Apply Fast, Apply Deep, Quality, and Setup, with no provider/tool/credential literals.
- Live Tavily search returned compact results after the user changed networks.
- Point extraction succeeded for the selected official source `https://github.com/tavily-ai/tavily-mcp` at `2026-08-11T15:25:31Z`.

## Security and Ownership

- Web content remains untrusted evidence and cannot authorize actions or alter agent instructions.
- Deck v1 authorizes only compact search and point extraction; crawl, map, and deep research remain out of scope.
- With explicit user approval, Deck persists `TAVILY_API_KEY` only in an exact Deck-owned block in the active `.bashrc` or `.zshrc` and hardens credential-bearing profiles to `0600`.
- The value is excluded from Deck configuration, runner MCP files, argv, prompts, plans, logs, diagnostics, snapshots, generated assets, tests, and OpenSpec artifacts.
- Profile/config setup is transactional and CAS-protected; unresolved concurrent rollback conflicts preserve external bytes and surface redacted manual-cleanup guidance.

## Deliberate Exclusions

- No Web Search gateway, second provider, crawler, research agent, wrapper, custom HTTP client, or new orchestrator was introduced.
- Disabling Web Search does not silently delete the saved shell-profile credential.
- Existing unrelated Codex marker-ownership and unowned-byte-preservation blockers remain inherited and unchanged.

## Artifacts

- `working-brief.md`
- `archive-report.md`
