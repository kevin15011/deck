# Configuration

Deck separates its own preferences, runner-native configuration, and credentials. The TUI writes normalized Deck configuration, while adapters own the files and package formats of the active runner.

> **Audience:** People configuring an installed Deck environment.
> **Authority:** Configuration reference; source validation and runner adapters define accepted fields and persistence behavior.
> **Maintainer:** Deck maintainers.
> **Evidence:** [Deck config](../packages/core/src/config/deck-config.ts), [XDG paths](../apps/cli/src/runtime/paths.ts), [TUI composition](../apps/cli/src/tui/app.tsx), [Pi adapter](../packages/adapter-pi/src/runner-adapter.ts), and [OpenCode adapter](../packages/adapter-opencode/src/runner-adapter.ts).

## Where settings live

Deck preferences have one active source: the global configuration file. Project roots are execution and materialization targets; Deck no longer creates or updates `<project>/.deck/config.json`, which is read only as legacy migration input.

| Purpose | Primary path | Environment override |
|---|---|---|
| Global JSON configuration | `~/.config/deck/config.json` | `$XDG_CONFIG_HOME/deck/config.json` |
| Global updater preferences | `~/.config/deck/config.yaml` | `$XDG_CONFIG_HOME/deck/config.yaml` |
| State and history | `~/.local/state/deck/` | `$XDG_STATE_HOME/deck/` |
| Release cache and backups | `~/.cache/deck/` | `$XDG_CACHE_HOME/deck/` |

Legacy configuration locations can be read for migration compatibility. New writes use the primary XDG layout. Runner-native files remain in the runner's own locations; Deck does not turn those files into a universal schema.

## Normalized Deck config

The supported top-level fields are:

- `version` — currently `1`.
- `adaptiveMemory` — active provider and non-secret Supermemory options.
- `webSearch` — `enabled` and the selected `provider` (for example Tavily); the provider credential stays in its environment variable.
- `capabilities.codebase-memory` — explicit global activation (default false), with optional boolean `runners` exceptions. A runner exception overrides the global value.
- `packageInstructions` — per-runner guidance for Code Economy, RTK and Adaptive Memory. The Codebase Memory view derives from explicit activation.
- `orchestratorPersonality` — `guia` or `pragmatica`; the default is `pragmatica`.
- `developerTeamExecution` — advanced execution-contract, routing, authorization, prompt, telemetry, and cohort controls.
- `profiles` and `activeProfile` — named configuration profiles.
- `crossRunner` — cross-runner sessions: `enabled`, per-member `members` assignments (`runnerId`, `modelId`, optional `thinking`), `maxConcurrentTasks`, `executionBudget`, and the `web` listener settings. The legacy `approvals` field is deprecated and ignored. See [Cross-runner sessions](cross-runner-sessions.md).

A minimal, credential-free example is:

```json
{
  "version": 1,
  "adaptiveMemory": {
    "enabled": false
  },
  "capabilities": {
    "codebase-memory": { "enabled": false, "runners": {} }
  },
  "orchestratorPersonality": "pragmatica",
  "packageInstructions": {
    "pi": {
      "code-economy": true,
      "rtk": true
    },
    "opencode": {
      "code-economy": true,
      "rtk": true
    }
  }
}
```

Unknown fields, unsupported versions, invalid enum values, malformed JSON, and credential-like fields are rejected. Do not place tokens, API keys, passwords, or other secrets in `config.json`.

## Packages and MCP

The runner dashboard shows package evidence and lets you toggle configurable or optional capabilities. Required or internal runner packages are not treated as ordinary toggles. Deck checks whether a binary is usable and whether an MCP entry is configured; a package declaration by itself is not proof of a working tool.

The shared capability set includes explicitly activated Codebase Memory, RTK, Context7, and Supermemory tool bindings. Legacy Context Mode and Serena keys are ignored and omitted from canonical writes; legacy Codebase Memory package toggles do not enable the capability. The exact install/configuration action is runner-specific. Use [Runners](runners.md) when the same capability has different effects on each runner.

Package instructions are separate from adaptive-memory context. Enabled package instructions are official configured prompt content; memory is auxiliary context injected by the selected provider.

## Adaptive memory

Adaptive Memory is a boolean product setting: **Disabled** or **Enabled**. Legacy `activeProvider` values are normalized only for compatibility (`supermemory` maps to enabled, `none` maps to disabled). The launch flag `--memory=none` overrides globally enabled config for that launch on `deck pi developer`, `deck opencode developer` and `deck codex developer`; `deck claude developer` has no memory flag. Supermemory setup is runner-specific:

| Runner | Setup input and effect | Persisted configuration boundary |
|---|---|---|
| Pi | The TUI validates a token and stores the runtime credential in Deck's owner-only secret store. Pi receives only the Deck loopback endpoint and a `0600` token-file path; no credential or Supermemory MCP entry is written to Pi configuration. | Deck config stores only Adaptive Memory enablement and non-secret options; the token is not written to Deck's `config.json` or Pi configuration. |
| OpenCode, Claude and Codex | Deck installs the pinned official Supermemory plugin for the runner. The TUI validates the Supermemory key and stores it as a shared profile credential in Deck's owner-only secret store; Deck injects it only into the runner process it starts. | No credential is written to runner configuration, and a raw Supermemory MCP entry is never registered beside the plugin. |

See [Adaptive memory](adaptive-memory.md) for provider behavior and governance.

## Profiles

`profiles` is an optional array of named configuration profiles. `activeProfile` selects one by name; when no profiles are supplied, the normalized default is `default`. The table describes the supported profile shape and the runtime checks that are currently enforced:

