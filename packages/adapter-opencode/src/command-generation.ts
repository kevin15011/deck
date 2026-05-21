/**
 * Command file generation for OpenCode Developer Team.
 *
 * Generates 14 slash command files in `~/.config/opencode/commands/` with YAML frontmatter.
 * Each command routes to the orchestrator with SDD phase gates.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlannedCommandFile = {
  commandId: string;
  absolutePath: string;
  content: string;
};

export type GenerateCommandFilesOptions = {
  configDir?: string;
  writeFile?: (path: string, content: string, encoding: "utf-8") => void;
  mkdir?: (path: string, opts: { recursive: true }) => void;
};

// ---------------------------------------------------------------------------
// Command catalog — 14 commands
// ---------------------------------------------------------------------------

type CommandDef = {
  id: string;
  description: string;
  hardGates: string[];
  dependencyCheck: string;
  taskBlock: string;
};

const COMMAND_DEFS: CommandDef[] = [
  {
    id: "sdd-apply",
    description: "Implement SDD tasks — writes code following specs and design",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist or be run after preflight.",
      "The active change must have spec, design, and tasks artifacts.",
      "Review workload guard must have passed.",
    ],
    dependencyCheck: "If spec, design, or tasks are missing, do NOT implement. Tell the user to run `/sdd-new <change>` or `/sdd-ff <change>` first.",
    taskBlock: "Launch the hidden `sdd-apply` sub-agent with the resolved artifact store, delivery strategy, and TDD mode.",
  },
  {
    id: "sdd-archive",
    description: "Archive completed change — close the change, preserve traceability",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "All SDD phase artifacts must exist (proposal, spec, design, tasks, apply-progress).",
    ],
    dependencyCheck: "If any phase artifacts are missing, do NOT archive. Ask the user to complete the change first.",
    taskBlock: "Launch the hidden `sdd-archive` sub-agent with all relevant phase artifacts.",
  },
  {
    id: "sdd-design",
    description: "Create technical design — architecture, tradeoffs, file impact",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "A proposal artifact must exist for the active change.",
    ],
    dependencyCheck: "If proposal is missing, do NOT design. Tell the user to run `/sdd-propose <change>` first.",
    taskBlock: "Launch the hidden `sdd-design` sub-agent with the proposal artifact reference.",
  },
  {
    id: "sdd-explore",
    description: "Explore ideas — investigate code, architecture, constraints",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
    ],
    dependencyCheck: "If `sdd-init` has not been run, ask the user to run `/sdd-init` first.",
    taskBlock: "Launch the hidden `sdd-explore` sub-agent for the active change.",
  },
  {
    id: "sdd-init",
    description: "Initialize SDD context — set up session, artifact store, delivery strategy",
    hardGates: [],
    dependencyCheck: "",
    taskBlock: "Launch the hidden `sdd-init` sub-agent to initialize the session context.",
  },
  {
    id: "sdd-new",
    description: "Start new change — delegates explore + propose for a new change name",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
    ],
    dependencyCheck: "",
    taskBlock: "Delegate to `sdd-explore` with the provided change name, then `sdd-propose`.",
  },
  {
    id: "sdd-continue",
    description: "Continue next phase — detects current phase and advances",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
    ],
    dependencyCheck: "If no change is active, ask the user to specify a change name.",
    taskBlock: "Detect current phase from existing artifacts and delegate to the next appropriate sub-agent.",
  },
  {
    id: "sdd-ff",
    description: "Fast-forward planning — proposal → specs → design → tasks in one pass",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
    ],
    dependencyCheck: "",
    taskBlock: "Launch the hidden `sdd-propose` sub-agent, then automatically chain to spec, design, and tasks.",
  },
  {
    id: "sdd-onboard",
    description: "Guided SDD walkthrough — learn the SDD workflow interactively",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
    ],
    dependencyCheck: "",
    taskBlock: "Launch the hidden `sdd-onboard` sub-agent for interactive guided walkthrough.",
  },
  {
    id: "sdd-propose",
    description: "Create change proposal — intent, scope, approach, risks, rollback",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
    ],
    dependencyCheck: "If `sdd-init` has not been run, ask the user to run `/sdd-init` first.",
    taskBlock: "Launch the hidden `sdd-propose` sub-agent for the active change.",
  },
  {
    id: "sdd-review",
    description: "Code review — engineering quality, architecture, security, scalability",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "An apply-progress artifact must exist.",
    ],
    dependencyCheck: "If apply-progress is missing, ask the user to run `/sdd-apply` first.",
    taskBlock: "Launch the hidden `sdd-review` sub-agent with the apply-progress and changed files reference.",
  },
  {
    id: "sdd-spec",
    description: "Write specifications — formal requirements and acceptance scenarios",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "A proposal artifact must exist for the active change.",
    ],
    dependencyCheck: "If proposal is missing, do NOT spec. Tell the user to run `/sdd-propose <change>` first.",
    taskBlock: "Launch the hidden `sdd-spec` sub-agent with the proposal and design artifacts.",
  },
  {
    id: "sdd-tasks",
    description: "Break into tasks — convert spec + design into atomic implementation tasks",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "Both spec and design artifacts must exist for the active change.",
    ],
    dependencyCheck: "If spec or design is missing, do NOT tasks. Tell the user to run `/sdd-spec` and `/sdd-design` first.",
    taskBlock: "Launch the hidden `sdd-task` sub-agent with spec and design artifact references.",
  },
  {
    id: "sdd-verify",
    description: "Validate implementation — spec compliance, tests, typecheck, build",
    hardGates: [
      "SDD Session Preflight must already be complete for this session.",
      "`sdd-init` must already exist.",
      "Both spec and tasks artifacts must exist for the active change.",
      "An apply-progress artifact must exist.",
    ],
    dependencyCheck: "If spec, tasks, or apply-progress is missing, do NOT verify. Ask the user to complete those phases first.",
    taskBlock: "Launch the hidden `sdd-verify` sub-agent with spec, tasks, and apply-progress references.",
  },
];

// ---------------------------------------------------------------------------
// Build command content
// ---------------------------------------------------------------------------

function buildCommandContent(def: CommandDef): string {
  const gates = def.hardGates.length > 0
    ? ["HARD GATES:", "", ...def.hardGates.map((g) => `${g}`)].join("\n")
    : "";

  const body = [
    "CONTEXT:",
    "",
    "- Working directory: !`pwd`",
    "- Current project: !`basename \"$(pwd)\"`",
    "",
    gates,
    "",
    def.dependencyCheck ? `DEPENDENCY CHECK:\n\n${def.dependencyCheck}` : "",
    "",
    "TASK:",
    "",
    `If all gates pass, ${def.taskBlock}`,
    "",
    "Return a structured orchestration result.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    "---",
    `description: ${def.description}`,
    "agent: deck-developer-orchestrator",
    "subtask: true",
    "---",
    "",
    body,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generate plan
// ---------------------------------------------------------------------------

export function buildCommandGenerationPlan(options: { configDir: string }): PlannedCommandFile[] {
  const { configDir } = options;
  const commandsDir = join(configDir, "commands");

  return COMMAND_DEFS.map((def): PlannedCommandFile => {
    const commandPath = join(commandsDir, `${def.id}.md`);
    return {
      commandId: def.id,
      absolutePath: commandPath,
      content: buildCommandContent(def),
    };
  });
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applyCommandGeneration(plan: PlannedCommandFile[], options?: GenerateCommandFilesOptions): void {
  const writeFile = options?.writeFile ?? writeFileSync;
  const mkdir = options?.mkdir ?? mkdirSync;

  for (const planned of plan) {
    const dir = dirname(planned.absolutePath);
    mkdir(dir, { recursive: true });
    writeFile(planned.absolutePath, planned.content, "utf-8");
  }
}