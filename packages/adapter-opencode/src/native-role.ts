import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NativeRoleDescriptor } from "@deck/core/session/driver";
import executionPluginAssetPath from "../assets/opencode/plugins/developer-team-execution.generated.js" with { type: "file" };
import { readOpenCodeNativeRole } from "./native-role-source";
export { openCodeRoleGeneration } from "./native-role-source";
export function prepareOpenCodeNativeRole(root: string, roleId: string): NativeRoleDescriptor {
  const role = readOpenCodeNativeRole(root, roleId);
  if (readFileSync(join(root, "plugins/developer-team-execution.js"), "utf8") !== readFileSync(executionPluginAssetPath, "utf8")) throw new Error("opencode-session-generation-unverified");
  return role;
}
export function verifyOpenCodeNativeRole(role: NativeRoleDescriptor): void {
  if (role.runnerId !== "opencode" || JSON.stringify(prepareOpenCodeNativeRole(role.source.root,role.roleId)) !== JSON.stringify(role)) throw new Error("opencode-session-generation-unverified");
}
