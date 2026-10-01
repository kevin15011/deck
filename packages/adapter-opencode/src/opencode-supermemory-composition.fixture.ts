import { strict as assert } from "node:assert";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createRunnerHostFixtureV1 } from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { mergeConfig } from "./config-merge";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";

type GeneratedOpenCodeHooks = Record<string, (...args: any[]) => Promise<unknown>>;

async function loadGeneratedDeckPlugin(): Promise<GeneratedOpenCodeHooks> {
  const module = await import(new URL("../assets/opencode/plugins/developer-team-execution.generated.js", import.meta.url).href) as unknown as {
    default: (input: { directory: string; worktree: string; client: Record<string, unknown> }) => Promise<GeneratedOpenCodeHooks>;
  };
  return module.default({ directory: process.cwd(), worktree: process.cwd(), client: {} });
}
import {
  OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY,
  OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
  installOwnedOpenCodeSupermemory,
  resolveOwnedOpenCodeSupermemoryPaths,
} from "./opencode-supermemory-plugin";

const publishedArtifact = process.env.OPENCODE_PLUGIN_FIXTURE_PATH;
assert(publishedArtifact, "OPENCODE_PLUGIN_FIXTURE_PATH is required");
const root = mkdtempSync(join(tmpdir(), "deck-supermemory-composition-"));

