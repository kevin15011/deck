# Working Brief: Runner-Neutral Web Search

## Intent

Add an optional canonical `web-search` capability that gives the Adaptive Developer Team compact web search and point extraction without coupling agent instructions or `@deck/core` to a runner or to Tavily. Tavily MCP is the only functional provider in this first version.

## Acceptance

- Core defines `web-search` as a semantic optional capability with search and point-extraction policy, provenance expectations, context limits, source-quality guidance, and an explicit untrusted-input boundary.
- Tavily identity, package, credentials, and tool names remain outside Core and central agent prompts.
- OpenCode, Pi, and Codex adapters can materialize the capability through their native MCP configuration; unsupported runners report an explicit capability gap.
- Web Search defaults off. When enabled, missing `TAVILY_API_KEY`, missing runner MCP support, missing executable prerequisites, or missing MCP configuration produce distinct readiness evidence without invalidating Deck as a whole.
- Deck may persist `TAVILY_API_KEY` only in an explicitly selected user shell profile through a Deck-owned block after masked interactive entry. The value never appears in Deck config, plans, diagnostics, prompts, logs, snapshots, tests, OpenSpec artifacts, or runner MCP files.
- The setup dashboard exposes Web Search as a first-class section beside Packages and Adaptive Memory, with enablement, provider, credential, runner support, MCP, and conflict readiness.
- Existing configuration and installations remain valid when Web Search is absent or disabled.
- Tests cover canonical identity, adapter parity/materialization, optional/configuration states, secret redaction, semantic agent instructions, unsupported runners, and regression behavior.
- User documentation explains enablement, Tavily setup, role policy, provenance, Context7 priority, and the deliberate exclusion of crawl/deep research.

## Decisions

1. **Canonical contract:** `@deck/core` owns capability ID `web-search`, semantic readiness states, and one shared instruction bundle. The bundle is role-filtered and provider-neutral.
2. **Provider boundary:** a small provider descriptor package below Core centralizes Tavily MCP implementation metadata for adapters. Adapters depend on the descriptor; Core does not. No provider registry or gateway is introduced before a second provider exists.
3. **Initial provider:** local stdio Tavily MCP, pinned to reviewed npm version `0.2.22`, launched with `npx -y tavily-mcp@0.2.22`. The semantic server name is `web-search`.
4. **Credentials:** enabling the Deck capability requires non-empty `TAVILY_API_KEY` even though upstream currently offers a rate-limited keyless mode. With explicit user approval recorded 2026-08-11, Deck prompts through masked TUI input and persists the value in the active user's `.bashrc` or `.zshrc` using an exact Deck-owned, idempotent block. Adapters and runner MCP files still receive only the environment variable name/reference, never its value.
5. **Scope:** Deck authorizes only compact search and point extraction. Tavily's additional crawl/map/research tools are outside this capability and MUST NOT be used by Developer Team agents under this policy. Deck will not add a wrapper solely to hide upstream tools in v1.
6. **Configuration and UX:** reuse Deck's normalized project configuration with a provider-opaque Web Search setting that defaults disabled. A dedicated Web Search dashboard section persists enablement/provider and separately manages the shell credential. Provider selection remains an extension point outside Core's canonical capability identity; only Tavily is accepted by the current composition root.
7. **Materialization:** adapters own native MCP serialization, collision handling, plans, verification, and runner diagnostics. Shared provider command/tool/credential metadata is not copied among adapters.
8. **Readiness:** disabled, enabled-unconfigured, configured-but-not-materialized, ready, and unsupported are distinguishable. Optional Web Search never makes baseline Deck invalid.
9. **Agent access:** Lead may perform short direct research; Investigate is primary; Architect, Apply, and Quality use it only under the user-approved role constraints. Setup diagnoses but does not expose secrets. Repository/Serena/Codebase Memory and Context7 retain priority for their respective evidence classes.
10. **Provenance/context:** search results stay compact; only selected sources are extracted. Used evidence preserves URL/title/provider/retrieval time and publication date when available, while distinguishing snippets from extracted content.

## Relevant Trace

- Canonical definitions and immutable adapter mappings: `packages/core/src/runner-capability-registry.ts`.
- Parity/readiness projection: `packages/core/src/runner-capability-parity.ts`.
- Runner-neutral operational port: `packages/core/src/runner-adapter.ts`.
- Instruction composition: `packages/core/src/teams/developer/instruction-bundles/` and `content-registry.ts`.
- Adapter materialization: `packages/adapter-opencode`, `packages/adapter-pi`, and `packages/adapter-codex` MCP/config/catalog/inventory/plan/runner-adapter modules.
- CLI composition/configuration: `apps/cli/src/runner-capability-registry.ts` and runner dashboard state/action modules.
- Official Tavily evidence checked 2026-08-10: `tavily-ai/tavily-mcp` documents `tavily_search` and `tavily_extract`, `TAVILY_API_KEY`, local `npx`, and remote OAuth; npm/package metadata reports version `0.2.22`.
- The local skill registry was absent during session-start read-only validation. Per policy, discovery used bounded official repository sources for the active OpenCode runner and did not create or refresh `.atl/skill-registry.md`.

