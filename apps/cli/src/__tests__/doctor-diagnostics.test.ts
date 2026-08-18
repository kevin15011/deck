import { describe, expect, test, vi } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";
import { createDeckConfigStore } from "../deck-config-store";
import { installGlobalConfigRealEnvSentinel } from "../../../../packages/core/src/config/global-config-real-env-sentinel.test-helper";

installGlobalConfigRealEnvSentinel();

// Store mock functions at module scope so each test can configure them.
// This avoids vi.mocked() which is not available in Bun's vitest.
const mockInspectPiEnvironment = vi.fn();
const mockReviewPiRequiredTools = vi.fn();
const mockValidateSupermemoryPiMcpConfig = vi.fn();
const mockInspectOpenCodeEnvironment = vi.fn();
const mockReviewOpenCodeTools = vi.fn();
const mockValidateSupermemoryOpenCodeMcpConfig = vi.fn();
const mockDetectSelectedRuntimes = vi.fn();

import { runDoctorDiagnostics } from "../doctor-command/doctor-diagnostics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fabPiStatus(command = "pi") {
  return { environment: "Pi Development Environment", runtime: "pi" as const, installed: true, command };
}

function fabClaudeStatus(command = "claude") {
  return { environment: "Claude Development Environment", runtime: "claude" as const, installed: true, command };
}

function fabOpenCodeStatus(command = "opencode") {
  return { environment: "OpenCode Development Environment", runtime: "opencode" as const, installed: true, command };
}

function fabCodexStatus(command = "codex") {
  return { environment: "Codex Development Environment", runtime: "codex" as const, installed: true, command };
}

function fabOkMcpResult() {
  return {
    ok: true,
    path: "/fake",
    serverName: "supermemory",
    diagnostics: [],
  };
}

function mockInstalledOpenCodeRuntime() {
  mockDetectSelectedRuntimes.mockReturnValue([fabOpenCodeStatus()]);
  mockInspectOpenCodeEnvironment.mockReturnValue({
    version: "1.0.0",
    configDirectory: "/fake",
    packageManifest: { name: "opencode" },
    existingConfiguration: true,
  });
  mockReviewOpenCodeTools.mockReturnValue({ installedPackages: [], tools: [], toolStatuses: [] });
}

function gitProjectRoot(remote = "git@github.com:kevin15011/deck.git") {
  const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-project-"));
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: projectRoot, stdio: "ignore" });
  return projectRoot;
}

function supermemoryReadinessLine(result: DoctorDiagnosticsResult): string {
  return result.memory.find((item) => item.category === "Supermemory Runtime")?.items[0]?.message ?? "";
}


function fabDependencies() {
  const root = mkdtempSync(join(tmpdir(), "deck-doctor-config-"));
  const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: join(root, "repo") });
  configStore.write({});
  return {
    detectSelectedRuntimes: mockDetectSelectedRuntimes,
    inspectPiEnvironment: mockInspectPiEnvironment,
    reviewPiRequiredTools: mockReviewPiRequiredTools,
    validateSupermemoryPiMcpConfig: mockValidateSupermemoryPiMcpConfig,
    inspectOpenCodeEnvironment: mockInspectOpenCodeEnvironment,
    reviewOpenCodeTools: mockReviewOpenCodeTools,
    validateSupermemoryOpenCodeMcpConfig: mockValidateSupermemoryOpenCodeMcpConfig,
    configStore,
    runDeckChecks: vi.fn(async () => ({ deck: [], binary: [], runnerConfig: [] })),
    fetchReleaseDescriptor: vi.fn(() => ({
      kind: "legacy" as const,
      reason: "missing" as const,
      info: {
        tagName: "v0.0.0",
        version: "0.0.0",
        downloadUrl: "",
        sha256: "",
        publishedAt: "2026-01-01T00:00:00.000Z",
        body: "",
        commit: null,
      },
    })),
    memoryBinaryAvailable: vi.fn((_command: string) => false),
    readOpenCodeMcpSection: vi.fn((): Record<string, unknown> | null => null),
    readSupermemorySecret: vi.fn((): string | undefined => undefined),
    checkSupermemoryApi: vi.fn(async () => undefined),
    checkSupermemoryObservabilitySink: vi.fn(() => ({ ok: true, path: "/tmp/deck/supermemory-runtime.jsonl", diagnostics: ["Doctor did not create it."] })),
    inspectCodex: vi.fn(async (): Promise<ReadonlyArray<{ category: string; status: "ok" | "warning" | "error"; message: string; suggestion?: string }>> => []),
  };
}

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------

