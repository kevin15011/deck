# Mandatory session-scoped integration

User reaffirmation: 2026-11-13. This promotes the earlier plug-and-play research direction to a mandatory product requirement; it does not claim implementation is complete.

Deck must manage helper tools (including RTK and Codebase Memory) and content separately and connect integrations only to sessions/processes it launches. Ordinary operation must neither modify native global profiles nor depend on Deck1 global plugins, hooks, roles or MCP registrations. Use supported launch/session interfaces. Preserve user configuration and existing integrations; no legacy cleanup is authorized by this clarification.

Acceptance:
- A supported runner works with a clean native profile lacking Deck1 materialization.
- Selected helpers are available in Deck sessions through scoped configuration.
- Direct native runner launches retain their prior behavior and configuration.
- Closing a Deck session leaves no added global integration.
- Unsupported scoped surfaces are reported explicitly, without global installation as a fallback.

Current gap: inspected Codex role loading still consumes Deck1 global role/hook contributions. Existing compatibility evidence does not satisfy clean-profile acceptance. No runtime change or verification is claimed here.

Ownership: same ApplyDeep task task-181d5e85-7817-4dbd-bc81-849132576baf. Attempt85 was running when clarification arrived; bridge rejected immediate continuation with task-running. Apply this requirement at the next owner continuation and review before accepting the connected runner slice. Existing OpenCode acceptance criteria remain in force. Lead owns this requirement and acceptance.

## CBM ordinary-session investigation — 2026-11-13

Investigate task-76e6fa3d-3149-4331-a9b0-c73eacd44679 attempt31 (result452337) found a managed-selection gap. Lead independently read frozen accepted82 session_codebase.rs: Selection::load returns None when project .deck/config.json is missing, and later requires the native config.toml Deck MCP marker. Lead confirmed that project file is absent for /home/kevin15011/deck. Installed executable SHA256 is 5a12706b478420ade8f2bd146a906c5c8e40de5ec5d4f28f4dfad7fba562f00d. This establishes why managed selection is absent, not why every inherited MCP tool was absent from the user's historical session; actual native admission/startup evidence remains unavailable. Do not claim the index is stale or the whole failure repaired.

Same ApplyDeep owner must address selection through Deck-owned resources and session-scoped MCP without the native global marker dependency. Preserve explicit capability choice, project scope, freshness and permissions. Report concrete selection/admission failures. Qualify a real ordinary Deck2 session with admitted tools and successful list_projects/index_status for the project, plus unavailable-tool failure semantics; clean native profile acceptance remains mandatory. No profile/index changes or install were performed. Attempt85 was still running; this is a pending implementation/review handoff, not proof of agent consumption.
