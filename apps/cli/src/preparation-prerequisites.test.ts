// Protects selected prerequisite evidence and zero optional probes for disabled capabilities.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexRunnerAdapter } from "../../../packages/adapter-codex/src/runner-adapter";
import { createOpenCodeRunnerAdapter } from "../../../packages/adapter-opencode/src/runner-adapter";
import { createPiRunnerAdapter } from "../../../packages/adapter-pi/src/runner-adapter";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { PrerequisiteEvidence } from "../../../packages/core/src/session/prerequisite-evidence";
const roots: string[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), "deck-prerequisites-")); roots.push(value); return value; };
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
afterEach(() => { roots.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

// Metadata must never execute the candidate; absent/present/mode changes invalidate evidence.
test("prerequisite reader skips disabled collectors and refreshes executable metadata", () => {
  const evidence = new PrerequisiteEvidence(), file = join(root(), "tool");
  expect(evidence.observe(false, () => { throw new Error("must not probe"); })).toEqual({ enabled: false });
  const inspect = () => evidence.observe(true, () => [evidence.executable(file)]);
  expect(inspect()).toMatchObject({ prerequisites: "missing" });
  put(file, "not an executable program"); chmodSync(file, 0o700);
  const first = inspect(); expect(first).toMatchObject({ availability: "unverified", prerequisites: "present" });
  expect(inspect()).toEqual(first);
  put(file, "changed metadata, still never executed");
  expect(inspect().inputDigest).not.toBe(first.inputDigest);
  chmodSync(file, 0o600); expect(inspect()).toMatchObject({ prerequisites: "missing" });
});

test.each(["codex", "opencode", "pi"])("real %s adapter observes only selected Context7 prerequisites and refreshes route", lane => {
  const home = root(), executable = join(home, "tool"); put(executable, "never execute"); chmodSync(executable, 0o700);
  const adapter = lane === "codex" ? createCodexRunnerAdapter({ codexHome: home, userHome: home, tools: { homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: name => name === "context7-mcp" ? executable : undefined } })
    : lane === "opencode" ? createOpenCodeRunnerAdapter({ developerTeamConfigDir: home })
    : createPiRunnerAdapter({ homeDirectory: home, env: { PI_CODING_AGENT_DIR: home } });
  const config = getDefaultDeckConfig(); config.packageInstructions[lane]!.rtk = false;
  const inspect = () => adapter.readPreparationCapabilities!(config);
  expect(inspect().rtk).toEqual({ enabled: false }); expect(inspect().context7).toEqual({ enabled: false });
  const write = (command: string, enabled = true) => {
    if (lane === "codex") put(join(home, "config.toml"), `# deck-codex-mcp:context7\n[mcp_servers.context7]\ncommand = ${JSON.stringify(command)}\nenabled = ${enabled}\n`);
    else put(join(home, lane === "pi" ? "mcp.json" : "opencode.json"), JSON.stringify(lane === "pi" ? { mcpServers: { context7: { command, disabled: !enabled } } } : { mcp: { context7: { type: "local", command: [command], enabled } } }));
  };
  write(executable);
  const first = inspect().context7; expect(first).toMatchObject({ enabled: true, prerequisites: "present", availability: "unverified" });
  write(join(home, "missing")); expect(inspect().context7).toMatchObject({ prerequisites: "missing" });
  write(executable); expect(inspect().context7).toEqual(first);
  write(executable, false); expect(inspect().context7).toEqual({ enabled: false });
});

test("Claude installed Context7 generation supplies metadata without running its command", async () => {
  const home = root(), command = join(home, "context7"); put(command, "never execute"); chmodSync(command, 0o700);
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: () => command });
  const config = getDefaultDeckConfig(); config.packageInstructions.claude!.rtk = false;
  const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "context7"] });
  await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
  expect(adapter.readPreparationCapabilities!(config).context7).toMatchObject({ prerequisites: "present", availability: "unverified" });
  rmSync(command); expect(adapter.readPreparationCapabilities!(config).context7).toMatchObject({ prerequisites: "missing" });
});

test("Codex RTK metadata follows its installed hook and executable, without executing either", () => {
  const home = root(), binary = join(home, "rtk"), script = join(home, "deck/hooks/deck-rtk-hook.cjs");
  const config = getDefaultDeckConfig(); config.packageInstructions.codex!.rtk = true;
  const adapter = createCodexRunnerAdapter({ codexHome: home, userHome: home });
  const inspect = () => adapter.readPreparationCapabilities!(config).rtk;
  expect(inspect()).toMatchObject({ prerequisites: "missing" });
  put(join(home, "config.toml"), '# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ' + JSON.stringify("'" + process.execPath + "' '" + script + "'") + '\n# deck-codex-hook:rtk:end\n');
  put(script, `const binary = ${JSON.stringify(binary)};\nthrow new Error("must never execute");`);
  put(binary, "not a program"); chmodSync(binary, 0o700);
  const first = inspect(); expect(first).toMatchObject({ prerequisites: "present", availability: "unverified" });
  put(script, `const binary = ${JSON.stringify(binary)};\nchanged hook`);
  expect(inspect().inputDigest).not.toBe(first.inputDigest);
  rmSync(script); expect(inspect()).toMatchObject({ prerequisites: "missing" });
  config.packageInstructions.codex!.rtk = false; expect(inspect()).toEqual({ enabled: false });
});

test("Codex remote Context7 remains unavailable even with credentials and never exposes them", () => {
  const home = root(), environment: Record<string, string> = {};
  const adapter = createCodexRunnerAdapter({ codexHome: home, userHome: home, sessionDriver: { baseEnv: environment } });
  put(join(home, "config.toml"), '# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"\n[mcp_servers.context7.env_http_headers]\nX-Context7-API-Key = "CONTEXT7_API_KEY"\n');
  const config = getDefaultDeckConfig(); config.packageInstructions.codex!.rtk = false;
  expect(adapter.readPreparationCapabilities!(config).context7).toMatchObject({ prerequisites: "missing" });
  environment.CONTEXT7_API_KEY = "fixture-secret";
  const evidence = adapter.readPreparationCapabilities!(config);
  expect(evidence.context7).toMatchObject({ prerequisites: "missing", availability: "unavailable" });
  expect(JSON.stringify(evidence)).not.toContain("fixture-secret");
});
