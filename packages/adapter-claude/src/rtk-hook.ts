import { pinRtkRewrite, rtkHookScript } from "../../core/src/owned-tools/rtk-hook";
export { pinRtkRewrite };
export const claudeRtkHookScript = (binary: string): string => rtkHookScript(binary, "claude");
