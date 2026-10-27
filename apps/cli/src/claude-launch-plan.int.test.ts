import { CLAUDE_ATTRIBUTION_SETTINGS_ARGS } from "../../../packages/adapter-claude/src/launch-settings";
import { describe, expect, test } from "bun:test";
import { getDefaultDeckConfig, type NormalizedDeckConfig, type RunnerLaunchInput } from "@deck/core";
import { buildClaudeLaunchPlan } from "./claude-launch-plan";
import { executeRunnerLaunchPlan } from "./runner-launch-command";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const deckConfig = { adaptiveMemory: { enabled: false, activeProvider: "none" } } as NormalizedDeckConfig;
const base = { projectRoot: "/tmp/claude-test", teamId: "developer-team", deckConfig };

describe("Claude launch planning", () => {
  test("builds an interactive native launch without bypass flags or secrets", () => {
    const result = buildClaudeLaunchPlan({ ...base, mode: "interactive" });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.plan).toMatchObject({ command: "claude", args: ["--safe-mode", ...CLAUDE_ATTRIBUTION_SETTINGS_ARGS], cwd: base.projectRoot, stdio: "inherit", stdin: "inherit", executionClass: "static-compatible" });
    expect(result.plan.envOverlay).toBeUndefined();
  });

  test("resumes only bounded opaque session IDs", () => {
    const ready = buildClaudeLaunchPlan({ ...base, mode: "resume-by-id", sessionId: "session-123" });
    expect(ready.status === "ready" && ready.plan.args).toEqual(["--safe-mode", ...CLAUDE_ATTRIBUTION_SETTINGS_ARGS, "--resume", "session-123"]);
    for (const sessionId of ["", "--dangerously-skip-permissions", "x\n--model", "a".repeat(1025)]) {
      expect(buildClaudeLaunchPlan({ ...base, mode: "resume-by-id", sessionId }).status).toBe("blocked");
    }
    const latest = buildClaudeLaunchPlan({ ...base, mode: "resume-latest" });
    expect(latest.status === "ready" && latest.plan.args).toEqual(["--safe-mode", ...CLAUDE_ATTRIBUTION_SETTINGS_ARGS, "--continue"]);
  });

  test("blocks memory-enabled launches until verified plugin handoff exists", () => {
    const withMemory = { ...base, deckConfig: { adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } as NormalizedDeckConfig };
    expect(buildClaudeLaunchPlan({ ...withMemory, mode: "interactive" }).status).toBe("blocked");
    expect(buildClaudeLaunchPlan({ ...withMemory, mode: "resume-latest" }).status).toBe("blocked");
  });

  test("rejects unsupported exec and unverified native overrides", () => {
    const exec: RunnerLaunchInput = { ...base, mode: "exec", prompt: ["hello"], stdin: "closed" };
    expect(buildClaudeLaunchPlan(exec).status).toBe("unsupported");
    expect(buildClaudeLaunchPlan({ ...base, mode: "interactive", modelId: "--dangerously-skip-permissions" }).status).toBe("blocked");
    expect(buildClaudeLaunchPlan({ ...base, mode: "interactive", reasoningLevel: "high" }).status).toBe("unsupported");
  });

  test("supervised spawn strips inherited memory credentials and tags", async () => {
    const planned = buildClaudeLaunchPlan({ ...base, mode: "interactive" });
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;
    let childEnvironment: Record<string, string> | undefined;
    const outcome = await executeRunnerLaunchPlan(planned.plan, {
      inheritedEnv: { PATH: "/usr/bin", SUPERMEMORY_CC_API_KEY: "private-token", SUPERMEMORY_API_KEY: "wrong-token", SUPERMEMORY_REPO_TAG: "wrong-tag", DECK_RUNNER_MEMORY_TOKEN: "memory-bridge-token" },
      spawn: async (_command, _args, options) => {
        childEnvironment = options.env;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(childEnvironment).toEqual({ PATH: "/usr/bin" });
  });

  test("CLI reports missing Claude executable without running a real Claude process", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-no-executable-"));
    try {
      await mkdir(join(root, "deck"));
      await writeFile(join(root, "deck", "config.json"), JSON.stringify(getDefaultDeckConfig()));
      const main = fileURLToPath(new URL("./main.tsx", import.meta.url));
      const result = spawnSync(process.execPath, [main, "claude", "native"], {
        cwd: root, encoding: "utf8", env: { ...process.env, PATH: root, HOME: root, XDG_CONFIG_HOME: root },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Executable not found|ENOENT/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
