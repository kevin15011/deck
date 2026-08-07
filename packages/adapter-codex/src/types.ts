import type { RunnerDiagnostic } from "@deck/core";

export type CodexInventory = {
  agentRoleIds: readonly string[];
  agentBoundSkillIds: readonly string[];
  externalStandaloneSkillIds: readonly string[];
  bootstrapSkillIds: readonly string[];
};

export type CodexPreimage =
  | { kind: "absent" }
  | { kind: "file"; hash: string; mode: number };

export type CodexMutation = {
  operation?: "write" | "delete";
  relativePath: string;
  expected: CodexPreimage;
  postimageHash: string;
  postimageMode: number;
  ownership: {
    kind: "deck-file" | "deck-manifest" | "marker-span" | "toml-key" | "git-exclude-block";
    marker: string;
  };
  rollback: "restore" | "delete";
  content: string;
};

export type CodexExpectedFile = {
  relativePath: string;
  hash: string;
  content: string;
  mode: number;
  kind: "role" | "agent-skill" | "external-skill" | "bootstrap-skill" | "instructions" | "config" | "ownership-manifest" | "git-exclude" | "bridge-hook";
};

export type CodexMutationPlan = {
  projectRoot: string;
  mutations: readonly CodexMutation[];
  expectedFiles: readonly CodexExpectedFile[];
  inventory: CodexInventory;
  diagnostics: readonly RunnerDiagnostic[];
  blocked: boolean;
};

export type CodexReleaseFixture = {
  version: string;
  capturedFrom: readonly string[];
  help: string;
  execHelp: string;
  resumeHelp: string;
  features: readonly string[];
  config: {
    roles: boolean;
    skills: boolean;
    projectConfig: boolean;
    projectDenylist: readonly string[];
    mcpStdio: boolean;
    mcpStreamableHttp: boolean;
    modelKey: string;
    reasoningKey: string;
  };
};