try {
  const environment = { XDG_DATA_HOME: root, OPENCODE_DISABLE_PROJECT_CONFIG: "1" };
  const paths = resolveOwnedOpenCodeSupermemoryPaths({ environment, homeDirectory: root });
  const installed = await installOwnedOpenCodeSupermemory({
    projectRoot: root,
    environment,
    homeDirectory: root,
    runInstallCommand: async () => {
      mkdirSync(paths.packageDirectory, { recursive: true });
      cpSync(join(publishedArtifact, "dist"), join(paths.packageDirectory, "dist"), { recursive: true });
      cpSync(join(publishedArtifact, "package.json"), join(paths.packageDirectory, "package.json"));
      writeFileSync(join(paths.installRoot, "package-lock.json"), JSON.stringify({
        packages: {
          "node_modules/opencode-supermemory": {
            version: OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
            integrity: OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY,
          },
        },
      }));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(installed.ok, true);

  process.env.HOME = root;
  process.env.SUPERMEMORY_API_KEY = "sm_fixture_only";
  process.env.SUPERMEMORY_API_URL = "https://api.supermemory.ai";
  process.env.SUPERMEMORY_REPO_TAG = "sm_project_v1_fixture_repository";
  const requests: string[] = [];
  const requestBodies: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const body = input instanceof Request
      ? await input.clone().text()
      : typeof init?.body === "string" ? init.body : "";
    if (body) requestBodies.push(body);
    if (url.includes("registry.npmjs.org")) return new Response(JSON.stringify({ version: "2.0.15" }), { status: 200 });
    if (url.includes("/documents") && !url.includes("search")) return new Response(JSON.stringify({ id: "memory-fixture" }), { status: 200 });
    return new Response(JSON.stringify({ memories: [], results: [], pagination: { currentPage: 1, totalItems: 0, totalPages: 0 } }), { status: 200 });
  }) as typeof fetch;

  const module = await import(`${pathToFileURL(installed.paths.loaderPath).href}?composition=${Date.now()}`) as {
    default: { server: (context: unknown) => Promise<Record<string, any>> };
  };
  let summarizeCalls = 0;
  const officialHooks = await module.default.server({
    directory: root,
    client: {
      provider: { list: async () => ({ data: { all: [] } }) },
      session: {
        messages: async () => ({ data: [
          { info: { id: "user-1", role: "user" }, parts: [{ type: "text", text: "Remember the selected architecture." }] },
          { info: { id: "assistant-1", role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "The architecture was selected." }] },
        ] }),
        summarize: async () => { summarizeCalls += 1; return {}; },
        promptAsync: async () => ({}),
      },
      tui: { showToast: async () => ({}) },
    },
  });
  process.env.OPENCODE_DECK_INVOCATION_AUTHORIZATION = "invocation-required";
  const deckHooks = await loadGeneratedDeckPlugin();
  let authorizationDenied = false;
  try {
    await officialHooks["tool.execute.before"]?.(
      { tool: "delegate", sessionID: "session-1", callID: "call-1" },
      { args: { subagent_type: "deck-apply-fast" } },
    );
    await deckHooks["tool.execute.before"](
      { tool: "delegate", sessionID: "session-1", callID: "call-1" },
      { args: { subagent_type: "deck-apply-fast" } },
    );
  } catch (error) {
    authorizationDenied = String(error).includes("modification-not-authorized:AUTHZ_MISSING");
  }
  delete process.env.OPENCODE_DECK_INVOCATION_AUTHORIZATION;
  const stableHooks = await loadGeneratedDeckPlugin();
  let staticCompatibleApplyAllowed = true;
  try {
    await stableHooks["tool.execute.before"](
      { tool: "delegate", sessionID: "stable-session", callID: "stable-call" },
      { args: { subagent_type: "deck-apply-fast" } },
    );
  } catch {
    staticCompatibleApplyAllowed = false;
  }
  process.env.OPENCODE_DECK_INVOCATION_AUTHORIZATION = "invocation-required";

  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let authorityReads = 0;
  const hostContext = Symbol.for("deck.developer-team.execution-context.v1");
  (globalThis as Record<PropertyKey, unknown>)[hostContext] = {
    invocationAuthorization: "static-compatible",
    resolveOpenCode: async () => new Proxy(fixture.event() as unknown as Record<string, unknown>, {
      get(target, property, receiver) {
        if (property === "dossier") authorityReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
  };
  const authorizedHooks = await loadGeneratedDeckPlugin();
  for (const role of ["deck-apply-fast", "deck-apply-deep"]) {
    const sessionID = `authorized-${role}`;
    await authorizedHooks["chat.message"](
      { sessionID, messageID: `message-${role}` },
      { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
    );
    await authorizedHooks["tool.execute.before"](
      { tool: "delegate", sessionID, callID: `call-${role}` },
      { args: { subagent_type: role } },
    );
  }
  delete (globalThis as Record<PropertyKey, unknown>)[hostContext];

  await officialHooks.event({ event: { type: "session.idle", properties: { sessionID: "session-1" } } });
  await officialHooks.event({ event: { type: "session.deleted", properties: { info: { id: "session-1" } } } });
  await officialHooks.event({ event: { type: "message.updated", properties: { info: {
    sessionID: "session-2",
    role: "assistant",
    finish: "stop",
    providerID: "fixture-provider",
    modelID: "fixture-model",
    tokens: { input: 190_000, output: 1_000, cache: { read: 0 } },
  } } } });

  const composedConfig = mergeConfig({
    plugin: ["file:///deck/developer-team-execution.js", "rtk"],
    mcp: { "context-mode": { type: "local", command: ["context-mode"], enabled: true } },
  }, {}, [installed.paths.loaderLocator]);
  const contextMode = composedConfig.mcp?.["context-mode"] as { enabled?: boolean } | undefined;
  console.log(JSON.stringify({
    installed: installed.ok,
    authorizationDenied,
    authorizationAllowed: authorityReads >= 2,
    staticCompatibleApplyAllowed,
    captureObserved: requests.some((url) => url.startsWith("https://api.supermemory.ai") && url.includes("documents")),
    canonicalTagObserved: requestBodies.some((body) => body.includes("sm_project_v1_fixture_repository")),
    compactionObserved: summarizeCalls === 1,
    rtkConfigPreserved: composedConfig.plugin?.includes("rtk") === true,
    contextModeConfigPreserved: contextMode?.enabled === true,
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
