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

function fabOkMcpResult() {
  return {
    ok: true,
    path: "/fake",
    serverName: "supermemory",
    diagnostics: [],
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

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

    const claude = result.runtimes.find((r) => r.runtimeId === "claude");
    expect(claude).toBeDefined();
    expect(claude!.installed).toBe(true);
    expect(claude!.checks).toHaveLength(1);
    expect(claude!.checks[0].category).toBe("Runtime");
    expect(claude!.checks[0].items[0].status).toBe("ok");
    expect(claude!.checks[0].items[0].message).toContain("Claude detected");
  });

  // ── Engram available ─────────────────────────────────────────────────────

  test("Engram binary in PATH → Engram shows ok", async () => {
    const originalPath = process.env.PATH;
    const { writeFileSync, unlinkSync, existsSync } = await import("node:fs");
    const pathModule = await import("node:path");

    try {
      // Create a fake engram binary in /tmp so the existsSync check passes
      const fakeEngramPath = pathModule.join("/tmp", "engram");
      writeFileSync(fakeEngramPath, "#!/bin/sh", { mode: 0o755 });

      process.env.PATH = "/tmp:/usr/bin:/bin";

      const result = await runDoctorDiagnostics();

      const engramCategory = result.memory.find((m) => m.category === "Engram");
      expect(engramCategory).toBeDefined();
      expect(engramCategory!.status).toBe("ok");
    } finally {
      process.env.PATH = originalPath;
      // Clean up temp file
      try {
        unlinkSync("/tmp/engram");
      } catch {
        // ignore
      }
    }
  });

  // ── Supermemory without binary ───────────────────────────────────────────

  test("Supermemory binary absent → warning without credential exposure", async () => {
    const originalPath = process.env.PATH;

    try {
      process.env.PATH = "/nonexistent";

      const result = await runDoctorDiagnostics();

      const smCategory = result.memory.find((m) => m.category === "Supermemory");
      expect(smCategory).toBeDefined();
      expect(smCategory!.status).toBe("warning");

      const allMessages = smCategory!.items.map((i) => i.message).join(" ");
      expect(allMessages).not.toMatch(/Bearer\s+/i);
      expect(allMessages).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  // ── Pi MCP configured correctly ──────────────────────────────────────────

  test("Pi MCP configured correctly → ok status", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

    const opencodeMcp = result.mcp.find((m) => m.category === "OpenCode MCP");
    expect(opencodeMcp).toBeDefined();
    expect(opencodeMcp!.category).toBe("OpenCode MCP");
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

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

    expect(result).toBeDefined();
    expect(result.runtimes).toHaveLength(0);
    expect(result.hasCriticalErrors).toBe(true);
  });

  // ── Result is structured object (REQ-DIAG-008) ───────────────────────────

  test("returns a structured DoctorDiagnosticsResult object", async () => {
    mockDetectSelectedRuntimes.mockReturnValue([]);
    mockValidateSupermemoryPiMcpConfig.mockReturnValue(fabOkMcpResult());

    const result = await runDoctorDiagnostics();

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

    const result = await runDoctorDiagnostics();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/Bearer\s+eyJ/i);
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});