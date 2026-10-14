import React from "react";
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { createAdapterRegistry, type RunnerAdapter } from "@deck/core";
import { createDeckConfigStore } from "../deck-config-store";
import { CrossConfigurationFlow } from "./cross-configuration-flow";
import { DeckApp } from "./app";

function harness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, read: () => chunks.shift() ?? null, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 130, rows: 50, isTTY: true });
  let output = "";
  stdout.on("data", chunk => { output += chunk.toString(); });
  return { stdin, stdout, output: () => output, input(value: string) { chunks.push(Buffer.from(value), null); stdin.emit("readable"); }, close() { stdin.removeAllListeners(); stdout.destroy(); } };
}
async function wait(instance: ReturnType<typeof render>, check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("TUI condition timed out"); await instance.waitUntilRenderFlush(); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function fixture(installed = true, driver = true, runnerId = "codex") {
  let mutations = 0;
  const adapter = {
    runnerId, displayName: runnerId === "claude" ? "Claude" : "Codex", environmentIds: [`${runnerId}-development`],
    ...(driver ? { getSessionDriver: () => ({}) } : {}),
    detectRuntimes: async () => [{ runtimeId: "codex", displayName: "Codex", isAvailable: installed }],
    getModelInventory: async () => ({ state: "ready", source: "live", fingerprint: "fixture", discoveredAt: Date.now(), inventory: { providers: [{ id: "openai", displayName: "OpenAI", source: "runner-resolved" }], modelsByProvider: { openai: [{ id: "fixture", displayName: "Fixture model", providerId: "openai", source: "runner-resolved", variants: ["low", "high"] }] } } }),
    supportsThinking: () => true, getThinkingLevels: () => ["low", "high"], getDefaultThinking: () => "high",
    applyDeveloperTeamInstall: async () => { mutations++; throw new Error("Native install must never run"); },
    readModelAssignments: () => ({ "deck-lead": "native-preserved" }),
  } as unknown as RunnerAdapter;
  const registry = createAdapterRegistry(); registry.register(runnerId, adapter);
  return { registry, mutations: () => mutations };
}

test("Start installation includes cross after real runners and saves the complete cross member picker flow", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-cross-tui-")));
  const store = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg") });
  store.write({ webSearch: { enabled: true, provider: "tavily" } });
  const f = fixture(); const h = harness();
  const instance = render(<DeckApp adapterRegistry={f.registry} configStore={store} resolveProjectRoot={() => root} initialScreen="environment-selection" runReleaseCheck={async () => ({ kind: "none" })} />, { stdin: h.stdin as any, stdout: h.stdout as any, debug: true, interactive: true, patchConsole: false });
  async function key(value: string) { h.input(value); await instance.waitUntilRenderFlush(); await new Promise(resolve => setTimeout(resolve, 20)); }
  try {
    await wait(instance, () => h.output().includes("Cross runner · member configuration"));
    expect(h.output().indexOf("Codex Development Environment")).toBeLessThan(h.output().indexOf("Cross runner · member configuration"));
    for (let i = 0; i < 4; i++) await key("j");
    await key("\r"); await wait(instance, () => h.output().includes("lead: Not assigned"));
    await key("\r"); await wait(instance, () => h.output().includes("Installed · session driver available"));
    await key("\r"); await wait(instance, () => h.output().includes("Cross runner · providers"));
    await key("\r"); await wait(instance, () => h.output().includes("Fixture model"));
    await key("\r"); await wait(instance, () => h.output().includes("Cross runner · thinking"));
    await key("\r"); await wait(instance, () => h.output().includes("lead: codex / fixture"));
    for (let i = 0; i < 7; i++) await key("j");
    await key("\r"); await wait(instance, () => h.output().includes("Save cross configuration"));
    await key("\r"); await wait(instance, () => store.read().crossRunner?.enabled === true);
    expect(store.read().crossRunner?.members.lead).toEqual({ runnerId: "codex", modelId: "fixture", thinking: "high" });
    expect(store.read().webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(f.registry.get("codex").readModelAssignments()).toEqual({ "deck-lead": "native-preserved" });
    expect(f.mutations()).toBe(0);
  } finally { instance.unmount(); await instance.waitUntilExit(); h.close(); rmSync(root, { recursive: true, force: true }); }
});
for (const [installed, driver, message] of [[false, true, "Runner not installed"], [true, false, "No session driver"]] as const) {
  test(`cross runner blocks ${message} before model discovery or save`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-cross-blocked-")));
    const store = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg") });
    const f = fixture(installed, driver); const h = harness();
    const instance = render(<CrossConfigurationFlow registry={f.registry} store={store} projectRoot={root} onBack={() => {}} onSaved={() => { throw new Error("Must not save"); }} />, { stdin: h.stdin as any, stdout: h.stdout as any, debug: true, interactive: true, patchConsole: false });
    try {
      await wait(instance, () => h.output().includes("lead: Not assigned"));
      h.input("\r"); await wait(instance, () => h.output().includes(message));
      h.input("\r"); await instance.waitUntilRenderFlush();
      expect(store.read().crossRunner).toBeUndefined(); expect(f.mutations()).toBe(0);
    } finally { instance.unmount(); await instance.waitUntilExit(); h.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

test("Claude configuration saves directly without a subscription notice or acknowledgement", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-cross-claude-tui-")));
  const store = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg") });
  store.write({ crossRunner: { members: { lead: { runnerId: "claude", modelId: "opus" } } } });
  const f = fixture(true, true, "claude"); const h = harness(); let saved = false;
  const instance = render(<CrossConfigurationFlow registry={f.registry} store={store} projectRoot={root} onBack={() => {}} onSaved={() => { saved = true; }} />, { stdin: h.stdin as any, stdout: h.stdout as any, debug: true, interactive: true, patchConsole: false });
  async function key(value: string) { h.input(value); await instance.waitUntilRenderFlush(); await new Promise(resolve => setTimeout(resolve, 20)); }
  try {
    await wait(instance, () => h.output().includes("lead: claude / opus"));
    for (let i = 0; i < 7; i++) await key("j");
    await key("\r"); await wait(instance, () => h.output().includes("Save cross configuration"));
    expect(h.output()).not.toContain("Residual risk");
    expect(h.output()).not.toContain("Acknowledge Claude");
    await key("\r"); await wait(instance, () => saved);
    expect(store.read().crossRunner?.claudeTosAcknowledgedAt).toBeNull();
    expect(f.mutations()).toBe(0);
  } finally { instance.unmount(); await instance.waitUntilExit(); h.close(); rmSync(root, { recursive: true, force: true }); }
});
