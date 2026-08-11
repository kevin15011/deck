# Specification: Consolidate Global Deck Configuration

## Requirements

### REQ-GCFG-001 — Canonical source

Deck MUST use `$XDG_CONFIG_HOME/deck/config.json`, defaulting to `~/.config/deck/config.json`, as the only active source for user and runner preferences.

**Scenario:** Given Deck runs in two unrelated projects, when both sessions load preferences, then both MUST resolve the same canonical global values.

### REQ-GCFG-002 — Target/config separation

Project-root resolution MUST select only execution and project-materialization targets. It MUST NOT select preference storage.

**Scenario:** Given Deck runs in an ordinary repository or workspace, when a preference changes, then Deck MUST NOT create or update `<project>/.deck/config.json`.

### REQ-GCFG-003 — Field ownership

`adaptiveMemory`, `webSearch`, `packageInstructions`, `orchestratorPersonality`, and `developerTeamExecution` MUST be global. Schema `version` MUST be runtime-derived. Legacy project-local `profiles` and `activeProfile` MUST be preserved but MUST NOT override active global preferences; future project policy belongs to OpenSpec configuration.

### REQ-GCFG-004 — Adapter neutrality

Adapters MUST consume caller-resolved configuration or derived inputs and MUST NOT re-read `<project>/.deck/config.json` for Deck preferences.

### REQ-GCFG-005 — Safe migration

Deck MUST inspect existing XDG and legacy candidates without modifying sources. If canonical XDG config is absent and exactly one valid legacy source exists, Deck MAY import global fields atomically. Conflicting valid sources MUST produce an explicit bounded choice or blocking diagnostic; Deck MUST NOT silently choose one.

### REQ-GCFG-006 — Preservation

Preference updates MUST patch the current canonical config and preserve unrelated fields, including custom Supermemory settings. Writes MUST be atomic and recoverable.

### REQ-GCFG-007 — Consistent entry points

TUI, direct launch, upgrade, sync, Doctor/readiness, and standalone smoke MUST resolve the same canonical config.

### REQ-GCFG-008 — Legacy compatibility

`readDeckConfig(projectRoot)` and project-local files MAY remain as explicit migration/test compatibility surfaces, but production preference behavior MUST NOT depend on them.

### REQ-GCFG-009 — Binary independence

The compiled binary MUST resolve and persist global configuration outside any repository and without workspace or `node_modules` lookup.

### REQ-GCFG-010 — Secret boundary

The global Deck config MUST NOT contain provider credentials. Existing Web Search shell-profile and runner-native secret boundaries remain unchanged.
