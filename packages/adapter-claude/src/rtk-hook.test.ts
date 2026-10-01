import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { getDefaultDeckConfig } from "../../core/src/index";
import { createClaudeRunnerAdapter } from "./runner-adapter";
import { claudeContentPluginName, claudeModelMetadata } from "./models";
import { pinRtkRewrite } from "./rtk-hook";
import { verifyClaudeRtkHookRuntime } from "./capabilities";

test("qualifies only executable-position RTK words, preserves literals, and defers unsupported shell syntax", () => {
  const binary = "/owned path/quoted'rtk"; const quoted = "'/owned path/quoted'\\''rtk'";
  expect(pinRtkRewrite("rtk git show HEAD --stat", binary)).toBe(`${quoted} git show HEAD --stat`);
  expect(pinRtkRewrite("FOO='rtk literal' rtk git status && rtk git show HEAD --stat", binary)).toBe(`FOO='rtk literal' ${quoted} git status && ${quoted} git show HEAD --stat`);
  expect(pinRtkRewrite("rtk git show --format='rtk word && rtk inside literal'", binary)).toBe(`${quoted} git show --format='rtk word && rtk inside literal'`);
  for (const command of ["printf 'rtk git show'", "rtk git show $(echo rtk)", "rtk git show `echo rtk`", "rtk git show > output", "sudo rtk git show", "env PATH=/other rtk git show", "rtk git show && /usr/bin/env rtk git show", "rtk git show && xargs 'rtk' git show", "rtk git show # rtk comment", "function rtk() { echo wrong; }; rtk git show"]) expect(pinRtkRewrite(command, binary)).toBeUndefined();
});

