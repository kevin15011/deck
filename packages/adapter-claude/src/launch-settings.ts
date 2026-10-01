/**
 * Session-only Claude Code settings for Deck-launched sessions. Passed via `--settings`, so no user or project
 * settings file is written. Empty strings suppress the Co-Authored-By commit trailer and the PR attribution line.
 */
export const CLAUDE_ATTRIBUTION_SETTINGS_JSON = JSON.stringify({ attribution: { commit: "", pr: "" } });
export const CLAUDE_ATTRIBUTION_SETTINGS_ARGS: readonly string[] = ["--settings", CLAUDE_ATTRIBUTION_SETTINGS_JSON];