describe("runDoctorDiagnostics", () => {
  // ── All runtimes absent ──────────────────────────────────────────────────

  test("all runtimes absent → runtimes array is empty", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    expect(result.runtimes).toHaveLength(0);
    expect(result.hasCriticalErrors).toBe(true);
  });

  test("passes caller-verified project root to Codex diagnostics", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabCodexStatus()]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    const dependencies = fabDependencies();
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-verified-root-"));

    await runDoctorDiagnostics(dependencies, projectRoot);

    expect(dependencies.inspectCodex).toHaveBeenCalledWith(projectRoot, expect.any(Object));
  });

  test("reports Supermemory project scope agreement in top-level MCP diagnostics", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue({
      ...fabOkMcpResult(),
      projectScope: "sm_project_v1_kevin15011_deck",
    });
    const dependencies = fabDependencies();
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      supermemory: {
        type: "remote",
        url: "https://mcp.supermemory.ai/mcp",
        headers: { "x-sm-project": "sm_project_v1_kevin15011_deck" },
      },
    });
    mockValidateSupermemoryOpenCodeMcpConfig.mockReturnValue({
      ...fabOkMcpResult(),
      projectScope: "sm_project_v1_kevin15011_deck",
    });
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-sm-scope-"));
    mkdirSync(join(projectRoot, ".git", "objects", "info"), { recursive: true });
    mkdirSync(join(projectRoot, ".git", "objects", "pack"), { recursive: true });
    mkdirSync(join(projectRoot, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(projectRoot, ".git", "config"), '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:kevin15011/deck.git\n');

    const result = await runDoctorDiagnostics(dependencies, projectRoot);

    expect(result.mcp).toContainEqual(expect.objectContaining({
      category: "Supermemory Project Scope",
      status: "ok",
    }));
    expect(result.summary?.sections).toContain("Supermemory Project Scope");
  });

  test("fails closed for Codex diagnostics when no verified project root is available", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabCodexStatus()]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    const dependencies = fabDependencies();

    const result = await runDoctorDiagnostics(dependencies);

    expect(dependencies.inspectCodex).not.toHaveBeenCalled();
    expect(result.runtimes[0]?.checks[0]?.status).toBe("error");
    expect(result.runtimes[0]?.checks[0]?.items[0]?.message).toContain("verified project root");
    expect(result.hasCriticalErrors).toBe(true);
  });

  // ── Pi installed with all packages OK ─────────────────────────────────────

  test("Pi with all packages OK → runtime and packages show ok status", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabPiStatus()]);
    mockInspectPiEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      existingConfiguration: false,
    });
    mockReviewPiRequiredTools.mockReturnValue({
      installedPackages: [],
      requiredTools: [
        { name: "pi-package-a", installed: true },
        { name: "pi-package-b", installed: true },
      ],
      tools: [],
    });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    const pi = result.runtimes.find((r) => r.runtimeId === "pi");
    expect(pi).toBeDefined();
    expect(pi!.installed).toBe(true);
    expect(pi!.version).toBe("1.0.0");

    const packagesCategory = pi!.checks.find((c) => c.category === "Packages");
    expect(packagesCategory).toBeDefined();
    expect(packagesCategory!.status).toBe("ok");
    expect(packagesCategory!.items.every((i) => i.status === "ok")).toBe(true);
  });

  // ── Pi with missing packages ─────────────────────────────────────────────

  test("Pi with missing packages → missing packages show error with suggestion", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabPiStatus()]);
    mockInspectPiEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      existingConfiguration: false,
    });
    mockReviewPiRequiredTools.mockReturnValue({
      installedPackages: [],
      requiredTools: [
        { name: "pi-package-a", installed: true },
        { name: "pi-package-missing", installed: false },
      ],
      tools: [],
    });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    const pi = result.runtimes.find((r) => r.runtimeId === "pi");
    const packagesCategory = pi!.checks.find((c) => c.category === "Packages");
    expect(packagesCategory!.items.some((i) => i.status === "error")).toBe(true);

    const missingItem = packagesCategory!.items.find((i) => i.status === "error");
    expect(missingItem?.suggestion).toContain("pi-package-missing");
  });

  // ── Claude detected without package verification ────────────────────────────

  test("Claude detected → only Runtime check, no package verification", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabClaudeStatus()]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    const claude = result.runtimes.find((r) => r.runtimeId === "claude");
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.checks).toHaveLength(1);
    expect(claude!.checks[0].category).toBe("Runtime");
    expect(claude!.checks[0].items[0].status).toBe("ok");
    expect(claude!.checks[0].items[0].message).toContain("Claude detected");
  });

  test("Codex doctor projects trust, content, capability, route, collision, and recovery checks safely", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabCodexStatus()]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    const dependencies = fabDependencies();
    dependencies.inspectCodex.mockResolvedValue([
      { category: "Trust activation", status: "warning", message: "Project trust is indeterminate." },
      { category: "Managed content", status: "error", message: "MCP collision token=secret-value", suggestion: "Resolve collision." },
      { category: "Execution route: exec", status: "warning", message: "exec: static-compatible." },
      { category: "Rollback and recovery", status: "error", message: "One transaction contains conflicts." },
    ]);
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-codex-root-"));
    const result = await runDoctorDiagnostics(dependencies, projectRoot);
    const codex = result.runtimes.find((runtime) => runtime.runtimeId === "codex")!;
    expect(codex.checks.map((check) => check.category)).toEqual(["Trust activation", "Managed content", "Execution route: exec", "Rollback and recovery"]);
    expect(JSON.stringify(codex)).not.toContain("secret-value");
  });

  // ── Supermemory runtime readiness ────────────────────────────────────────

  test("Supermemory normal-path check never exposes credentials", async () => {
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    dependencies.checkSupermemoryApi.mockResolvedValue({ operations: ["health", "profile", "search"] } as never);
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-sm-runtime-"));
    mkdirSync(join(projectRoot, ".git", "objects", "info"), { recursive: true });
    mkdirSync(join(projectRoot, ".git", "objects", "pack"), { recursive: true });
    mkdirSync(join(projectRoot, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(projectRoot, ".git", "config"), '[remote "origin"]\n\turl = git@github.com:kevin15011/deck.git\n');

    const result = await runDoctorDiagnostics(dependencies, projectRoot);

    expect(dependencies.memoryBinaryAvailable).not.toHaveBeenCalledWith("supermemory");
    const supermemoryCategory = result.memory.find((item) => item.category === "Supermemory Runtime");
    expect(supermemoryCategory).toBeDefined();
    const messages = supermemoryCategory!.items.map((item) => item.message).join(" ");
    expect(messages).not.toMatch(/Bearer\s+/i);
    expect(messages).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(messages).toContain("health, profile, search");
    expect(messages).not.toContain("health, profile, search, capture");
    expect(messages).toContain("unobservable-external-mcp");
    expect(messages).toContain("Doctor did not create, rotate, or write metrics");
    expect(messages).toContain("Deck-supervised native loopback route matrix");
    expect(messages).toContain("OpenCode model-message transform");
    expect(messages).toContain("Codex hookSpecificOutput.additionalContext");
    expect(messages).toContain("Pi remains unsupported unless Pi exposes a trusted final-assistant event");
    expect(messages).toContain("No Supermemory CLI package is required");
    expect(messages).not.toContain("supported only on Deck-supervised exec paths");
    expect(messages).not.toContain("Install Supermemory");
  });

  test("Supermemory Doctor uses only read-only provider and observability checks", async () => {
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    dependencies.checkSupermemoryApi.mockResolvedValue({ operations: ["health", "profile", "search"] } as never);
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-sm-readonly-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });

    await runDoctorDiagnostics(dependencies, projectRoot);

    expect(dependencies.checkSupermemoryApi).toHaveBeenCalledWith({ apiKey: "sk-test-doctor-secret-value", containerTag: "sm_project_v1_kevin15011_deck" });
    expect(dependencies.checkSupermemoryApi.mock.results[0]?.type).toBe("return");
    expect(dependencies.checkSupermemoryObservabilitySink).toHaveBeenCalledTimes(1);
  });

  test("Supermemory runtime readiness renders healthy managed state exactly", async () => {
    mockInstalledOpenCodeRuntime();
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    dependencies.checkSupermemoryApi.mockResolvedValue({ operations: ["health", "profile", "search"] } as never);
    const result = await runDoctorDiagnostics(dependencies, gitProjectRoot());

    expect(supermemoryReadinessLine(result)).toBe("Session topology: deck-managed; static=ready; managed=ready; adaptive-memory=ready; reason=deck-managed-ready.");
  });

  test("Supermemory runtime readiness renders missing auth exactly", async () => {
    mockInstalledOpenCodeRuntime();
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue(undefined);
    const result = await runDoctorDiagnostics(dependencies, gitProjectRoot());

    expect(supermemoryReadinessLine(result)).toBe("Session topology: deck-managed; static=ready; managed=blocked; adaptive-memory=blocked; reason=managed-runtime-auth-missing.");
  });

  test("Supermemory runtime readiness renders API failure after provider check exactly", async () => {
    mockInstalledOpenCodeRuntime();
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    dependencies.checkSupermemoryApi.mockRejectedValue(new Error("provider unavailable"));
    const result = await runDoctorDiagnostics(dependencies, gitProjectRoot());

    expect(supermemoryReadinessLine(result)).toBe("Session topology: deck-managed; static=ready; managed=degraded; adaptive-memory=degraded; reason=supermemory-provider-api-failed.");
  });

  test("Supermemory runtime readiness renders identity missing exactly", async () => {
    mockInstalledOpenCodeRuntime();
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    const result = await runDoctorDiagnostics(dependencies, undefined);

    expect(supermemoryReadinessLine(result)).toBe("Session topology: deck-managed; static=ready; managed=blocked; adaptive-memory=blocked; reason=managed-runtime-project-missing.");
  });

  test("Supermemory runtime readiness renders invalid static integration exactly", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    const result = await runDoctorDiagnostics(dependencies, gitProjectRoot());

    expect(supermemoryReadinessLine(result)).toBe("Session topology: deck-managed; static=blocked; managed=blocked; adaptive-memory=blocked; reason=static-integration-blocked.");
  });

  test("Supermemory runtime readiness renders adaptive memory disabled and standalone degradation exactly", async () => {
    mockInstalledOpenCodeRuntime();
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: false } });
    const result = await runDoctorDiagnostics(dependencies, gitProjectRoot());
    const messages = result.memory.find((item) => item.category === "Supermemory Runtime")?.items.map((item) => item.message) ?? [];

    expect(messages[0]).toBe("Session topology: deck-managed; static=ready; managed=ready; adaptive-memory=disabled; reason=adaptive-memory-disabled.");
    expect(messages).toContain("Session topology: runner-standalone; static=ready; managed=degraded; adaptive-memory=degraded; reason=runner-standalone-static-compatible. Standalone automatic Adaptive Memory is not provided by design and does not make Doctor fail.");
  });

  test("Supermemory runtime ready without raw OpenCode MCP does not report MCP remediation or disabled project memory", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabOpenCodeStatus()]);
    mockInspectOpenCodeEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      packageManifest: { name: "opencode" },
      existingConfiguration: true,
    });
    mockReviewOpenCodeTools.mockReturnValue({ installedPackages: [], tools: [], toolStatuses: [] });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue({ ...fabOkMcpResult(), projectScope: "sm_project_v1_kevin15011_deck" });
    mockValidateSupermemoryOpenCodeMcpConfig.mockReturnValue({
      ok: true,
      path: "/fake/opencode.json",
      serverName: "supermemory",
      diagnostics: ["Raw Supermemory MCP is absent; Deck Runtime owns Adaptive Memory."],
    });
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: true } });
    dependencies.readSupermemorySecret.mockReturnValue("sk-test-doctor-secret-value");
    dependencies.checkSupermemoryApi.mockResolvedValue({ operations: ["health", "profile", "search"] } as never);
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      "codebase-memory-mcp": { type: "local", command: ["codebase-memory-mcp"] },
      serena: { type: "local", command: ["serena"] },
    });
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-doctor-runtime-no-raw-mcp-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });

    const result = await runDoctorDiagnostics(dependencies, projectRoot);
    const text = JSON.stringify(result);

    expect(result.memory.find((item) => item.category === "Supermemory Runtime")?.status).toBe("ok");
    expect(text).toContain("Raw Supermemory MCP is absent");
    expect(text).not.toContain("Configure Supermemory");
    expect(text).not.toContain("not injected");
    expect(text).not.toContain("project memory operations remain disabled");
    expect(text).not.toContain("project memory operations are not authorized for that runner");
    expect(result.mcp.find((item) => item.category === "Supermemory Project Scope")?.status).not.toBe("error");
  });

  test("disabled Adaptive Memory remains disabled without raw Supermemory MCP guidance", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabOpenCodeStatus()]);
    mockInspectOpenCodeEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      packageManifest: { name: "opencode" },
      existingConfiguration: true,
    });
    mockReviewOpenCodeTools.mockReturnValue({ installedPackages: [], tools: [], toolStatuses: [] });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    mockValidateSupermemoryOpenCodeMcpConfig.mockReturnValue({
      ok: true,
      path: "/fake/opencode.json",
      serverName: "supermemory",
      diagnostics: ["Raw Supermemory MCP is absent; Deck Runtime owns Adaptive Memory."],
    });
    const dependencies = fabDependencies();
    dependencies.configStore.write({ adaptiveMemory: { enabled: false } });
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      "codebase-memory-mcp": { type: "local", command: ["codebase-memory-mcp"] },
      serena: { type: "local", command: ["serena"] },
    });

    const result = await runDoctorDiagnostics(dependencies, mkdtempSync(join(tmpdir(), "deck-doctor-disabled-memory-")));
    const text = JSON.stringify(result);

    expect(text).toContain("Adaptive Memory runtime is disabled");
    expect(text).not.toContain("Configure Supermemory");
    expect(text).not.toContain("Supermemory tools were not injected");
    expect(dependencies.checkSupermemoryApi).not.toHaveBeenCalled();
  });

  test("Doctor reports present stale Deck-managed raw OpenCode Supermemory MCP as retireable", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    mockValidateSupermemoryOpenCodeMcpConfig.mockReturnValueOnce({
      ok: false,
      path: "/fake/opencode.json",
      serverName: "supermemory",
      projectScope: "sm_project_v1_old_project",
      diagnostics: ["OpenCode MCP server 'supermemory' is a stale Deck-managed raw Supermemory MCP entry; retire it because Deck Runtime owns Adaptive Memory project isolation."],
    });
    const dependencies = fabDependencies();
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      supermemory: { type: "remote", url: "https://mcp.supermemory.ai/mcp", enabled: true, headers: { "x-sm-project": "sm_project_v1_old_project" } },
    });

    const result = await runDoctorDiagnostics(dependencies);
    const opencodeMcp = result.mcp.find((item) => item.category === "OpenCode MCP")!;
    const text = JSON.stringify(opencodeMcp);

    expect(opencodeMcp.status).toBe("warning");
    expect(text).toContain("stale Deck-managed raw Supermemory MCP");
    expect(text).toContain("retire");
    expect(text).not.toContain("Configure Supermemory");
  });

  test("Doctor reports unmanaged raw OpenCode Supermemory MCP as external-unobservable", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    mockValidateSupermemoryOpenCodeMcpConfig.mockReturnValueOnce({
      ok: false,
      path: "/fake/opencode.json",
      serverName: "supermemory",
      diagnostics: ["OpenCode MCP server 'supermemory' is an unmanaged raw Supermemory MCP entry and external-unobservable; Deck Runtime did not authorize it as project memory."],
    });
    const dependencies = fabDependencies();
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      supermemory: { type: "remote", url: "https://mcp.supermemory.ai/mcp", headers: { "x-sm-project": "sm_project_v1_other_project" }, userNote: "external" },
    });

    const result = await runDoctorDiagnostics(dependencies);
    const opencodeMcp = result.mcp.find((item) => item.category === "OpenCode MCP")!;
    const text = JSON.stringify(opencodeMcp);

    expect(opencodeMcp.status).toBe("warning");
    expect(text).toContain("unmanaged");
    expect(text).toContain("external-unobservable");
    expect(text).toContain("unchanged");
  });

  // ── Pi MCP configured correctly ──────────────────────────────────────────

  test("Pi MCP configured correctly → ok status", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    const piMcp = result.mcp.find((m) => m.category === "Pi MCP");
    expect(piMcp).toBeDefined();
    expect(piMcp!.status).toBe("ok");
  });

  // ── Pi MCP with errors (redacted) ─────────────────────────────────────────

  test("Pi MCP with errors → error status with redacted diagnostics", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue({
      ok: false,
      path: "/fake",
      serverName: "supermemory",
      diagnostics: [
        { message: "Bearer eyJ123.eyJ456.eyJ789 token is invalid", code: "AUTH_ERROR", severity: "error" },
      ],
    });

    const result = await runDoctorDiagnostics(fabDependencies());

    const piMcp = result.mcp.find((m) => m.category === "Pi MCP");
    expect(piMcp).toBeDefined();
    expect(piMcp!.status).toBe("error");

    const allMessages = JSON.stringify(piMcp!.items);
    expect(allMessages).not.toMatch(/eyJ123/);
    expect(allMessages).not.toMatch(/Bearer\s+eyJ/);
  });

  // ── OpenCode MCP section with known servers ───────────────────────────────

  test("OpenCode MCP validates known servers from opencode.json", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockInspectOpenCodeEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      packageManifest: { name: "opencode" },
      existingConfiguration: false,
    });
    mockReviewOpenCodeTools.mockReturnValue({ installedPackages: [], tools: [], toolStatuses: [] });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    const dependencies = fabDependencies();
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      supermemory: { type: "remote", url: "https://example.invalid/supermemory" },
      "codebase-memory-mcp": { command: ["codebase-memory-mcp"] },
      serena: { command: ["serena"] },
    });

    const result = await runDoctorDiagnostics(dependencies);

    expect(dependencies.readOpenCodeMcpSection).toHaveBeenCalledTimes(1);
    const opencodeMcp = result.mcp.find((m) => m.category === "OpenCode MCP");
    expect(opencodeMcp).toMatchObject({ category: "OpenCode MCP", status: "ok" });
  });

  // ── Sub-check exception does not abort other checks (REQ-DIAG-007) ───────

  test("package review exception → memory and MCP checks still run", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([fabPiStatus()]);
    mockInspectPiEnvironment.mockReturnValue({
      version: "1.0.0",
      configDirectory: "/fake",
      existingConfiguration: false,
    });
    mockReviewPiRequiredTools.mockImplementation(() => {
      throw new Error("SIMULATED_PACKAGE_CHECK_FAILURE");
    });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    // Pi runtime check should still be present
    const pi = result.runtimes.find((r) => r.runtimeId === "pi");
    expect(pi).toBeDefined();

    // Memory checks should still be present
    expect(result.memory.length).toBeGreaterThanOrEqual(1);

    // MCP checks should still be present
    expect(result.mcp.length).toBeGreaterThanOrEqual(2);
  });

  test("runtime detection exception → function does not throw, returns partial result", async () => {
    mockDetectSelectedRuntimes.mockImplementation(() => {
      throw new Error("SIMULATED_RUNTIME_DETECTION_FAILURE");
    });
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    expect(result).toBeDefined();
    expect(result.runtimes).toHaveLength(0);
    expect(result.hasCriticalErrors).toBe(true);
  });

  // ── Result is structured object (REQ-DIAG-008) ───────────────────────────

  test("returns a structured DoctorDiagnosticsResult object", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics(fabDependencies());

    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(String);
    expect("runtimes" in result).toBe(true);
    expect("memory" in result).toBe(true);
    expect("mcp" in result).toBe(true);
    expect("hasCriticalErrors" in result).toBe(true);
  });

  // ── No credentials exposed (REQ-DIAG-009) ─────────────────────────────────

  test("result contains no Bearer tokens or API keys", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue({
      ok: false,
      path: "/fake",
      serverName: "supermemory",
      diagnostics: [
        {
          message:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozqNqJ9 credential error",
          code: "CRED_ERR",
          severity: "error",
        },
      ],
    });

    const result = await runDoctorDiagnostics(fabDependencies());

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/Bearer\s+eyJ/i);
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});


