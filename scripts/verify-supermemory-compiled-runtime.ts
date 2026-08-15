#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const targets = ["bun-linux-x64", "bun-linux-arm64", "bun-darwin-x64", "bun-darwin-arm64"] as const;
const dryRun = process.argv.includes("--dry-run");
const temp = mkdtempSync(join(tmpdir(), "deck-sm-compiled-"));
const calls: Array<{ path: string; method: string; authorization: string | null; body: any }> = [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "GET" ? null : await request.json().catch(() => null);
    calls.push({ path: url.pathname, method: request.method, authorization: request.headers.get("authorization"), body });
    if (request.headers.get("authorization") === "Bearer sm_bad_compiled") return new Response("bad token sm_bad_compiled", { status: 401 });
    if (url.pathname === "/v3/documents") return Response.json({ id: "doc" });
    if (url.pathname === "/v4/search") return Response.json({ results: [{ id: "m", memory: "compiled deck recall" }] });
    if (url.pathname === "/v4/profile") return Response.json({ profile: { static: ["compiled deck profile"], dynamic: [] } });
    return new Response("unexpected " + url.pathname, { status: 404 });
  },
});

try {
  const source = join(temp, "harness.ts");
  const outfile = join(temp, "harness");
  writeFileSync(source, `
    import { createSupermemoryRuntime, createSupermemoryHttpTransport } from ${JSON.stringify(join(process.cwd(), "packages/adapter-supermemory/src/runtime.ts"))};
    const calls: Array<{ path: string; method: string; authorization: string | null; body: any }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET" ? null : await request.json().catch(() => null);
        calls.push({ path: url.pathname, method: request.method, authorization: request.headers.get("authorization"), body });
        if (request.headers.get("authorization") === "Bearer sm_bad_compiled") return new Response("bad token sm_bad_compiled", { status: 401 });
        if (url.pathname === "/v4/search" && body?.q === "timeout") await new Promise((resolve) => setTimeout(resolve, 100));
        if (url.pathname === "/v3/documents") return Response.json({ id: "doc" });
        if (url.pathname === "/v4/search") return Response.json({ results: [{ id: "m", memory: "compiled recall" }] });
        if (url.pathname === "/v4/profile") return Response.json({ profile: { static: ["compiled profile"], dynamic: [] } });
        return new Response("unexpected " + url.pathname, { status: 404 });
      },
    });
    try {
      const scope = "sm_project_v1_kevin15011_deck";
      const transport = createSupermemoryHttpTransport({ apiKey: "sm_test_compiled", baseURL: "http://127.0.0.1:" + server.port, timeoutMs: 2000 });
      const runtime = createSupermemoryRuntime({ canonicalScope: scope, sessionId: "compiled", runnerId: "compiled-smoke", transport });
      const health = await runtime.health({ dependency: "automatic" });
      const search = await runtime.search({ role: "lead", query: "compiled", dependency: "explicit-recall" });
      const profile = await runtime.profile({ role: "lead", dependency: "explicit-recall" });
      const capture = await runtime.capture({ role: "assistant", source: "trusted-final-assistant", dependency: "automatic", content: "Compiled runtime captured a bounded high-signal final assistant summary." });
      if (!health.ok || !search.ok || !profile.ok || !capture.ok) throw new Error("compiled runtime failed");
      const timeoutRuntime = createSupermemoryRuntime({ canonicalScope: scope, sessionId: "compiled-timeout", runnerId: "compiled-smoke", transport: createSupermemoryHttpTransport({ apiKey: "sm_test_compiled", baseURL: "http://127.0.0.1:" + server.port, timeoutMs: 1 }) });
      const timeoutResult = await timeoutRuntime.search({ role: "lead", query: "timeout", dependency: "explicit-recall" });
      if (timeoutResult.ok || !timeoutResult.diagnostics.join(" ").includes("reason=timeout")) throw new Error("timeout path was not exercised");
      const invalidAuthRuntime = createSupermemoryRuntime({ canonicalScope: scope, sessionId: "compiled-invalid", runnerId: "compiled-smoke", transport: createSupermemoryHttpTransport({ apiKey: "sm_bad_compiled", baseURL: "http://127.0.0.1:" + server.port, timeoutMs: 2000 }) });
      const invalidAuth = await invalidAuthRuntime.health({ dependency: "explicit-recall" });
      if (invalidAuth.ok) throw new Error("invalid auth unexpectedly succeeded");
      if (JSON.stringify(invalidAuth).includes("sm_bad_compiled")) throw new Error("invalid auth diagnostic leaked bearer token");
      const disabledRuntime = createSupermemoryRuntime({ canonicalScope: "missing", sessionId: "compiled-disabled", runnerId: "compiled-smoke", transport });
      const disabled = await disabledRuntime.health({ dependency: "automatic" });
      if (disabled.ok || disabled.reason !== "invalid_project_scope") throw new Error("disabled/missing scope path was not exercised");
      const paths = calls.map((call) => call.path).sort();
      for (const required of ["/v3/documents", "/v4/profile", "/v4/search"]) {
        if (!paths.includes(required)) throw new Error("missing HTTP endpoint " + required + " saw " + paths.join(","));
      }
      for (const call of calls) {
        if (call.authorization !== "Bearer sm_test_compiled" && call.authorization !== "Bearer sm_bad_compiled") throw new Error("missing bearer header for " + call.path);
      }
      const serialized = JSON.stringify(calls);
      if (!serialized.includes(scope)) throw new Error("containerTag missing from HTTP payloads");
      if (!serialized.includes("deck_conversation_")) throw new Error("customId missing from capture payload");
      if (serialized.includes("node_modules") || serialized.includes("npm ")) throw new Error("compiled runtime leaked external module path or npm dependency wording");
      console.log("compiled-supermemory-runtime ok");
    } finally {
      server.stop(true);
    }
  `);

  if (dryRun) console.log("dry-run still compiles all release targets; only host target is executed. Local provider fixture is HTTP-only; TLS is covered by the runtime platform, not this offline smoke.");
  const selected = targets;
  for (const target of selected) {
    const build = Bun.spawnSync({ cmd: ["bun", "build", "--compile", `--target=${target}`, "--outfile", outfile, source], cwd: process.cwd() });
    if (!build.success) throw new Error(`compile failed for ${target}: ${new TextDecoder().decode(build.stderr)}`);
    if (target === hostTarget()) {
      const run = Bun.spawnSync({ cmd: [outfile], cwd: temp, env: { PATH: "" } });
      if (!run.success) throw new Error(`compiled runtime smoke failed: ${new TextDecoder().decode(run.stderr)} ${new TextDecoder().decode(run.stdout)}`);
      console.log(new TextDecoder().decode(run.stdout).trim());
      const deckOutfile = join(temp, "deck-cli");
      const deckBuild = Bun.spawnSync({ cmd: ["bun", "build", "--compile", `--target=${target}`, "--outfile", deckOutfile, join(process.cwd(), "apps/cli/src/main.tsx")], cwd: process.cwd() });
      if (!deckBuild.success) throw new Error(`Deck CLI compile failed for ${target}: ${new TextDecoder().decode(deckBuild.stderr)}`);
      const archiveSource = join(temp, "archive-source");
      const archivePath = join(temp, "deck_v0.0.0_smoke.tar.gz");
      const extracted = join(temp, "extracted");
      mkdirSync(archiveSource, { recursive: true });
      mkdirSync(extracted, { recursive: true });
      copyFileSync(deckOutfile, join(archiveSource, "deck"));
      chmodSync(join(archiveSource, "deck"), 0o755);
      const archive = Bun.spawnSync({ cmd: ["tar", "-czf", archivePath, "-C", archiveSource, "deck"], cwd: temp });
      if (!archive.success) throw new Error(`release archive creation failed: ${new TextDecoder().decode(archive.stderr)}`);
      const extract = Bun.spawnSync({ cmd: ["tar", "-xzf", archivePath, "-C", extracted], cwd: temp });
      if (!extract.success) throw new Error(`release archive extraction failed: ${new TextDecoder().decode(extract.stderr)}`);
      const extractedDeck = join(extracted, "deck");
      const deckRun = Bun.spawnSync({ cmd: [extractedDeck, "version"], cwd: temp, env: { PATH: "" } });
      if (!deckRun.success) throw new Error(`compiled Deck CLI version failed from extracted release archive outside workspace with empty PATH: ${new TextDecoder().decode(deckRun.stderr)} ${new TextDecoder().decode(deckRun.stdout)}`);
      const version = new TextDecoder().decode(deckRun.stdout);
      if (!version.includes("deck ") || !version.includes("commit:")) throw new Error("compiled Deck CLI version did not render release metadata");
      console.log("compiled-deck-cli-version ok (extracted release archive, outside workspace, empty PATH)");
      const missingSecret = await spawnDeck({
        cmd: [extractedDeck, "internal", "supermemory-runtime-smoke"],
        cwd: temp,
        env: { PATH: "", XDG_CONFIG_HOME: join(temp, "missing-config"), HOME: join(temp, "missing-home"), DECK_ENABLE_INTERNAL_SUPERMEMORY_RUNTIME_SMOKE: "1", DECK_INTERNAL_SUPERMEMORY_API_BASE_URL: "http://127.0.0.1:" + server.port },
      });
      const missingSecretOutput = `${missingSecret.stdout}${missingSecret.stderr}`;
      if (missingSecret.exitCode !== 1 || !missingSecretOutput.includes("missing-runtime-credential")) throw new Error(`missing credential smoke did not fail explicitly: ${missingSecretOutput}`);

      const realDeckCallsStart = calls.length;
      const smokeConfig = join(temp, "runtime-smoke-config");
      const smokeHome = join(temp, "runtime-smoke-home");
      const secretDir = join(smokeConfig, "deck", "secrets");
      mkdirSync(secretDir, { recursive: true, mode: 0o700 });
      chmodSync(join(smokeConfig, "deck"), 0o700);
      chmodSync(secretDir, 0o700);
      writeFileSync(join(secretDir, "supermemory-api-key.secret"), "sm_test_compiled", { mode: 0o600 });
      const runtimeSmoke = await spawnDeck({
        cmd: [extractedDeck, "internal", "supermemory-runtime-smoke"],
        cwd: temp,
        env: { PATH: "", XDG_CONFIG_HOME: smokeConfig, HOME: smokeHome, DECK_ENABLE_INTERNAL_SUPERMEMORY_RUNTIME_SMOKE: "1", DECK_INTERNAL_SUPERMEMORY_API_BASE_URL: "http://127.0.0.1:" + server.port },
      });
      const runtimeSmokeOutput = `${runtimeSmoke.stdout}${runtimeSmoke.stderr}`;
      if (!runtimeSmoke.success) throw new Error(`extracted Deck runtime smoke failed: ${runtimeSmokeOutput}`);
      if (runtimeSmokeOutput.includes("sm_test_compiled") || runtimeSmokeOutput.includes("sm_bad_compiled")) throw new Error("extracted Deck runtime smoke leaked a credential");
      const realDeckCalls = calls.slice(realDeckCallsStart);
      const realDeckPaths = realDeckCalls.map((call) => call.path).sort();
      for (const required of ["/v3/documents", "/v4/profile", "/v4/search"]) {
        if (!realDeckPaths.includes(required)) throw new Error("extracted Deck runtime smoke missing endpoint " + required + " saw " + realDeckPaths.join(","));
      }
      if (!realDeckCalls.some((call) => call.path === "/v3/documents" && call.body?.metadata?.correlationId === "compiled-deck-explicit-remember")) throw new Error("extracted Deck runtime smoke did not exercise capture correlation contract");
      console.log("compiled-deck-runtime-operations ok (extracted release archive, mock endpoint, credential-free MCP materialization, authenticated loopback capture)");

      const hookCalls: any[] = [];
      const hookToken = "deck-loopback-compiled-hook-token";
      const hookServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const body = await request.json().catch(() => null);
          hookCalls.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), body });
          return Response.json({ ok: true, advisoryText: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>compiled hook</DECK_ADAPTIVE_CONTEXT_JSON_V1>" });
        },
      });
      try {
        const codexHook = await spawnDeck({
          cmd: [extractedDeck, "internal", "codex-memory-hook"],
          cwd: temp,
          env: { PATH: "", DECK_CODEX_BRIDGE_ENDPOINT: `http://127.0.0.1:${hookServer.port}/deck-runner-memory/v1`, DECK_CODEX_BRIDGE_TOKEN: hookToken },
          stdin: JSON.stringify({ session_id: "compiled-codex", turn_id: "turn-1", cwd: temp, hook_event_name: "UserPromptSubmit", prompt: "Remember that compiled Codex hook uses Deck, not Bun." }),
        });
        if (!codexHook.success) throw new Error(`compiled Codex hook command failed: ${codexHook.stderr}${codexHook.stdout}`);
        const parsedHook = JSON.parse(codexHook.stdout);
        if (parsedHook.hookSpecificOutput?.hookEventName !== "UserPromptSubmit" || !String(parsedHook.hookSpecificOutput?.additionalContext ?? "").includes("DECK_ADAPTIVE_CONTEXT_JSON_V1")) throw new Error(`compiled Codex hook did not emit official additionalContext: ${codexHook.stdout}`);
        if (hookCalls.length !== 1 || hookCalls[0]?.authorization !== `Bearer ${hookToken}`) throw new Error("compiled Codex hook did not call loopback exactly once with bearer auth");
        console.log("compiled-codex-hook-command ok (extracted release archive, empty PATH, Deck-owned executable)");
      } finally {
        hookServer.stop(true);
      }

      const doctorState = join(temp, "doctor-state");
      const doctorConfig = join(temp, "doctor-config");
      const doctor = Bun.spawnSync({ cmd: [extractedDeck, "doctor"], cwd: temp, env: { PATH: "", XDG_STATE_HOME: doctorState, XDG_CONFIG_HOME: doctorConfig, HOME: temp } });
      const doctorOutput = `${new TextDecoder().decode(doctor.stdout)}${new TextDecoder().decode(doctor.stderr)}`;
      if (doctor.exitCode !== 0 && doctor.exitCode !== 1) throw new Error(`compiled Deck CLI doctor smoke failed unexpectedly: ${doctorOutput}`);
      if (!/Doctor|Deck Doctor|Runtime|Memory/i.test(doctorOutput)) throw new Error("compiled Deck CLI doctor smoke did not render diagnostics");
      if (doctorOutput.includes("Install Supermemory") || doctorOutput.includes("Supermemory not found in PATH")) throw new Error("compiled Deck CLI doctor still reports obsolete Supermemory CLI install guidance");
      if (doctorOutput.includes("supported only on Deck-supervised exec paths")) throw new Error("compiled Deck CLI doctor still reports stale exec-only memory route guidance");
      if (!doctorOutput.includes("Deck-supervised native loopback route matrix") || !doctorOutput.includes("No Supermemory CLI package is required")) throw new Error("compiled Deck CLI doctor did not report native loopback route matrix");
      if (existsSync(join(doctorState, "deck", "supermemory-runtime.jsonl"))) throw new Error("Doctor created the Supermemory observability sink during read-only smoke");
      console.log("compiled-deck-cli-doctor-readonly ok (extracted release archive, outside workspace, empty PATH)");
    } else {
      console.log(`compile-only ${target} ok (not executable on ${hostTarget()})`);
    }
  }
} finally {
  server.stop(true);
  rmSync(temp, { recursive: true, force: true });
}

function hostTarget(): typeof targets[number] {
  if (process.platform === "darwin") return process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
  return process.arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
}

async function spawnDeck(input: { cmd: string[]; cwd: string; env: Record<string, string>; stdin?: string }): Promise<{ exitCode: number; success: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = nodeSpawn(input.cmd[0]!, input.cmd.slice(1), { cwd: input.cwd, env: input.env, stdio: [input.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    if (input.stdin !== undefined) child.stdin.end(input.stdin);
    child.once("error", (error) => resolve({ exitCode: 1, success: false, stdout, stderr: `${stderr}${error.message}` }));
    child.once("close", (code) => resolve({ exitCode: code ?? 1, success: code === 0, stdout, stderr }));
  });
}
