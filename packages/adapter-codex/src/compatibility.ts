import type { CodexReleaseFixture } from "./types";
import { CAPTURED_CODEX_LAUNCH_NEGATIVE_FIXTURES, CAPTURED_CODEX_RELEASE_FIXTURES } from "./__fixtures__/codex/releases";

/** Captured from released npm packages; tests consume these constants without network access. */
export const CODEX_RELEASE_FIXTURES = CAPTURED_CODEX_RELEASE_FIXTURES;
export const CODEX_LAUNCH_NEGATIVE_FIXTURES = CAPTURED_CODEX_LAUNCH_NEGATIVE_FIXTURES;

export function inspectCodexCompatibility(release: CodexReleaseFixture) {
  const supportsExec = /\bexec\b/.test(release.help) && /Usage: codex exec/.test(release.execHelp);
  const supportsResume = /\bresume\b/.test(release.help) && /\[SESSION_ID\]/.test(release.resumeHelp);
  const hooksStable = release.features.includes("hooks:stable");
  return {
    version: release.version,
    launch: {
      interactive: /Usage: codex/.test(release.help),
      exec: supportsExec,
      resumeById: supportsResume,
      resumeLatest: supportsResume && /--last/.test(release.resumeHelp),
    },
    roles: release.config.roles,
    skills: release.config.skills,
    projectConfig: release.config.projectConfig,
    projectDenylist: release.config.projectDenylist,
    multiAgent: release.features.includes("multi_agent:stable"),
    mcp: { stdio: release.config.mcpStdio, streamableHttp: release.config.mcpStreamableHttp },
    models: { modelKey: release.config.modelKey, reasoningKey: release.config.reasoningKey },
    executionClass: "static-compatible" as const,
    routeClassifications: {
      interactive: "static-compatible" as const,
      exec: "static-compatible" as const,
      resumeById: "static-compatible" as const,
      resumeLatest: "static-compatible" as const,
    },
    trustedBridge: {
      releasedCandidate: hooksStable ? "hooks" as const : null,
      proven: false,
      gaps: Object.freeze([
        "protected-production-route-binding",
        "dossier-revision-continuity",
        "one-use-invocation-authorization",
        "controlled-effects",
        "centralized-registry-cas-wal",
        "bound-verification-evidence",
      ]),
      reason: hooksStable
        ? "Released hooks expose trusted lifecycle events; Deck binds adaptive memory at launch time, while protected execution controls remain unpromoted."
        : "No stable released trusted host surface is available.",
    },
  };
}
