import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { writeSupermemoryPiMcpConfig } from "@deck/adapter-pi";
import { createSupermemoryRuntime, createSupermemoryHttpTransport } from "@deck/adapter-supermemory/runtime";
import { createOwnerOnlyFileSecretStore, getDefaultDeckConfig, redactSecretDiagnostic } from "@deck/core";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";

export async function runInternalSupermemoryRuntimeSmoke(): Promise<{ exitCode: number; output: string }> {
  if (process.env.DECK_ENABLE_INTERNAL_SUPERMEMORY_RUNTIME_SMOKE !== "1") {
    return { exitCode: 2, output: JSON.stringify({ ok: false, code: "internal-smoke-disabled" }) };
  }
  const scope = process.env.DECK_INTERNAL_SUPERMEMORY_PROJECT_SCOPE ?? "sm_project_v1_kevin15011_deck";
  const baseURL = process.env.DECK_INTERNAL_SUPERMEMORY_API_BASE_URL;
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const apiKey = createOwnerOnlyFileSecretStore({ configHome }).read("supermemory-api-key");
  if (!apiKey) return { exitCode: 1, output: JSON.stringify({ ok: false, code: "missing-runtime-credential" }) };

  try {
    const runtime = createSupermemoryRuntime({
      canonicalScope: scope,
      sessionId: "compiled-deck-smoke",
      runnerId: "compiled-deck-smoke",
      transport: createSupermemoryHttpTransport({ apiKey, baseURL, timeoutMs: 2_000 }),
    });
    const health = await runtime.health({ dependency: "explicit-recall" });
    const profile = await runtime.profile({ role: "lead", dependency: "explicit-recall" });
    const search = await runtime.search({ role: "lead", query: "compiled deck smoke", dependency: "explicit-recall" });
    const capture = await runtime.capture({
      role: "user",
      source: "explicit-remember",
      dependency: "explicit-remember",
      correlationId: "compiled-deck-explicit-remember",
      content: "Important limitation: compiled runtime smoke proves endpoint contracts only with an offline HTTP fixture.",
    });

    const invalidRuntime = createSupermemoryRuntime({
      canonicalScope: scope,
      sessionId: "compiled-deck-invalid-auth",
      runnerId: "compiled-deck-smoke",
      transport: createSupermemoryHttpTransport({ apiKey: "sm_bad_compiled", baseURL, timeoutMs: 2_000 }),
    });
    const invalidAuth = await invalidRuntime.health({ dependency: "explicit-recall" });
    const invalidAuthSafe = !JSON.stringify(invalidAuth).includes("sm_bad_compiled") && !invalidAuth.ok;

    const mcp = writeSupermemoryPiMcpConfig({ homeDir: process.env.HOME ?? homedir(), serverName: "supermemory", projectScope: scope });
    const mcpText = mcp.path ? readFileSync(mcp.path, "utf8") : "";
    const credentialFreeMcp = mcp.ok && !mcpText.includes("x-supermemory-api-key") && !mcpText.includes(apiKey);

    const runtimeHost = await createSupermemoryRuntimeHost({
      projectRoot: process.cwd(),
      canonicalScope: scope,
      deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } },
      runnerId: "codex",
      role: "lead",
      launchMode: "interactive",
      apiKey,
      transport: createSupermemoryHttpTransport({ apiKey, baseURL, timeoutMs: 2_000 }),
    });
    const loopback = await runtimeHost.startLoopbackBridge();
    const loopbackResponse = loopback
      ? await fetch(loopback.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${loopback.token}`, "content-type": "application/json" },
          body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "codex", eventId: "compiled-loopback-capture", timestamp: Date.now(), event: "capture", sessionId: "compiled-loopback", source: "trusted-user-prompt", content: "Important limitation: compiled loopback smoke uses a local HTTP fixture." }),
        }).then((response) => response.json() as Promise<{ ok?: boolean }>)
      : { ok: false };
    if (loopback) await loopback.close();
    const loopbackCapture = loopbackResponse.ok === true;

    const ok = health.ok && profile.ok && search.ok && capture.ok && invalidAuthSafe && credentialFreeMcp && loopbackCapture;
    return {
      exitCode: ok ? 0 : 1,
      output: JSON.stringify({
        ok,
        operations: { health: health.ok, profile: profile.ok, search: search.ok, capture: capture.ok, invalidAuthSafe, credentialFreeMcp, loopbackCapture },
        diagnostics: [
          ...(!health.ok ? health.diagnostics : []),
          ...(!profile.ok ? profile.diagnostics : []),
          ...(!search.ok ? search.diagnostics : []),
          ...(!capture.ok ? capture.diagnostics : []),
          ...(credentialFreeMcp ? [] : mcp.diagnostics.map((diagnostic) => diagnostic.message)),
        ].map(redactSecretDiagnostic),
      }),
    };
  } catch (error) {
    return { exitCode: 1, output: JSON.stringify({ ok: false, code: "runtime-smoke-failed", message: redactSecretDiagnostic(error instanceof Error ? error.message : String(error)) }) };
  }
}
