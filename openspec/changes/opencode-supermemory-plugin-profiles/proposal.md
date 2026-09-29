# Proposal: Route OpenCode Supermemory Plugin Credentials by SSH Alias

## Intent

Replace Deck-owned adaptive-memory effects in Deck-managed OpenCode developer sessions with the official Supermemory plugin. Deck installs the reviewed, pinned plugin and routes one user-managed API token per managed process: a configured literal Git SSH `Host` alias selects its profile; every unresolved alias or non-SSH project uses the configured default. When Deck can verify its existing canonical GitHub repository identity, it also supplies the stable `sm_project_v1_<owner>_<repository>` tag; otherwise it supplies no tag and lets the plugin choose its own. Supermemory alone owns recall, capture, injection, and compaction behavior.

## Scope and authority

- OpenCode only; Pi and Codex memory behavior remains unchanged.
- A thin, version-pinned loader compatibility adapter may translate the official plugin's entry-point shape for the supported OpenCode generation; it MUST delegate unchanged hooks to the official plugin and MUST NOT implement memory behavior.
- Remove Deck's OpenCode memory runtime/bridge, tools, policies, injection, and content instructions. Reuse only Deck's trusted repository identity as a plugin tag hint, never its memory transport. Keep Context Mode as MCP.
- The user explicitly selected the stable binary's `static-compatible` OpenCode Apply behavior instead of activating invocation-required mode before a trusted host authority provider exists. This reduces Deck's invocation-scoped protection for this OpenCode cohort; native OpenCode permissions remain. It does not alter Pi, Codex, or the strict-mode validation implementation.
- Keep existing global/project plugins in managed OpenCode sessions. The user explicitly accepted that any co-loaded plugin can access the selected process token.
- Preserve historical OpenSpec changes; this change supersedes their **OpenCode-only Deck-managed memory requirements** upon approval, not their other-runner, authorization, or general source-authority requirements.

## Rollback and non-goals

Roll back only Deck-owned plugin installation/registration and OpenCode routing after a failed install, without deleting user-managed plugins, credentials, remote memories, or other runners' configuration. Never silently reactivate an older Deck memory runtime. No content migration, retagging, dual-writing, external account manipulation, or user OpenCode upgrade is authorized.

## Release gate

Source/hook tests do not prove actual OpenCode-process composition. Do not claim runtime readiness until a pinned OpenCode process exercises the chosen static-compatible/native-permission boundary, the official Supermemory artifact, normal plugin coexistence, RTK and Context Mode MCP; document any unverified lifecycle scenario. This change remains in Apply until the gate is met or explicit risk acceptance is obtained.
