import { realpathSync } from "node:fs";
import { loadPreparedSessionStartContext } from "@deck/core/session/start-context";
import { createHash } from "node:crypto";
import { isCodebaseMemoryEnabled } from "@deck/core";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { ProjectPreparationService } from "../../../packages/sdd-runtime/src/execution/project-preparation";
import { composeSkillSessionStartContext } from "../../../packages/sdd-runtime/src/execution/session-start-context";
import { DeckConfigStore } from "./deck-config-store";

/** The installed hook invokes Deck directly, so readiness does not add a Node/RTK prerequisite. */
export async function claudeSessionStartContext(): Promise<string> {
  return await loadPreparedSessionStartContext(process.cwd()) ?? nativeClaudeSessionStartContext();
}

/** Read-only native Claude lifecycle delivery. No repair identity is inferred from hook input. */
export function nativeClaudeSessionStartContext(input?: { projectRoot: string; config: import("@deck/core").NormalizedDeckConfig; availability: "ready" | "unavailable" }): string {
  const projectRoot = realpathSync(input?.projectRoot ?? process.cwd());
  const config = input?.config ?? new DeckConfigStore({ allowDefaultEnvironment: true }).read();
  const enabled = isCodebaseMemoryEnabled(config, "claude");
  const scope = { projectRoot, sessionId: "native-claude", epoch: "native-session-start", policyDigest: createHash("sha256").update(JSON.stringify({ enabled })).digest("hex"),
    members: DEVELOPER_TEAM_AGENTS.map(role => ({ memberId: role.id.slice(5), runnerId: "claude", bindingId: `${role.id.slice(5)}@claude`, capabilities: { "codebase-memory": enabled ? { enabled: true, availability: role.id === "deck-lead" ? input?.availability ?? "unverified" as const : "unverified" as const } : { enabled: false } } })),
  };
  return composeSkillSessionStartContext(new ProjectPreparationService().status(scope)) + "\n\nNative preparation repair is unavailable until the runner can authenticate the selected Setup invocation and exact delegation. Readiness data does not authorize an alternative repair path.";
}
