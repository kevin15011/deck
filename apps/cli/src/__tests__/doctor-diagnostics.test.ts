import { describe, expect, test, vi } from "bun:test";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";

// Store mock functions at module scope so each test can configure them.
// This avoids vi.mocked() which is not available in Bun's vitest.
const mockInspectPiEnvironment = vi.fn();
const mockReviewPiRequiredTools = vi.fn();
const mockValidateSupermemoryPiMcpConfig = vi.fn();
const mockInspectOpenCodeEnvironment = vi.fn();
const mockReviewOpenCodeTools = vi.fn();
const mockDetectSelectedRuntimes = vi.fn();

vi.mock("@deck/adapter-pi", () => ({
  inspectPiEnvironment: mockInspectPiEnvironment,
  reviewPiRequiredTools: mockReviewPiRequiredTools,
  validateSupermemoryPiMcpConfig: mockValidateSupermemoryPiMcpConfig,
  redact: vi.fn((v: string) => v.replace(/Bearer\s+[\w.-]+/gi, "Bearer ***").replace(/sk-[\w.-]+/gi, "***")),
  redactDiagnostic: vi.fn((d: unknown) => {
    if (typeof d === "object" && d !== null && "message" in d) {
      const diag = d as { message?: string };
      if (diag.message) {
        diag.message = diag.message.replace(/Bearer\s+[\w.-]+/gi, "Bearer ***").replace(/sk-[\w.-]+/gi, "***");
      }
    }
    return d;
  }),
}));

vi.mock("@deck/adapter-opencode", () => ({
  inspectOpenCodeEnvironment: mockInspectOpenCodeEnvironment,
  reviewOpenCodeTools: mockReviewOpenCodeTools,
}));

vi.mock("../runtime-detection", () => ({
  detectSelectedRuntimes: mockDetectSelectedRuntimes,
}));

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


function fabDependencies() {
  return {
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
    const result = await runDoctorDiagnostics(dependencies);
    const codex = result.runtimes.find((runtime) => runtime.runtimeId === "codex")!;
    expect(codex.checks.map((check) => check.category)).toEqual(["Trust activation", "Managed content", "Execution route: exec", "Rollback and recovery"]);
    expect(JSON.stringify(codex)).not.toContain("secret-value");
  });

  // ── Engram available ─────────────────────────────────────────────────────

  test("Engram normal-path check returns a redacted diagnostic category", async () => {
    const dependencies = fabDependencies();
    dependencies.memoryBinaryAvailable.mockImplementation((command) => command === "engram");

    const result = await runDoctorDiagnostics(dependencies);

    expect(dependencies.memoryBinaryAvailable).toHaveBeenCalledWith("engram");
    const engramCategory = result.memory.find((item) => item.category === "Engram");
    expect(engramCategory).toMatchObject({ status: "ok" });
    expect(JSON.stringify(engramCategory)).not.toMatch(/Bearer\s+eyJ/i);
  });

  // ── Supermemory without binary ───────────────────────────────────────────

  test("Supermemory normal-path check never exposes credentials", async () => {
    const dependencies = fabDependencies();
    dependencies.memoryBinaryAvailable.mockReturnValue(false);

    const result = await runDoctorDiagnostics(dependencies);

    expect(dependencies.memoryBinaryAvailable).toHaveBeenCalledWith("supermemory");
    const supermemoryCategory = result.memory.find((item) => item.category === "Supermemory");
    expect(supermemoryCategory).toMatchObject({ status: "warning" });
    const messages = supermemoryCategory!.items.map((item) => item.message).join(" ");
    expect(messages).not.toMatch(/Bearer\s+/i);
    expect(messages).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
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
    expect(result.memory.length).toBeGreaterThanOrEqual(2);

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
      "fetchReleaseDescriptor",
      "inspectCodex",
      "memoryBinaryAvailable",
      "readOpenCodeMcpSection",
      "runDeckChecks",
    ]);
    expect(dependencies.runDeckChecks).toHaveBeenCalledTimes(1);
    expect(dependencies.fetchReleaseDescriptor).toHaveBeenCalledTimes(1);
    expect(dependencies.memoryBinaryAvailable.mock.calls.map(([command]) => command)).toEqual([
      "engram",
      "supermemory",
      "serena",
    ]);
    expect(dependencies.readOpenCodeMcpSection).toHaveBeenCalledTimes(1);
    expect(result.binary?.reason).toBe("Release descriptor not found");
    expect(result.memory.find((item) => item.category === "Engram")?.status).toBe("ok");
    expect(result.memory.find((item) => item.category === "Supermemory")?.status).toBe("warning");
    expect(result.mcp.find((item) => item.category === "OpenCode MCP")?.status).toBe("ok");
  });
});
