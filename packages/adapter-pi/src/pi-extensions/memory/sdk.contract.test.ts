import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startFakeLoopbackHost } from "../../__fixtures__/fake-loopback-host";
import { createDeckMemoryExtension } from "./extension";

const ADVISORY = "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nadvisory\n{\"items\":[\"SDK_FACT_7\"]}\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>";

let sdk: typeof import("@earendil-works/pi-coding-agent") | undefined;
let ai: typeof import("@earendil-works/pi-ai") | undefined;
try {
  sdk = await import("@earendil-works/pi-coding-agent");
  ai = await import("@earendil-works/pi-ai");
} catch {
  sdk = undefined;
}
// Skips with a reason when the Pi SDK dev dependency is not installed.
const sdkTest = sdk && ai ? test : test.skip;

let root: string;
let host: ReturnType<typeof startFakeLoopbackHost> | undefined;
const saved = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-memory-sdk-"));
  mkdirSync(join(root, "agent"), { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "project"), { recursive: true });
  process.env.HOME = join(root, "home");
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
});
afterEach(() => {
  host?.stop();
  host = undefined;
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

describe("deck-memory through the Pi 1.0 SDK (DefaultResourceLoader extension factories + faux provider)", () => {
  sdkTest("recall reaches the model request, the turn is captured, and the explicit shutdown path flushes", async () => {
    const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = sdk!;
    host = startFakeLoopbackHost({ dir: root, advisory: ADVISORY });
    const faux = ai!.fauxProvider();
    let providerText = "";
    faux.setResponses([(context: { messages: unknown[] }) => { providerText = JSON.stringify(context.messages); return ai!.fauxAssistantMessage("SDK_ASSISTANT_TEXT"); }]);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: true });
    modelRuntime.registerNativeProvider(faux.provider);
    const env: Record<string, string | undefined> = { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", ...host.env };
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: [createDeckMemoryExtension({ env })] });
    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel(), resourceLoader, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({}) });

    await session.prompt("sdk question");
    expect(providerText).toContain("SDK_FACT_7");
    expect(providerText.split("<DECK_ADAPTIVE_CONTEXT_JSON_V1>").length - 1).toBe(1);
    expect(Object.keys(env).filter((key) => key.startsWith("DECK_RUNNER_MEMORY_TOKEN"))).toEqual([]);

    // session.dispose() does not emit session_shutdown on the SDK; invoke the shutdown path explicitly.
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();

    expect(host.named("session_start")).toHaveLength(1);
    expect(host.named("capture").map((event) => [event.source, event.content])).toEqual([["trusted-user-prompt", "sdk question"], ["trusted-final-assistant", "SDK_ASSISTANT_TEXT"]]);
    expect(host.events.at(-1)!.body.event).toBe("shutdown_flush");
    const persisted = JSON.stringify(session.sessionManager.getEntries());
    expect(persisted).not.toContain("custom_message");
    expect(persisted).not.toContain("SDK_FACT_7");
  }, 60_000);
});
