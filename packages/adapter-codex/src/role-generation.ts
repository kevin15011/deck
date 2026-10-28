import { createHash } from "node:crypto";
import { buildDeveloperTeamManifest, buildCapabilityInstructionBundle, DEVELOPER_TEAM } from "@deck/core";
import { ROLE_TOOL_POLICY } from "@deck/core/session/role-tool-policy";
import { CODEX_ROLE_SELECTION } from "./role-bootstrap";
import { translateCodexCapabilityInstructions } from "./instruction-translation";

// Compare installed generation provenance to this build, independently of user model defaults.
// Canonical content is used only for verification, never supplied as the selected role body.
let generation: string | undefined;
export function codexRoleGeneration(): string {
  return generation ??= createHash("sha256").update(JSON.stringify({
    schema: 1,
    manifest: buildDeveloperTeamManifest({team:DEVELOPER_TEAM}).manifest,
    capabilities: translateCodexCapabilityInstructions(buildCapabilityInstructionBundle(["adaptive-memory", "codebase-memory", "code-economy", "rtk", "web-search"])),
    roleSelection: CODEX_ROLE_SELECTION,
    policy: ROLE_TOOL_POLICY,
  })).digest("hex");
}
