import { describe, expect, test } from "bun:test";

import { buildCodexLaunchPlan } from "./launch";

const features = { interactive: true, exec: true, resumeById: true, resumeLatest: true } as const;

describe("buildCodexLaunchPlan", () => {
  test("builds exact interactive, stdin-backed exec, and resume grammar without dangerous defaults", () => {
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }, features)).toMatchObject({
      status: "ready",
      plan: { command: "codex", args: [], cwd: "/p", stdio: "inherit" },
    });
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["fix", "it"], stdin: "closed", stdinPayload: { type: "utf8", content: "fix it" } }, features)).toMatchObject({
      status: "ready",
      plan: { args: ["exec", "-"], stdio: "pipe", stdin: "closed", stdinPayload: { type: "utf8", content: "fix it" } },
    });
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "abc" }, features)).toMatchObject({
      status: "ready", plan: { args: ["resume", "abc"] },
    });
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" }, features)).toMatchObject({
      status: "ready", plan: { args: ["resume", "--last"] },
    });
    expect(JSON.stringify(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }, features))).not.toContain("dangerously");
  });

  test("keeps flag-shaped prompts in stdin and blocks option-like resume ids", () => {
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["--dangerously-bypass-approvals-and-sandbox"], stdin: "closed", stdinPayload: { type: "utf8", content: "--dangerously-bypass-approvals-and-sandbox" } }, features)).toMatchObject({
      status: "ready",
      plan: { args: ["exec", "-"], stdinPayload: { type: "utf8", content: "--dangerously-bypass-approvals-and-sandbox" } },
    });
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "--last" }, features)).toMatchObject({
      status: "blocked",
      code: "codex-invalid-session-id",
    });
  });

  test("normalizes exec stdin to the generic payload execution contract", () => {
    const result = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["safe"], stdin: "inherit", stdinPayload: { type: "utf8", content: "safe" } },
      features,
    );
    expect(result).toMatchObject({
      status: "ready",
      plan: { args: ["exec", "-"], stdio: "pipe", stdin: "closed", stdinPayload: { type: "utf8", content: "safe" } },
    });
  });

  test("returns unsupported separately and omits unknown reasoning", () => {
    expect(buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" }, { ...features, resumeLatest: false })).toMatchObject({ status: "unsupported" });
    const result = buildCodexLaunchPlan({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "invented" }, features);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.plan.args).not.toContain("invented");
  });

  test("emits only the exact effort advertised for the selected Codex model", () => {
    const accepted = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "ultra" },
      features,
      ["low", "max", "ultra"],
    );
    const rejected = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "ultra" },
      features,
      ["medium"],
    );
    expect(accepted).toMatchObject({ status: "ready", plan: { args: ["-c", 'model_reasoning_effort="ultra"'] } });
    expect(rejected).toMatchObject({ status: "ready", plan: { args: [] } });
  });

  test("injects bounded root Lead instructions only for new sessions", () => {
    const bootstrap = "This root session is Deck Lead. Load .agents/skills/deck-lead/SKILL.md and do not ask the user to repeat role selection.";
    const interactive = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "interactive", modelId: "gpt-5.6-sol", reasoningLevel: "high" },
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );
    const exec = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["quoted", "line\nnext"], stdin: "closed", stdinPayload: { type: "utf8", content: "quoted line\nnext" }, modelId: "gpt-5.6-sol", reasoningLevel: "high" },
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );
    const resume = buildCodexLaunchPlan(
      { projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1", modelId: "gpt-5.6-sol", reasoningLevel: "high" },
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );

    expect(interactive).toMatchObject({
      status: "ready",
      plan: {
        args: ["-c", `developer_instructions=${JSON.stringify(bootstrap)}`, "--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"'],
        stdio: "inherit",
        stdin: "inherit",
      },
    });
    expect(exec).toMatchObject({
      status: "ready",
      plan: { args: ["-c", `developer_instructions=${JSON.stringify(bootstrap)}`, "--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"', "exec", "-"], stdinPayload: { type: "utf8", content: "quoted line\nnext" } },
    });
    expect(JSON.stringify(exec)).not.toContain("--agent");
    expect(resume).toMatchObject({ status: "ready", plan: { args: ["resume", "session-1"] } });
    expect(JSON.stringify(resume)).not.toContain("developer_instructions");
    expect(JSON.stringify(resume)).not.toContain("model_reasoning_effort");
  });
});
