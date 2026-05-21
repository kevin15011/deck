import type { CapabilityInstructionBundle, CapabilityInstructionFragment } from "./index";

/**
 * Canonical instruction content for the RTK CLI proxy package.
 *
 * Source: https://github.com/rtk-ai/rtk
 *
 * RTK (Rust Token Killer) intercepts common CLI commands and rewrites them
 * to produce compact, token-optimized output — 60-90% fewer tokens.
 */
export function buildRtkInstructionBundle(): CapabilityInstructionBundle {
  const fragments: CapabilityInstructionFragment[] = [
    {
      packageId: "rtk",
      surface: "agent",
      markdown: `## RTK CLI Proxy Package

RTK (Rust Token Killer) transparently intercepts Bash commands and rewrites them to \`rtk\` equivalents for 60-90% token savings. This is automatic when the RTK hook is active.

### Installation

- **\`rtk init -g\`** — install the global Bash hook for automatic command interception
- **\`rtk init -g --opencode\`** — install the hook specifically for OpenCode
- After installation, RTK automatically intercepts common CLI commands

### Commands

If the hook is NOT active, prefix verbose commands with \`rtk\` explicitly:
- **Git:** \`rtk git status\`, \`rtk git log\`, \`rtk git diff\`, \`rtk git push\`
- **Tests:** \`rtk npm test\`, \`rtk cargo test\`, \`rtk pytest\` (failures-only mode)
- **Docker:** \`rtk docker ps\`, \`rtk docker logs <container>\` (deduplicated)
- **Files:** \`rtk ls\`, \`rtk read <file>\`, \`rtk grep <pattern>\`

### Analytics

- **\`rtk gain\`** — show token savings statistics
- **\`rtk discover\`** — find missed opportunities for token optimization

### Commands NOT auto-rewritten by the hook

Built-in tools (Read, Grep, Glob) bypass the Bash hook. Use explicit \`rtk\` calls or shell commands (\`cat\`, \`rg\`, \`find\`) when you want RTK filtering for those workflows.`,
    },
    {
      packageId: "rtk",
      surface: "skill",
      markdown: `## RTK CLI Proxy Package

Token-optimized CLI proxy. Automatic via Bash hook when installed; fallback instructions for manual use.

### Installation

- **\`rtk init -g\`** — install global Bash hook for automatic command interception
- **\`rtk init -g --opencode\`** — install hook specifically for OpenCode

### Commands

- **Git:** \`rtk git status\`, \`rtk git log\`, \`rtk git diff\`, \`rtk git push\` (compact output)
- **Tests:** \`rtk npm test\`, \`rtk cargo test\`, \`rtk pytest\` (failures-only mode)
- **Docker:** \`rtk docker ps\`, \`rtk docker logs <container>\` (deduplicated)
- **Files:** \`rtk ls\`, \`rtk read <file>\`, \`rtk grep <pattern>\` (token-optimized)

### Analytics

- **\`rtk gain\`** — show token savings statistics
- **\`rtk discover\`** — find missed opportunities for token optimization

### Hook Bypass

Built-in tools (Read/Grep/Glob) do NOT pass through the Bash hook. Use explicit \`rtk\` equivalents or shell commands (\`cat\`, \`rg\`, \`find\`) when you want RTK filtering for those workflows.`,
    },
  ];

  return { instructions: Object.freeze(fragments) };
}