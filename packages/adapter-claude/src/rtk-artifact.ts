// Claude-flavoured aliases over the runner-neutral owned RTK artifact in @deck/core.
export {
  OWNED_RTK_VERSION as CLAUDE_RTK_VERSION,
  OWNED_RTK_RELEASES as CLAUDE_RTK_RELEASES,
  pinnedOwnedRtkRelease as pinnedClaudeRtkRelease,
  inspectOwnedRtk as inspectOwnedClaudeRtk,
  extractPinnedRtk as extractPinnedClaudeRtk,
  installOwnedRtk as installOwnedClaudeRtk,
  type RtkReleaseArtifact,
} from "../../core/src/owned-tools/rtk-artifact";
