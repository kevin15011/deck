import { describe, expect, test } from "bun:test";

import { createDefaultAdapterRegistry } from "./runner-adapters";
import { existsSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("default AdapterRegistry", () => {
  test("is the authoritative composition path for Pi, OpenCode, Codex and Claude", () => {
    const registry = createDefaultAdapterRegistry();
    expect(registry.list().map((adapter) => adapter.runnerId)).toEqual(["pi", "opencode", "codex", "claude"]);
    expect(registry.get("codex").buildLaunchPlan).toBeFunction();
    expect(registry.resolveByEnvironment("claude-development")?.runnerId).toBe("claude");
  });

  test("construction and innocuous inspection do not create runner home/config paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-registry-no-write-"));
    const openCodeConfig = join(root, "opencode-config");
    const piHome = join(root, "pi-home");
    const codexJournal = join(root, "codex-journal");
    const claudeData = join(root, "data", "deck");
    try {
      const registry = createDefaultAdapterRegistry({
        pi: { homeDirectory: piHome },
        opencode: { developerTeamConfigDir: openCodeConfig, skillDiscoveryHomeDir: join(root, "skills-home") },
        codex: { journalRoot: codexJournal, preflight: { probe: async () => ({ found: false }) } },
        claude: { homeDir: root, dataRoot: claudeData },
      });
      registry.list().forEach((adapter) => adapter.getCapabilityIds());
      await registry.get("codex").inspectProject?.(root);
      expect(existsSync(openCodeConfig)).toBe(false);
      expect(existsSync(piHome)).toBe(false);
      expect(existsSync(codexJournal)).toBe(false);
      expect(existsSync(claudeData)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("Codex composition probes the current executable in a canary-only environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-codex-active-proxy-"));
  const executable = join(root, "deck-canary");
  const output = join(root, "args.json");
  const previous = process.execPath;
  const previousArg = process.argv[1];
  try {
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${output}'\nprintf 'deck-serena-mcp-proxy-v1\\n'\n`);
    await chmod(executable, 0o755);
    process.execPath = executable;
    process.argv[1] = "/project with spaces/main.tsx";
    const evidence = { capabilityId: "serena" as const, state: "ready" as const, resolvedExecutablePath: "/owned/serena", source: "existing-deck-tool" as const, probe: "serena-help" as const, fingerprint: "fixture" };
    const registry = createDefaultAdapterRegistry({ codex: {
      codexHome: join(root, ".codex"),
      preflight: { probe: async () => ({ found: false }) },
      serenaReadinessResolver: async () => ({ state: "ready", evidence, revalidate: async value => ({ valid: true, evidence: value }) }),
    } });
    process.execPath = previous;
    process.argv[1] = previousArg;
    await mkdir(join(root, ".codex"));
    await writeFile(join(root, ".codex", "config.toml"), `[mcp_servers.serena]\ncommand = ${JSON.stringify(executable)}\nargs = ["/project with spaces/main.tsx", "internal", "serena-mcp"]\nenv_vars = ["HOME", "PATH", "XDG_DATA_HOME"]\n`);
    const inventory = await registry.get("codex").getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: (await import("@deck/core")).getDefaultDeckConfig() });
    expect((await readFile(output, "utf8")).trim().split("\n")).toEqual(["/project with spaces/main.tsx", "internal", "serena-mcp", "--probe"]);
    expect(inventory.capabilities.find(item => item.capabilityId === "serena")?.diagnostics).toContain("serena: MCP ready");
  } finally {
    process.execPath = previous;
    process.argv[1] = previousArg;
    await rm(root, { recursive: true, force: true });
  }
});
