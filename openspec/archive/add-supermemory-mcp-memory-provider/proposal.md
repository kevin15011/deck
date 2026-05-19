# Proposal: Add Supermemory MCP Memory Provider

## Intent

Add Supermemory MCP as a selectable adaptive-memory provider while preserving the rule that OpenSpec is authoritative and memory is advisory. The change should let teams choose Supermemory instead of existing providers such as Engram during installation, collect the required Supermemory token during that install flow, configure the runner to connect to Supermemory MCP, and use a provider-neutral memory contract.

## Goal

Enable Supermemory MCP as the single active adaptive-memory provider for safe SDD phase context, cross-device continuity, and project/user learning, starting with the Pi runtime/integration, without allowing memory to override OpenSpec.

## Scope

### In Scope
- Add Supermemory MCP as an install-time adaptive-memory provider option.
- When Supermemory is selected during installation, prompt for the Supermemory token and configure Deck to connect to the Supermemory MCP.
- Persist non-secret Supermemory/provider configuration in `.deck/config.json`; keep credentials outside Deck config.
- Require explicit `userId` for Supermemory configuration; support optional `teamId` and `orgId` when provided.
- Target the first implementation at the Pi runtime/integration path.
- Enforce that only one memory provider is active in the runner.
- Define/use a common adaptive-memory adapter contract shared by Engram, Supermemory, and future providers.
- Integrate Supermemory advisory context into SDD phase prompts with explicit `OFFICIAL CONTEXT` and `ADAPTIVE CONTEXT` separation.
- Implement scoped container-tag and metadata policies for personal, project, team-candidate, and org memory.
- Add safe memory commit behavior for high-signal session learnings.
- Validate real Supermemory MCP connectivity/behavior before relying on mocked assumptions.

### Out of Scope
- Replacing OpenSpec as the source of requirements, design, or tasks.
- Storing active specs/tasks or raw chats as adaptive memory.
- Supporting multiple active memory providers in one runner session.
- Building a full memory review/promote UI.
- Migrating existing Engram memories in this change.
- Treating team memories as approved authority; team memories remain candidate/advisory unless promoted through an approved future flow.
- Implementing non-Pi runtime integrations as the first target unless explicitly scoped later.

## Affected Capabilities

> This section is the contract between Proposal and Spec/Design phases.

### New Capabilities
- `supermemory-provider-selection`: Supermemory MCP can be selected as the active adaptive-memory provider during installation/configuration.
- `supermemory-install-token-configuration`: The installer prompts for the Supermemory token when selected and configures the MCP connection while keeping credentials outside Deck config.
- `supermemory-pi-runtime-integration`: The Pi runtime can load and use Supermemory MCP through the active adaptive-memory provider path.
- `supermemory-adaptive-context`: SDD phases can receive advisory Supermemory profile/search context through the common memory adapter.
- `adaptive-memory-governance`: Memory scopes, metadata, promotion status, and authority rules prevent memory drift.

### Modified Capabilities
- `adaptive-memory-provider`: Existing provider handling changes from provider-specific behavior to a common single-active-provider contract.
- `installer-memory-provider-configuration`: Installation flow adds Supermemory selection, token prompting, explicit `userId`, optional `teamId`/`orgId`, and non-secret `.deck/config.json` persistence.
- `sdd-phase-context-assembly`: Phase prompts include official OpenSpec context separately from advisory adaptive memory.

### Unchanged Capabilities
- `openspec-artifact-authority`: OpenSpec remains the official store for requirements, design, tasks, and approved change history.
- `sdd-phase-workflow`: The Proposal → Spec/Design → Tasks → Apply → Verify/Review flow remains unchanged except for advisory context injection.
- `engram-provider`: Engram may remain available as an alternative provider, but Engram memory migration is not part of this change.

## Approach

Introduce Supermemory behind an internal adaptive-memory adapter rather than coupling SDD or runner logic directly to Supermemory MCP tools. Installation/configuration selects one provider; if Supermemory is selected, the installer gathers the required token and identity inputs, writes only non-secret provider settings to `.deck/config.json`, and stores credentials outside Deck config. The Pi runtime is the first integration target. The runner loads only the active provider and requests advisory context per SDD phase. Supermemory-specific behavior should live in its adapter: MCP tool mapping, container tags, metadata filters, query strategy, thresholds, and memory commit rules. Real MCP validation should be treated as an early gating validation before downstream implementation relies on assumptions.

