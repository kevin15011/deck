import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { createAdapterRegistry, getDefaultDeckConfig } from "@deck/core";
import { createDeckConfigStore } from "../deck-config-store";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { WEB_SEARCH_ROLE_POLICY_V1 } from "@deck/core/web-search-capability";
import { DeckApp } from "./app";
import { getWebSearchProviderDescriptor } from "../web-search-provider";

setDefaultTimeout(20_000);

function createInkHarness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = new EventEmitter() as EventEmitter & { isTTY: boolean; setRawMode: () => void; setEncoding: () => void; read: () => Buffer | null; ref: () => void; unref: () => void };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding = () => {};
  stdin.read = () => chunks.shift() ?? null;
  stdin.ref = () => {};
  stdin.unref = () => {};
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = 140;
  stdout.rows = 50;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  return {
    stdin,
    stdout,
    input(value: string) { chunks.push(Buffer.from(value), null); stdin.emit("readable"); },
    output: () => output,
    close() { stdin.removeAllListeners(); stdout.removeAllListeners(); stdout.end(); stdout.destroy(); },
  };
}

async function waitForOutput(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, text: string) {
  const deadline = Date.now() + 8_000;
  while (!output().includes(text)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${JSON.stringify(text)}; output=${JSON.stringify(output().slice(-2_000))}`);
    await instance.waitUntilRenderFlush();
  }
}

async function waitForCondition(instance: { waitUntilRenderFlush(): Promise<unknown> }, condition: () => boolean, description: string) {
  const deadline = Date.now() + 8_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await instance.waitUntilRenderFlush();
  }
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

describe("DeckApp Web Search Developer Team materialization", () => {
  test("dashboard install writes provider-neutral Web Search policy only to Developer Team roles", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-tui-"));
    const projectRoot = join(root, "project");
    const configDir = join(root, "home", ".config", "opencode");
    const config = getDefaultDeckConfig();
    config.webSearch = { enabled: true, provider: "tavily" };
    const configStore = createDeckConfigStore({ homeDir: join(root, "home-config"), xdgConfigHome: join(root, "xdg"), projectRoot });
    configStore.write(config);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}\n", { encoding: "utf8", mode: 0o600 });

    const adapter = createOpenCodeRunnerAdapter({
      developerTeamConfigDir: configDir,
      webSearchProviderResolver: getWebSearchProviderDescriptor,
      toolsReview: { tools: [], toolStatuses: [], installedPackages: [] },
    });
    const registry = createAdapterRegistry();
    registry.register("opencode", adapter);
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      harness.input("j");
      await instance.waitUntilRenderFlush();
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "OpenCode Runner Setup Dashboard");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "actions planned");
      harness.input("\r");
      await waitForCondition(instance, () => existsSync(join(configDir, "prompts", "deck-team", "deck-lead.md")), "OpenCode Developer Team files");

      const canonicalSkillIds = new Set(DEVELOPER_TEAM_AGENTS.map((agent) => agent.skillId));
      const allRolePolicies = Object.values(WEB_SEARCH_ROLE_POLICY_V1);
      for (const agent of DEVELOPER_TEAM_AGENTS) {
        const prompt = readFileSync(join(configDir, "prompts", "deck-team", `${agent.id}.md`), "utf8");
        const skill = readFileSync(join(configDir, "skills", agent.skillId, "SKILL.md"), "utf8");
        for (const content of [prompt, skill]) {
          expect(content).toContain("Web Search Capability (provider-neutral)");
          expect(content).toContain(WEB_SEARCH_ROLE_POLICY_V1[agent.displayName as keyof typeof WEB_SEARCH_ROLE_POLICY_V1]);
          for (const otherPolicy of allRolePolicies.filter((policy) => policy !== WEB_SEARCH_ROLE_POLICY_V1[agent.displayName as keyof typeof WEB_SEARCH_ROLE_POLICY_V1])) {
            expect(content).not.toContain(otherPolicy);
          }
          expect(content).not.toMatch(/Tavily|tavily_|TAVILY_API_KEY/);
        }
      }

      const installedSkillIds = readdirSync(join(configDir, "skills"));
      for (const skillId of installedSkillIds.filter((id) => !canonicalSkillIds.has(id))) {
        const content = readIfExists(join(configDir, "skills", skillId, "SKILL.md"));
        if (!content) continue;
        expect(content).not.toContain("Web Search Capability (provider-neutral)");
        for (const policy of allRolePolicies) expect(content).not.toContain(policy);
      }
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