## Risks

- Tavily authenticated mode exposes crawl/map/research in addition to search/extract; semantic policy and tests must prevent scope drift until a future tool-filter or gateway decision.
- `npx` may download code on first use; explicit opt-in, an exact package version, and no test-network execution are required.
- Runner MCP formats and collision semantics differ; adapters must preserve unrelated user configuration and fail closed on conflicting ownership.
- The active Codex OpenSpec change still has unrelated materialization blockers. This change may add an isolated MCP capability but MUST NOT alter or claim resolution of those ownership blockers.
- Configuration migration must preserve old Deck config shapes and XDG user-choice fields.
- Shell-profile persistence stores the API key as plaintext in a user-owned startup file by explicit product choice. The writer must use safe quoting, exact marker ownership, symlink rejection, atomic replacement, restrictive permissions where safely enforceable, and rollback on failed mutation; diagnostics must never contain the value.

## Non-goals

- Deep research, recursive crawling, site mapping, scraping, a research agent, another orchestrator, a custom HTTP client, a Deck Web Search Gateway, multiple providers, or a `web-crawl` capability.
- Treating web evidence as authority, new requirements, workflow authorization, or executable instructions.
- Live network calls or actual provider installation in tests.

## Progress

- Architecture and official Tavily MCP behavior traced.
- Compact design selected; Full SDD is not justified.
- Canonical capability, provider descriptor, project configuration, agent policy, runner mappings, MCP materialization, readiness, tests, and user documentation implemented.
- Initial independent review found Codex missing-materialization blocking, unsupported-provider writes, dashboard/config drift, role-filter drift, Pi optionality drift, duplicated provider metadata, and weak behavioral tests; all confirmed findings were repaired on the same candidate.
- Final implementation verification passed: 4,430 repository tests, TypeScript `--noEmit`, and `git diff --check`.
- Independent Quality re-review approved the Web Search delta after focused behavioral probes for disabled-to-enabled materialization, unsupported-provider refusal, collision safety, readiness reinspection, and credential non-leakage.
- Manual runtime testing then exposed an adapter-to-dashboard contract regression: OpenCode emitted adapter-local install kinds and Pi emitted empty descriptions, causing real inventories to fail dashboard normalization despite synthetic tests passing. The result was reopened.
- User approved a follow-up UX/security delta: first-class Web Search dashboard section plus masked Tavily key entry persisted to the active shell profile rather than Deck or runner configuration.
- The adapter/dashboard contract was repaired with real production-inventory normalization tests. OpenCode now maps runner-local install kinds at the adapter boundary; Pi supplies canonical non-empty capability metadata.
- The dashboard now exposes Web Search beside Adaptive Memory, routes missing credentials through masked input, persists only an exact Deck-owned shell-profile block, hardens credential-bearing profiles to `0600`, and keeps Deck/MCP configuration value-free.
- Credential setup is transactional across profile, current process environment, and Deck config. CAS conflicts preserve concurrent bytes and surface conservative redacted manual-cleanup guidance.
- Final verification passed: 4,460 repository tests, TypeScript `--noEmit`, `git diff --check`, independent Quality review, and a disposable compiled-binary smoke executed outside the repository without `node_modules`, provider launch, or network access.
- Post-install inspection found one final composition gap: the real TUI supplied package-only instruction IDs and overrode the adapters' capability-aware fallback, so an enabled MCP could coexist with installed Developer Team prompts missing Web Search policy. All production install, model, launch, sync, and upgrade content paths now use capability-aware instruction IDs; package-toggle semantics remain separate. Independent temporary installation verified exact common/role policy for all seven roles and exclusion from unrelated skills.
- Final post-repair verification passed: 4,464 repository tests, TypeScript `--noEmit`, `git diff --check`, 94 targeted Quality tests, and an independent temporary OpenCode installation probe.
- Live MCP validation on 2026-08-11 confirmed Deck config, the owner-only shell block, and OpenCode MCP materialization. Search and extract both reached the Tavily provider boundary but failed before TLS establishment; direct TLS to `api.tavily.com:443` also ended unexpectedly while GitHub TLS succeeded. This is recorded as an external connectivity blocker, not successful provider behavior.
- After the user changed networks and reinstalled OpenCode, all seven Developer Team prompts plus the sampled Investigate skill contained the provider-neutral common policy and exact role guidance with no provider/tool/credential literals. A compact Tavily search and point extraction of the selected official `tavily-ai/tavily-mcp` source both succeeded at `2026-08-11T15:25:31Z`; the earlier TLS failure was network/proxy-related rather than a Deck or credential defect.

## Result

Implemented and independently approved end to end. The real OpenCode/Pi inventories satisfy the canonical dashboard contract; Web Search has a first-class setup section and safe failure behavior; Tavily credentials are persisted only in the explicitly selected active shell profile by user-approved policy; the compiled Deck binary resolves provider, adapters, inventory, and readiness without repository/workspace dependencies; capability-aware instructions are materialized through every production content path; and the reinstalled OpenCode environment completed live search and selected-source extraction successfully. Existing unrelated Codex marker-ownership and unowned-byte-preservation blockers remain inherited and are not changed or reclassified by this result.
