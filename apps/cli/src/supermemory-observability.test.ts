import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { checkSupermemoryObservabilitySink, createSupermemoryObservabilitySink } from "./supermemory-observability";

describe("Supermemory observability sink", () => {
  test("write failures degrade health and return diagnostics", () => {
    if (process.platform === "win32") return;
    const root = mkdtempSync(join(tmpdir(), "deck-sm-observe-"));
    try {
      const stateHome = join(root, "state");
      const sink = createSupermemoryObservabilitySink({ stateHome });
      expect(sink.healthy).toBe(true);
      writeFileSync(sink.path, "x".repeat(300 * 1024));
      chmodSync(join(stateHome, "deck"), 0o500);
      sink.observe({ provider: "supermemory", operation: "search", status: "succeeded", durationMs: 1, scopeFingerprint: "smfp_test", dependency: "unobservable-external-mcp" });
      expect(sink.healthy).toBe(false);
      expect(sink.health().diagnostics.join(" ")).toContain("Supermemory observability write failed");
    } finally {
      chmodSync(join(root, "state", "deck"), 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Doctor observability check is read-only and does not create sink paths", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-sm-observe-check-"));
    const stateHome = join(root, "missing-state");
    try {
      const checked = checkSupermemoryObservabilitySink({ stateHome });
      expect(checked.ok).toBe(true);
      expect(checked.diagnostics.join(" ")).toContain("Doctor did not create it");
      expect(existsSync(join(stateHome, "deck"))).toBe(false);
      expect(existsSync(checked.path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