## Alternatives and Tradeoffs

| Alternative | Why Considered | Why Not Chosen |
|---|---|---|
| Use Supermemory MCP directly from phase agents | Fastest integration | Couples workflow to provider-specific tools and makes Engram/future providers inconsistent |
| Store the Supermemory token in `.deck/config.json` | Simple configuration | Violates the clarified credential boundary; Deck config should contain only non-secret provider settings |
| Index all OpenSpec artifacts into Supermemory | Rich recall | Risks making memory look authoritative and duplicating official specs/tasks |
| Allow multiple active providers | More recall sources | Increases conflicts, ranking ambiguity, privacy risk, and operational complexity |
| Store raw chat transcripts | Easy ingestion | Produces noisy memory and increases privacy/security risk |
| Start with all runtime integrations | Broader initial coverage | Increases scope; Pi runtime/integration is the clarified first target |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Memory drift contradicts OpenSpec | Medium | Strict prompt hierarchy, metadata, scopes, and rule that memory cannot modify OpenSpec without explicit action |
| Cloud/API dependency on Supermemory | Medium | Adapter abstraction, health checks, fallback behavior, and clear deployment documentation |
| Incorrect or unvalidated MCP assumptions | Medium | Validate real Supermemory MCP behavior/connectivity as an early gating implementation validation |
| Credential handling leaks tokens into project config | Medium | Prompt during install, keep credentials outside `.deck/config.json`, and document/validate the chosen secret storage path |
| Overpersonalization weakens project conventions | Medium | Project/OpenSpec context outranks personal memory; personal memories are labeled as preferences |
| Noisy memory reduces usefulness | High | Save only high-signal learnings, maximum 3-7 per session, require metadata/confidence |
| Scope/container leakage | Medium | Use separate short container tags and metadata filters |
| Pi-first scope misses other runtime expectations | Low | State Pi as first target and defer other runtimes until explicitly scoped |

## Rollback Plan

Disable Supermemory by switching the active adaptive-memory provider back to Engram or `none` in `.deck/config.json` and removing/invalidating the external Supermemory credential entry. Keep OpenSpec artifacts unchanged. Any Supermemory-specific adapter code/config can be reverted without changing official specs, tasks, or completed OpenSpec history.

## Dependencies

- Supermemory MCP/API credentials and availability.
- Install-time credential prompt and secret-storage mechanism outside `.deck/config.json`.
- `.deck/config.json` support for non-secret active provider settings.
- Explicit `userId` value; optional `teamId` and `orgId` when team/org scoping is used.
- Pi runtime hook where the active memory provider is loaded.
- SDD prompt/context assembly points.
- Real Supermemory MCP validation before assuming final tool behavior.

## Open Questions

- What exact secret-storage mechanism should hold the Supermemory token outside `.deck/config.json`?
- How is `projectId` derived in this repository?
- Should Supermemory container prompts be configured automatically or documented for manual setup?
- What is the exact fallback mode when Supermemory credentials are missing, invalid, or the service is unavailable?
- What audit logging is expected for automatically committed memories?

## Acceptance Direction

- [ ] Installer/configuration offers Supermemory MCP as an adaptive-memory provider option.
- [ ] Selecting Supermemory during installation prompts for the Supermemory token and configures MCP connectivity.
- [ ] Non-secret provider settings are stored in `.deck/config.json`; the Supermemory token is not stored there.
- [ ] Supermemory configuration requires explicit `userId` and supports optional `teamId`/`orgId`.
- [ ] Pi runtime loads exactly one active adaptive-memory provider and can use Supermemory MCP through the provider-neutral contract.
- [ ] Real Supermemory MCP connectivity/behavior is validated before relying on mocked assumptions.
- [ ] SDD phase prompts clearly separate official OpenSpec context from advisory adaptive memory.
- [ ] Memory writes include required metadata and scope/container separation, including candidate treatment for team memories.
- [ ] Active OpenSpec specs/tasks are not stored as adaptive memory.
- [ ] Supermemory failure does not block OpenSpec-driven workflow.

## Next Steps

Ready for Spec (`deck-developer-spec`) and Design (`deck-developer-design`) in parallel.