| Field | Accepted shape | Default or audience |
|---|---|---|
| `name` | Required non-empty string; runtime checks uniqueness across profiles. | All profile users. |
| `description` | Optional string in the TypeScript profile shape; the runtime normalizer does not type-check this field. | No default. |
| `strategy` | Optional `generated-multi` or `external-single-active`; runtime checks this enum when present. | No default; advanced profile selection. |
| `phaseOverrides` | Optional non-array object; runtime checks only that keys are `explore`, `proposal`, `spec`, `design`, `tasks`, `apply`, `verify`, `review`, `archive`, or `onboard`. Individual override values are not deeply validated. | No default; advanced workflow configuration. |
| `activeProfile` | Optional top-level string matching a profile name, or `default`; runtime checks the selected name. | `default`. |

The profile schema accepts partial phase overrides; it does not require every phase to be present. A clear low-risk route does not require creating a profile.

## Models and reasoning

The TUI discovers model choices through the active runner. Pi reads its settings, `pi --list-models`, and provider environment variables when available. OpenCode uses runner-native discovery and model-specific variants. Codex and Claude have their own model discovery screens based on runtime-reported metadata; account entitlement is not guaranteed.

The Developer Team can assign a model and reasoning/thinking level to each of its seven roles. Pi exposes `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`; OpenCode choices come from the selected model's available reasoning variants. If a model does not expose reasoning, Deck hides the unsupported choice or falls back to `off` according to the runner contract.

## Advanced execution controls

The `developerTeamExecution` section is optional advanced configuration. Normal users can keep the normalized defaults; maintainers and operators use these fields when a controlled execution policy must be selected.

| Field | Accepted values/shape | Normalized default | Intended audience |
|---|---|---|---|
| `schema` | `developer-team-execution-config-v1` only. | `developer-team-execution-config-v1` | Advanced configuration authors. |
| `executionContracts` | `off`, `observe`, or `enforce`. | `observe` | Operators selecting contract enforcement. |
| `decisionKernel` | `legacy`, `shadow`, or `active`. | `shadow` | Operators comparing decision behavior. |
| `invocationAuthorization` | Object with `default`, optional `opencode`, and optional `pi`; each is `static-compatible` or `invocation-required`. | `{ "default": "static-compatible" }` | Operators managing invocation boundaries. |
| `registryWriter` | `distributed-compatible` or `centralized`. | `distributed-compatible` | Maintainers controlling registry persistence mode. |
| `routePolicy` | `legacy-triage`, `shadow-risk-lanes`, or `risk-lanes`. | `legacy-triage` | Operators selecting routing policy. |
| `promptProfile` | `legacy` or `compact`. | `compact` | Advanced prompt/profile configuration. |
| `telemetry` | `off` or `local-safe`. | `off` | Operators who explicitly need local evidence. |
| `cohortPercent` | Finite number from `0` through `100`. | `0` | Maintainers controlling rollout exposure. |

The safe default keeps execution in observe/shadow mode with no cohort rollout and telemetry off. See [Developer Team execution](maintainers/developer-team-execution.md) for maintainer-facing rollout evidence.

## Persistence checklist

1. Select the active runner in the TUI.
2. Review the package and MCP evidence before applying changes.
3. Keep the Supermemory credential in Deck's protected secret store (a shared profile for OpenCode, Claude, and Codex; the Deck runtime key for Pi). Do not place bearer tokens in runner MCP or hook config.
4. Run `deck doctor` after changing runner configuration.
5. Use [Troubleshooting](troubleshooting.md) when a value is rejected or a runner remains indeterminate.

## Review legacy package cleanup

Run `deck runner cleanup --plan --json` to inspect exact proposed removals without writing configuration, manifests or backups. Add `--runner codex|claude|opencode|pi` to limit the report. `--output /path/to/plan.json` explicitly saves the report.

`deck runner cleanup --review` displays each entry, its surrounding keys, ownership and exact proposed deletion. Ambiguous entries require individual confirmation; Enter/EOF keeps them. A changed file invalidates the confirmation and requires a new preview. Dedicated Deck installation locations and matching granular manifest records establish ownership; names and legacy marker comments alone do not. Independent integrations and unrecorded data remain preserved.

Review the concrete plan before applying it to an existing installation. Planning never calls the migrating upgrade-manifest reader or prepares packages.

Updates apply proven-owned removals automatically when daemon admission establishes an idle boundary. Interactive updates present the safe plan and ask separately about every ambiguous entry; unattended updates keep those entries. `--yes` is not consent to remove ambiguity. `deck doctor` reports retained contributions, active-work deferral and pending contribution recovery. Planning is available during active work. Unknown activity, an older daemon without mutation admission, or offline session history defers mutation; retry explicitly after an authoritative current daemon can establish idle. Deck does not interrupt work or schedule a delayed apply.

Retirement preserves exact preimages in each runner's existing backup directory as `<sha256>.pre-retirement`. Update rollback uses the existing upgrade/adapter recovery paths; pending `manifest.json.pending` receipts must be inspected before retry. Restore only a reviewed preimage after checking for subsequent user edits. Planning creates neither backups nor recovery receipts.

For Claude, content update must publish and verify a replacement plugin and update its selection before new launches use it. Old processes, launch receipts, selected generations and pending recovery retain references. Replan after those references are released to collect retired MCP contributions. Binary installation alone does not prove replacement, and cleanup does not promise to remove whole old generations, user data or backups.
