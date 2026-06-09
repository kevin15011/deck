/**
 * Tests for Shared Binary Usability Helper
 */

import { describe, it, expect } from "bun:test";
import {
  checkSharedBinaryUsability,
  type SharedBinaryUsabilityResult,
} from "./shared-binary-usability";

describe("Shared Binary Usability Helper", () => {
  describe("checkSharedBinaryUsability", () => {
    it("should return missing for non-existent command", async () => {
      const result = await checkSharedBinaryUsability("definitely-not-a-real-command-12345");
      expect(result.status).toBe("missing");
      expect(result.command).toBe("definitely-not-a-real-command-12345");
    });

    it("should include command in result", async () => {
      const result = await checkSharedBinaryUsability("nonexistent");
      expect(result.command).toBe("nonexistent");
    });

    it("should have valid status", async () => {
      const result = await checkSharedBinaryUsability("test-cmd");
      expect(["ready", "missing", "unusable", "blocked"]).toContain(result.status);
    });
  });

  describe("SharedBinaryUsabilityResult type validation", () => {
    it("should allow ready status with version", () => {
      const result: SharedBinaryUsabilityResult = {
        status: "ready",
        command: "rtk",
        version: "1.0.0",
      };
      expect(result.status).toBe("ready");
      expect(result.version).toBe("1.0.0");
    });

    it("should allow missing status with reason", () => {
      const result: SharedBinaryUsabilityResult = {
        status: "missing",
        command: "rtk",
        reason: "Command not found in PATH",
      };
      expect(result.status).toBe("missing");
      expect(result.reason).toContain("not found");
    });

    it("should allow unusable status with reason", () => {
      const result: SharedBinaryUsabilityResult = {
        status: "unusable",
        command: "rtk",
        reason: "Command exists but failed healthcheck",
      };
      expect(result.status).toBe("unusable");
      expect(result.reason).toContain("healthcheck");
    });

    it("should allow blocked status", () => {
      const result: SharedBinaryUsabilityResult = {
        status: "blocked",
        command: "rtk",
        reason: "Blocked by configuration",
      };
      expect(result.status).toBe("blocked");
    });
  });
});