test("RTK inventory and reviewed installation fail closed when the hook JSON runtime is unavailable", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk-runtime-"));
  try {
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), rtkHookRuntimeCommand: join(home, "missing-node") });
    const deckConfig = getDefaultDeckConfig();
    const inventory = await adapter.getCapabilityInventory({ projectRoot: home, environmentId: "claude-development", runnerId: "claude", deckConfig });
    expect(inventory.capabilities.find((entry) => entry.capabilityId === "rtk")?.isBlocked).toBe(true);
    const review = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: { rtk: true }, adaptiveMemory: { provider: "none" } }, inventory);
    expect(review.ready).toBe(false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

const archivePath = process.env.DECK_TEST_RTK_ARCHIVE;
test.skipIf(!archivePath)("actual pinned RTK hook rewrites to its own executable under system-only PATH and repairs immutable plugin content", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk quoted' home-"));
  try {
    const dataRoot = join(home, "data", "deck");
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, rtkArtifactEffects: { fetchArchive: async () => readFileSync(archivePath!) } });
    expect((await adapter.runAction({ id: "rtk.install", kind: "install-claude-rtk", capabilityId: "rtk", title: "fixture", status: "ready" }, { projectRoot: home, runnerId: "claude", environmentId: "claude-development" })).status).toBe("executed");
    const input = { projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files", "rtk"] };
    const plan = adapter.buildDeveloperTeamInstallPlan(input); expect(plan.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: input.environmentId, plan });
    const root = dirname(dirname(plan.files[0]!.path));
    const hook = JSON.parse(plan.files.find((file) => file.path.endsWith("/hooks/hooks.json"))!.content).hooks.PreToolUse[0].hooks[0].command;
    const executable = join(dataRoot, "claude", "tools", "rtk-v0.50.0", `${process.platform}-${process.arch}`, "rtk");
    const repo = process.cwd();
    const env = { HOME: home, PATH: "/usr/bin:/bin", CLAUDE_PLUGIN_ROOT: root, LANG: "C", XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "state"), GIT_CONFIG_NOSYSTEM: "1" };
    const ambient = join(home, "ambient-0.45"); await mkdir(ambient);
    await writeFile(join(ambient, "rtk"), "#!/bin/sh\necho 'wrong ambient RTK 0.45.0' >&2\nexit 99\n", { mode: 0o700 });
    for (const PATH of [env.PATH, `${ambient}:${env.PATH}`]) for (const original of ["git show HEAD --stat", "git status --short && git show HEAD --stat"]) {
      const isolated = { ...env, PATH };
      const outcome = spawnSync("/bin/sh", ["-c", hook], { cwd: repo, env: isolated, input: JSON.stringify({ hook_event_name: "PreToolUse", permission_mode: "default", tool_name: "Bash", tool_input: { command: original, timeout: 30000, description: "fixture" } }), encoding: "utf8", timeout: 5000 });
      expect(outcome.status).toBe(0);
      const response = JSON.parse(outcome.stdout); const command = response.hookSpecificOutput.updatedInput.command;
      expect(command).toContain(`'${executable.replaceAll("'", "'\\''")}'`);
      expect(response.hookSpecificOutput.updatedInput.timeout).toBe(30000);
      const executed = spawnSync("/bin/sh", ["-c", command], { cwd: repo, env: isolated, encoding: "utf8", timeout: 5000 });
      expect(executed.status).toBe(0); expect(executed.stdout + executed.stderr).not.toContain("No such file");
      expect(executed.stdout + executed.stderr).not.toContain("wrong ambient RTK");
    }
    const untouched = spawnSync("/bin/sh", ["-c", hook], { cwd: repo, env, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "printf '%s' 'rtk git show is literal'" } }), encoding: "utf8", timeout: 5000 });
    expect(untouched.status).toBe(0); expect(untouched.stdout.trim()).toBe("");
    const built = await Bun.build({ entrypoints: [fileURLToPath(new URL("./rtk-hook.ts", import.meta.url))], target: "bun", minify: true });
    expect(built.success).toBe(true);
    const minified = await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0]!.text()).toString("base64")}`);
    const minifiedScript = join(home, "minified-hook.cjs"); await writeFile(minifiedScript, minified.claudeRtkHookScript(executable), { mode: 0o600 });
    const minifiedOutcome = spawnSync(verifyClaudeRtkHookRuntime({}), [minifiedScript], { cwd: repo, env, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git show HEAD --stat" } }), encoding: "utf8", timeout: 5000 });
    expect(minifiedOutcome.status).toBe(0);
    expect(JSON.parse(minifiedOutcome.stdout).hookSpecificOutput.updatedInput.command).toContain(`'${executable.replaceAll("'", "'\\''")}'`);

    // Recreate the previous owned native-hook materialization, without an install
    // or write to the user's actual plugin. Its valid receipt must be supersedable.
    const priorFiles = plan.files.filter((file) => !file.path.endsWith("/hooks/rtk-hook.cjs")).map((file) => file.path.endsWith("/hooks/hooks.json") ? { ...file, content: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `'${executable.replaceAll("'", "'\\''")}' hook claude` }] }] } }, null, 2) + "\n" } : file);
    const sha = (value: string) => createHash("sha256").update(value).digest("hex");
    const digest = sha(JSON.stringify(priorFiles.map((file) => [relative(root, file.path), file.kind, sha(file.content)])));
    const name = claudeContentPluginName({}, ["rtk"], undefined, digest); const previous = join(dataRoot, "claude", name);
    await rm(root, { recursive: true }); // disposable fixture only, not a user plugin
    for (const file of priorFiles) { const target = join(previous, relative(root, file.path)); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, file.content, { mode: 0o600 }); }
    await writeFile(join(dataRoot, "claude", "model-assignments.json"), claudeModelMetadata({}, ["rtk"], undefined, digest), { mode: 0o600 });
    const repaired = adapter.buildDeveloperTeamInstallPlan(input); expect(repaired.blocked).toBe(false);
    expect(repaired.files[0]!.path).not.toBe(priorFiles[0]!.path.replace(root, previous));
    expect((await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: input.environmentId, plan: repaired })).changedCount).toBe(repaired.files.length);
    expect((await adapter.verifyDeveloperTeamInstall(repaired)).valid).toBe(true);
    expect(await readFile(join(previous, "hooks", "hooks.json"), "utf8")).toBe(priorFiles.find((file) => file.path.endsWith("/hooks/hooks.json"))!.content);
  } finally { await rm(home, { recursive: true, force: true }); }
});
