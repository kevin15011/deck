import { describe, expect, test } from "bun:test";

import { getDefaultDeckConfig } from "@deck/core";
import { buildCodexLaunchPlan } from "./launch";

const features = { interactive: true, exec: true, resumeById: true, resumeLatest: true } as const;
const withDeckConfig = <T extends object>(input: T) => ({ ...input, deckConfig: getDefaultDeckConfig() });

describe("buildCodexLaunchPlan", () => {
  test("adds exactly one adapter-owned bypass token before every Codex subcommand", () => {
    const bypass = "--dangerously-bypass-approvals-and-sandbox";
    const routes = [
      { input: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" as const }), subcommand: undefined },
      { input: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec" as const, prompt: ["fix", "it"], stdin: "closed" as const, stdinPayload: { type: "utf8" as const, content: "fix it" } }), subcommand: "exec" },
      { input: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id" as const, sessionId: "abc" }), subcommand: "resume" },
      { input: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" as const }), subcommand: "resume" },
    ];

    for (const { input, subcommand } of routes) {
      const result = buildCodexLaunchPlan(input, features);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.plan.args.filter((arg) => arg === bypass)).toHaveLength(1);
      expect(result.plan.args[0]).toBe(bypass);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "codex-dangerous-bypass",
        severity: "warning",
        message: expect.stringContaining("sandboxing and command approvals are disabled"),
      }));
      if (subcommand) expect(result.plan.args.indexOf(bypass)).toBeLessThan(result.plan.args.indexOf(subcommand));
    }

    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }), features)).toMatchObject({
      status: "ready",
      plan: { command: "codex", args: [bypass], cwd: "/p", stdio: "inherit" },
    });
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["fix", "it"], stdin: "closed", stdinPayload: { type: "utf8", content: "fix it" } }), features)).toMatchObject({
      status: "ready",
      plan: { args: [bypass, "exec", "-"], stdio: "pipe", stdin: "closed", stdinPayload: { type: "utf8", content: "fix it" } },
    });
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "abc" }), features)).toMatchObject({
      status: "ready", plan: { args: [bypass, "resume", "abc"] },
    });
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" }), features)).toMatchObject({
      status: "ready", plan: { args: [bypass, "resume", "--last"] },
    });
  });

  test("keeps flag-shaped prompts in stdin and blocks option-like resume ids", () => {
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["--dangerously-bypass-approvals-and-sandbox"], stdin: "closed", stdinPayload: { type: "utf8", content: "--dangerously-bypass-approvals-and-sandbox" } }), features)).toMatchObject({
      status: "ready",
      plan: { args: ["--dangerously-bypass-approvals-and-sandbox", "exec", "-"], stdinPayload: { type: "utf8", content: "--dangerously-bypass-approvals-and-sandbox" } },
    });
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "--last" }), features)).toMatchObject({
      status: "blocked",
      code: "codex-invalid-session-id",
    });
  });

  test("blocks direct option-shaped model and reasoning values while retaining normal values", () => {
    const bypass = "--dangerously-bypass-approvals-and-sandbox";
    for (const input of [
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" as const, modelId: bypass }),
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" as const, modelId: "--other-option" }),
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" as const, reasoningLevel: bypass }),
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" as const, reasoningLevel: "--other-option" }),
    ]) {
      expect(buildCodexLaunchPlan(input, features, ["high"])).toMatchObject({
        status: "blocked",
        code: "codex-invalid-launch-scalar",
      });
    }
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", modelId: "gpt-5.6-sol", reasoningLevel: "high" }), features, ["high"])).toMatchObject({
      status: "ready",
      plan: { args: [bypass, "--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"'] },
    });
  });

  test("normalizes exec stdin to the generic payload execution contract", () => {
    const result = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["safe"], stdin: "inherit", stdinPayload: { type: "utf8", content: "safe" } }),
      features,
    );
    expect(result).toMatchObject({
      status: "ready",
      plan: { args: ["--dangerously-bypass-approvals-and-sandbox", "exec", "-"], stdio: "pipe", stdin: "closed", stdinPayload: { type: "utf8", content: "safe" } },
    });
  });

  test("returns unsupported separately and omits unknown reasoning", () => {
    expect(buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" }), { ...features, resumeLatest: false })).toMatchObject({ status: "unsupported" });
    const result = buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "invented" }), features);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.plan.args).not.toContain("invented");
  });

  test("emits only the exact effort advertised for the selected Codex model", () => {
    const accepted = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "ultra" }),
      features,
      ["low", "max", "ultra"],
    );
    const rejected = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", reasoningLevel: "ultra" }),
      features,
      ["medium"],
    );
    expect(accepted).toMatchObject({ status: "ready", plan: { args: ["--dangerously-bypass-approvals-and-sandbox", "-c", 'model_reasoning_effort="ultra"'] } });
    expect(rejected).toMatchObject({ status: "ready", plan: { args: ["--dangerously-bypass-approvals-and-sandbox"] } });
  });

  test("injects bounded root Lead instructions only for new sessions", () => {
    const bootstrap = "This root session is Deck Lead. Load .agents/skills/deck-lead/SKILL.md and do not ask the user to repeat role selection.";
    const interactive = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive", modelId: "gpt-5.6-sol", reasoningLevel: "high" }),
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );
    const exec = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["quoted", "line\nnext"], stdin: "closed", stdinPayload: { type: "utf8", content: "quoted line\nnext" }, modelId: "gpt-5.6-sol", reasoningLevel: "high" }),
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );
    const resume = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "session-1", modelId: "gpt-5.6-sol", reasoningLevel: "high" }),
      features,
      ["high"],
      { developerInstructions: bootstrap },
    );

    expect(interactive).toMatchObject({
      status: "ready",
      plan: {
        args: ["--dangerously-bypass-approvals-and-sandbox", "-c", `developer_instructions=${JSON.stringify(bootstrap)}`, "--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"'],
        stdio: "inherit",
        stdin: "inherit",
      },
    });
    expect(exec).toMatchObject({
      status: "ready",
      plan: { args: ["--dangerously-bypass-approvals-and-sandbox", "-c", `developer_instructions=${JSON.stringify(bootstrap)}`, "--model", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"', "exec", "-"], stdinPayload: { type: "utf8", content: "quoted line\nnext" } },
    });
    expect(JSON.stringify(exec)).not.toContain("--agent");
    expect(resume).toMatchObject({ status: "ready", plan: { args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "session-1"] } });
    expect(JSON.stringify(resume)).not.toContain("developer_instructions");
    expect(JSON.stringify(resume)).not.toContain("model_reasoning_effort");
  });
});
