import { afterEach, expect, spyOn, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { startFakeLoopbackHost } from "../../__fixtures__/fake-loopback-host";
import { clearPublishedMemoryHandoff } from "../shared/memory-handoff";

const keys = ["HOME", "PI_CODING_AGENT_DIR", "DECK_PI_SESSION", "DECK_PI_ROLE", "DECK_PI_CHILD", "DECK_PI_MEMORY", "DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN_FILE", "DECK_RUNNER_MEMORY_TOKEN"];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let root: string | undefined;
let host: ReturnType<typeof startFakeLoopbackHost> | undefined;
afterEach(() => {
  host?.stop(); host = undefined;
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  clearPublishedMemoryHandoff();
  if (root) rmSync(root, { recursive: true, force: true });
});

test("generated memory extension survives two native resource reloads with tools, recall, and captures restored", async () => {
  clearPublishedMemoryHandoff();
  root = mkdtempSync(join(tmpdir(), "deck-memory-reload-"));
  const agentDir = join(root, "agent"), cwd = join(root, "project");
  for (const dir of [agentDir, cwd, join(root, "home")]) mkdirSync(dir);
  for (const key of keys) delete process.env[key];
  host = startFakeLoopbackHost({ dir: root, advisory: "RELOAD_MEMORY_FACT" });
  Object.assign(process.env, { HOME: join(root, "home"), PI_CODING_AGENT_DIR: agentDir, DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", ...host.env });
  const faux = fauxProvider();
  const requests: string[] = [];
  faux.setResponses(Array.from({ length: 3 }, () => (context: { messages: unknown[] }) => { requests.push(JSON.stringify(context.messages)); return fauxAssistantMessage("RELOAD_REPLY"); }));
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: true });
  modelRuntime.registerNativeProvider(faux.provider);
  // Match installation: execute a distinct materialized file. Bun caches the source asset
  // as a file-path string when global-materialization imports it with { type: "file" }.
  const extensionPath = join(root, "deck-memory.js");
  copyFileSync(resolve(import.meta.dir, "../../../assets/pi/extensions/deck-memory.generated.js"), extensionPath);
  const loader = new DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [extensionPath] });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  expect(loader.getExtensions().extensions.flatMap(extension => [...extension.tools.keys()])).toContain("memory_search");
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(), resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }) });
  const errors: unknown[] = [];
  await session.bindExtensions({ onError: error => errors.push(error) });
  const diagnostics: string[] = [];
  const stderr = spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => { diagnostics.push(String(chunk)); return true; }) as typeof process.stderr.write);
  try {
    const id = session.sessionManager.getSessionId();
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle) await session.reload();
      expect(session.sessionManager.getSessionId()).toBe(id);
      expect(session.getActiveToolNames(), `cycle ${cycle}: ${diagnostics.join("\n")}`).toContain("memory_search");
      expect(session.getActiveToolNames()).toContain("memory_save");
      expect(Object.keys(process.env).filter(key => key.startsWith("DECK_RUNNER_MEMORY_TOKEN"))).toEqual([]);
      const search = session.agent.state.tools.find(tool => tool.name === "memory_search")!;
      const save = session.agent.state.tools.find(tool => tool.name === "memory_save")!;
      const searchResult = await search.execute(`search-${cycle}`, { query: "reload fact" }, undefined);
      const saveResult = await save.execute(`save-${cycle}`, { content: "reload decision", kind: "decision" }, undefined);
      expect(JSON.stringify([searchResult, saveResult])).not.toContain(host.token);
      await session.prompt(`reload question ${cycle}`);
      expect(requests[cycle]).toContain("RELOAD_MEMORY_FACT");
      expect(host.named("shutdown_flush")).toHaveLength(0);
    }
    expect(host.named("session_start")).toHaveLength(3);
    expect(host.named("capture").filter(event => event.source === "trusted-user-prompt")).toHaveLength(3);
    expect(errors).toEqual([]);
    expect(diagnostics.join("\n")).not.toContain("Deck memory:");
    expect(diagnostics.join("\n")).not.toContain(host.token);
    expect(host.named("search")).toHaveLength(3);
    expect(host.acceptedSaves).toHaveLength(3);
    expect(JSON.stringify(session.sessionManager.getEntries())).not.toContain(host.token);
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    expect(host.named("shutdown_flush")).toHaveLength(1);
  } finally { stderr.mockRestore(); session.dispose(); }
}, 60_000);
