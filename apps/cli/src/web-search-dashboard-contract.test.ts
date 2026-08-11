import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { getWebSearchProviderDescriptor } from "./web-search-provider";
import { writeTavilyCredentialToActiveShellProfileTransaction } from "./web-search-shell-profile";
import { persistWebSearchCredentialAndEnable } from "./web-search-setup";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-web-search-dashboard-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Web Search dashboard contract", () => {
  test("enable -> profile credential -> Deck config -> adapter plan -> MCP materialization -> readiness works for Pi and OpenCode", async () => {
    const previousPath = process.env.PATH;
    const previousCredential = process.env.TAVILY_API_KEY;
    const root = temporaryRoot();
    const executableDir = join(root, "bin");
    mkdirSync(executableDir, { recursive: true });
    const npx = join(executableDir, "npx");
    writeFileSync(npx, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(npx, 0o755);
    process.env.PATH = executableDir;

    try {
      for (const runner of ["pi", "opencode"] as const) {
        const runnerRoot = join(root, runner);
        const home = join(runnerRoot, "home");
        const projectRoot = join(runnerRoot, "project");
        mkdirSync(home, { recursive: true });
        mkdirSync(projectRoot, { recursive: true });
        const credential = `${runner}-credential`;
        const persisted = persistWebSearchCredentialAndEnable({
          credential,
          projectRoot,
          environment: process.env,
          writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
        });
        expect(persisted.ok).toBe(true);

        const adapter = runner === "pi"
          ? createPiRunnerAdapter({ homeDirectory: home, webSearchProviderResolver: getWebSearchProviderDescriptor })
          : createOpenCodeRunnerAdapter({ developerTeamConfigDir: join(home, ".config", "opencode"), webSearchProviderResolver: getWebSearchProviderDescriptor });
        const environmentId = runner === "pi" ? "pi-development" : "opencode-development";
        const inventory = await adapter.getCapabilityInventory({ projectRoot, runnerId: runner, environmentId });
        const descriptor = getWebSearchProviderDescriptor("tavily");
        const state = {
          runnerId: runner,
          environmentId,
          selectedCapabilities: { "web-search": true },
          webSearchProvider: "tavily",
          webSearchProviderDescriptor: descriptor,
          packageInstructions: {},
          adaptiveMemory: { provider: "none" as const },
        };
        const plan = adapter.buildReviewPlan(state, inventory);
        const action = plan.groups.configWrites.find((item) => item.capabilityId === "web-search" && item.id.endsWith("mcp-config"));

        expect(action).toBeDefined();
        const result = await adapter.runAction(action!, {
          projectRoot,
          runnerId: runner,
          environmentId,
          webSearchProvider: descriptor,
          ...(runner === "pi" ? { homeDirectory: home } : {}),
        } as never);
        expect(result.status).toBe("executed");

        const ready = await adapter.getCapabilityInventory({ projectRoot, runnerId: runner, environmentId });
        const webSearch = ready.capabilities.find((entry) => entry.capabilityId === "web-search");
        expect(webSearch).toMatchObject({ isInstalled: true, webSearchReadiness: { state: "ready" } });
        expect(JSON.stringify(plan).includes(credential)).toBe(false);
        expect(JSON.stringify(result).includes(credential)).toBe(false);
        const mcpPath = runner === "pi"
          ? join(home, ".pi", "agent", "mcp.json")
          : join(home, ".config", "opencode", "opencode.json");
        expect(readFileSync(mcpPath, "utf8").includes(credential)).toBe(false);
      }
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousCredential === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = previousCredential;
    }
  });
});
