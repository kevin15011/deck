// Claude-flavoured aliases over the runner-neutral owned Codebase Memory artifact in @deck/core.
export {
  OWNED_CODEBASE_VERSION as CLAUDE_CODEBASE_VERSION,
  OWNED_CODEBASE_RELEASES as CLAUDE_CODEBASE_RELEASES,
  pinnedOwnedCodebaseRelease as pinnedClaudeCodebaseRelease,
  inspectOwnedCodebase as inspectOwnedClaudeCodebase,
  installOwnedCodebase as installOwnedClaudeCodebase,
  type CodebaseNativeRelease,
} from "../../core/src/owned-tools/codebase-native-artifact";
