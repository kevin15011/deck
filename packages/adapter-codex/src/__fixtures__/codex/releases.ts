import type { CodexReleaseFixture } from "../../types";

const ROOT_HELP = `Codex CLI
Usage: codex [OPTIONS] [PROMPT]
       codex [OPTIONS] <COMMAND> [ARGS]
Commands:
  exec    Run Codex non-interactively
  resume  Resume a previous interactive session`;
const EXEC_HELP = `Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT]
       codex exec [OPTIONS] <COMMAND> [ARGS]`;
const RESUME_HELP = `Resume a previous interactive session
Usage: codex resume [OPTIONS] [SESSION_ID] [PROMPT]
  --last  Continue the most recent session`;

function captured(version: string): CodexReleaseFixture {
  return {
    version,
    capturedFrom: [
      `npx -y @openai/codex@${version} --help`,
      `npx -y @openai/codex@${version} exec --help`,
      `npx -y @openai/codex@${version} resume --help`,
      `npx -y @openai/codex@${version} features list`,
    ],
    help: ROOT_HELP,
    execHelp: EXEC_HELP,
    resumeHelp: RESUME_HELP,
    features: ["hooks:stable", "multi_agent:stable", "plugins:stable"],
    config: {
      roles: true,
      skills: true,
      projectConfig: true,
      projectDenylist: ["openai_base_url", "chatgpt_base_url", "model_provider", "model_providers", "profile", "profiles", "otel"],
      mcpStdio: true,
      mcpStreamableHttp: true,
      modelKey: "model",
      reasoningKey: "model_reasoning_effort",
    },
  };
}

export const CAPTURED_CODEX_RELEASE_FIXTURES = Object.freeze([captured("0.145.0"), captured("0.146.1")]);

const minimum = CAPTURED_CODEX_RELEASE_FIXTURES[0]!;
export const CAPTURED_CODEX_LAUNCH_NEGATIVE_FIXTURES = Object.freeze([
  { mode: "interactive", fixture: { ...minimum, help: "Codex CLI\nCommands: exec resume" } },
  { mode: "exec", fixture: { ...minimum, execHelp: "Run Codex non-interactively" } },
  { mode: "resumeById", fixture: { ...minimum, resumeHelp: "Usage: codex resume [OPTIONS]" } },
  { mode: "resumeLatest", fixture: { ...minimum, resumeHelp: "Usage: codex resume [OPTIONS] [SESSION_ID]" } },
] as const);
