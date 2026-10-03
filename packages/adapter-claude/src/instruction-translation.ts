import { translateCapabilityInstructions, type InstructionTranslationRules } from "../../core/src/teams/developer/instruction-bundles/runner-translation";
import type { CapabilityInstructionBundle } from "../../core/src/index";

const SERENA_DISABLED_LINE = /These tools are explicitly disabled because OpenCode or other packages handle them/;
const RTK_OPENCODE_LINE = /rtk init -g --opencode/;
const RTK_BYPASS_LINE = /^Built-in tools \(Read(?:\/|, )Grep(?:\/|, )Glob\)/;

const CLAUDE_RULES: InstructionTranslationRules = {
  sections: [],
  lines: [
    { match: RTK_OPENCODE_LINE, replacement: undefined },
    { match: SERENA_DISABLED_LINE, replacement: "These tools are not requested by the Serena package because the runner or other packages handle them:" },
  ],
};


export function translateClaudeCapabilityInstructions(bundle: CapabilityInstructionBundle | undefined): CapabilityInstructionBundle | undefined {
  return translateCapabilityInstructions(bundle, CLAUDE_RULES);
}