describe("runDoctorDiagnostics dependency seam", () => {
  test("uses the deterministic diagnostic dependency seams", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());
    const dependencies = fabDependencies();
    dependencies.memoryBinaryAvailable.mockImplementation((command) => command !== "supermemory");
    dependencies.readOpenCodeMcpSection.mockReturnValue({
      supermemory: { type: "remote", url: "https://example.invalid/supermemory" },
      "codebase-memory-mcp": { command: ["codebase-memory-mcp"] },
      serena: { command: ["serena"] },
    });

    const result = await runDoctorDiagnostics(dependencies);

    expect(Object.keys(dependencies).sort()).toEqual([
      "checkSupermemoryApi",
      "checkSupermemoryObservabilitySink",
      "configStore",
      "detectSelectedRuntimes",
      "fetchReleaseDescriptor",
      "inspectCodex",
      "inspectOpenCodeEnvironment",
      "inspectPiEnvironment",
      "memoryBinaryAvailable",
      "readOpenCodeMcpSection",
      "readSupermemorySecret",
      "reviewOpenCodeTools",
      "reviewPiRequiredTools",
      "runDeckChecks",
      "validateSupermemoryOpenCodeMcpConfig",
      "validateSupermemoryPiMcpConfig",
    ]);
    expect(dependencies.runDeckChecks).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchReleaseDescriptor).toHaveBeenCalledTimes(1);
    expect(dependencies.memoryBinaryAvailable.mock.calls.map(([command]) => command)).toEqual([
      "serena",
    ]);
    expect(dependencies.readOpenCodeMcpSection).toHaveBeenCalledTimes(1);
    expect(result.binary?.reason).toBe("Release descriptor not found");
    expect(result.memory.find((item) => item.category === "Supermemory Runtime")?.status).toBe("warning");
    expect(result.mcp.find((item) => item.category === "OpenCode MCP")?.status).toBe("ok");
  });
});
