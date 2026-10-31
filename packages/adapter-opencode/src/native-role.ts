import type { NativeRoleDescriptor } from "@deck/core/session/driver";
import { readOpenCodeNativeRole } from "./native-role-source";
export { openCodeRoleGeneration } from "./native-role-source";
export const prepareOpenCodeNativeRole = readOpenCodeNativeRole;
export function verifyOpenCodeNativeRole(role: NativeRoleDescriptor): void {
  const { preparation: _, ...current } = prepareOpenCodeNativeRole(role.source.root, role.roleId);
  const { preparation: __, ...captured } = role;
  if (role.runnerId !== "opencode" || JSON.stringify(current) !== JSON.stringify(captured)) throw new Error("opencode-session-role-changed: prepare the selected role again before launch");
}
