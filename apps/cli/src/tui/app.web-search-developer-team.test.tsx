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

const DASHBOARD_WAIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_TAIL_LENGTH = 2_000;

function tail(value: string): string {
  return value.slice(-DIAGNOSTIC_TAIL_LENGTH);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

async function waitForRenderFlush(instance: { waitUntilRenderFlush(): Promise<unknown> }, label: string, details?: () => string, timeoutMs = DASHBOARD_WAIT_TIMEOUT_MS) {
  await withTimeout(
    instance.waitUntilRenderFlush(),
    timeoutMs,
    `Render flush timed out while waiting for ${label}${details ? `: ${details()}` : ""}`,
  );
}

async function waitForCondition(instance: { waitUntilRenderFlush(): Promise<unknown> }, condition: () => boolean, description: string, details?: () => string, timeoutMs = DASHBOARD_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.${details ? ` ${details()}` : ""}`);
    await waitForRenderFlush(instance, description, details, remainingMs);
  }
}

async function waitForOutput(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, text: string) {
  await waitForCondition(
    instance,
    () => output().includes(text),
    JSON.stringify(text),
    () => `output=${JSON.stringify(tail(output()))}`,
  );
}

async function waitForFreshOutput(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, boundary: number, text: string) {
  await waitForCondition(
    instance,
    () => output().slice(boundary).includes(text),
    `fresh ${JSON.stringify(text)}`,
    () => `boundary=${boundary}; freshTail=${JSON.stringify(tail(output().slice(boundary)))}; completeTail=${JSON.stringify(tail(output()))}`,
  );
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
    config.packageInstructions.opencode = { ...config.packageInstructions.opencode, serena: false };
    const usableOpenCodeToolIds = ["rtk", "context-mode", "codebase-memory", "context7"] as const;
    const webSearchProvider = getWebSearchProviderDescriptor("tavily");
    if (!webSearchProvider) throw new Error("Expected Tavily Web Search descriptor fixture.");
    const configStore = createDeckConfigStore({ homeDir: join(root, "home-config"), xdgConfigHome: join(root, "xdg"), projectRoot });
    configStore.write(config);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "opencode.json"), "{}\n", { encoding: "utf8", mode: 0o600 });

    const adapter = createOpenCodeRunnerAdapter({
      developerTeamConfigDir: configDir,
      webSearchProviderResolver: getWebSearchProviderDescriptor,
      toolsReview: {
        tools: usableOpenCodeToolIds.map((name) => ({ name, installed: true })),
        toolStatuses: [],
        installedPackages: [],
        evidence: Object.fromEntries(usableOpenCodeToolIds.map((toolId) => [
          toolId,
          { toolId, state: "usable", source: "configured", reasonCodes: ["configured-usable"] },
        ])) as any,
      },
    });
    const buildReviewPlan = adapter.buildReviewPlan.bind(adapter);
    const applyDeveloperTeamInstall = adapter.applyDeveloperTeamInstall?.bind(adapter);
    const writeMcpConfig = adapter.writeMcpConfig?.bind(adapter);
    let reviewedPlan: ReturnType<typeof adapter.buildReviewPlan> | undefined;
    let developerTeamApplyCalls = 0;
    const mcpWrites: string[] = [];
    const summarizePlan = () => reviewedPlan ? JSON.stringify({
      ready: reviewedPlan.ready,
      automatic: reviewedPlan.groups.automaticInstalls.map((action) => `${action.id}:${action.kind}:${action.status}`),
      manual: reviewedPlan.groups.manualSteps.map((action) => `${action.id}:${action.kind}:${action.status}`),
      config: reviewedPlan.groups.configWrites.map((action) => `${action.id}:${action.kind}:${action.status}`),
      team: reviewedPlan.groups.teamApplications.map((action) => `${action.id}:${action.kind}:${action.status}`),
      validation: reviewedPlan.groups.validations.map((action) => `${action.id}:${action.kind}:${action.status}`),
      diagnostics: reviewedPlan.diagnostics,
    }) : "undefined";
    adapter.buildReviewPlan = (state, inventory) => {
      reviewedPlan = buildReviewPlan(state, inventory);
      return reviewedPlan;
    };
    if (applyDeveloperTeamInstall) {
      adapter.applyDeveloperTeamInstall = async (input) => {
        developerTeamApplyCalls += 1;
        return applyDeveloperTeamInstall(input);
      };
    }
    if (writeMcpConfig) {
      adapter.writeMcpConfig = async (input) => {
        const result = await writeMcpConfig(input);
        mcpWrites.push(`${input.serverName}:${result.ok ? "ok" : "failed"}:${result.diagnostics?.join("|") ?? ""}`);
        return result;
      };
    }
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
      await waitForRenderFlush(instance, "environment cursor redraw", () => `output=${JSON.stringify(tail(harness.output()))}`);
      harness.input(" ");
      await waitForRenderFlush(instance, "environment selection toggle", () => `output=${JSON.stringify(tail(harness.output()))}`);
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      const dashboardBoundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, dashboardBoundary, "OpenCode Runner Setup Dashboard");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `dashboard cursor redraw ${index + 1}`, () => `output=${JSON.stringify(tail(harness.output()))}`);
      }
      const reviewBoundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, reviewBoundary, "actions planned");
      expect(reviewedPlan?.ready).toBe(true);
      expect(reviewedPlan?.groups.automaticInstalls).toEqual([]);
      expect(reviewedPlan?.groups.configWrites).toContainEqual(expect.objectContaining({ id: "capability.web-search.mcp-config", kind: "write-mcp-config" }));
      expect(reviewedPlan?.groups.teamApplications).toContainEqual(expect.objectContaining({ id: "team.developer-team.apply", kind: "apply-team-bundle" }));
      harness.input("\r");
      await waitForCondition(
        instance,
        () => developerTeamApplyCalls > 0,
        "Developer Team apply boundary",
        () => `plan=${summarizePlan()}; mcpWrites=${JSON.stringify(mcpWrites)}; output=${JSON.stringify(harness.output().slice(-8_000))}`,
      );
      await waitForCondition(
        instance,
        () => existsSync(join(configDir, "prompts", "deck-team", "deck-lead.md")),
        "OpenCode Developer Team files",
        () => `plan=${summarizePlan()}; applyCalls=${developerTeamApplyCalls}; mcpWrites=${JSON.stringify(mcpWrites)}; output=${JSON.stringify(harness.output().slice(-8_000))}`,
      );
      expect(developerTeamApplyCalls).toBe(1);
      expect(mcpWrites).toHaveLength(1);
      expect(mcpWrites[0]).toMatch(new RegExp(`^${webSearchProvider.semanticServerId}:ok:`));

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
      try {
        await withTimeout(instance.waitUntilExit(), DASHBOARD_WAIT_TIMEOUT_MS, `Ink exit timed out after ${DASHBOARD_WAIT_TIMEOUT_MS}ms`);
      } finally {
        harness.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
