/**
 * Unit tests for installation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("install.ts", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "deck-upgrade-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Cleanup test files
    try {
      const files = ["deck", "deck.backup", "new-deck", "test-file.bin"];
      for (const f of files) {
        const p = join(testDir, f);
        if (existsSync(p)) unlinkSync(p);
      }
      rmdirSync(testDir);
    } catch {}
  });

  describe("InstallError", () => {
    it("creates error with code and message", () => {
      const { InstallError } = require("../install.js");
      
      const error = new InstallError(
        "UPGRADE_CHECKSUM_MISMATCH",
        "Checksum verification failed"
      );

      expect(error.name).toBe("InstallError");
      expect(error.code).toBe("UPGRADE_CHECKSUM_MISMATCH");
      expect(error.message).toBe("Checksum verification failed");
    });
  });

  describe("InstallError codes", () => {
    it("has checksum mismatch code", () => {
      const { InstallError } = require("../install.js");
      
      const error = new InstallError(
        "UPGRADE_CHECKSUM_MISMATCH",
        "test"
      );
      expect(error.code).toBe("UPGRADE_CHECKSUM_MISMATCH");
    });

    it("has network error code", () => {
      const { InstallError } = require("../install.js");
      
      const error = new InstallError(
        "UPGRADE_NETWORK_ERROR",
        "test"
      );
      expect(error.code).toBe("UPGRADE_NETWORK_ERROR");
    });

    it("has replace failed code", () => {
      const { InstallError } = require("../install.js");
      
      const error = new InstallError(
        "UPGRADE_REPLACE_FAILED",
        "test"
      );
      expect(error.code).toBe("UPGRADE_REPLACE_FAILED");
    });
  });

  describe("cancelUpgrade", () => {
    it("restores from backup when exists", () => {
      const { cancelUpgrade } = require("../install.js");
      
      const backupPath = join(testDir, "deck.backup");
      const targetPath = join(testDir, "deck");
      
      writeFileSync(backupPath, "backup content");
      
      cancelUpgrade(backupPath, targetPath);
      
      expect(existsSync(targetPath)).toBe(true);
    });

    it("does nothing when no backup exists", () => {
      const { cancelUpgrade } = require("../install.js");
      
      const backupPath = join(testDir, "nonexistent.backup");
      const targetPath = join(testDir, "deck");
      
      // Should not throw
      expect(() => cancelUpgrade(backupPath, targetPath)).not.toThrow();
    });
  });
});

// REQ-bsu-* requirement tests
describe("REQ-bsu-002: Checksum verification error code", () => {
  it("has checksum mismatch code defined", () => {
    const { InstallError } = require("../install.js");
    const error = new InstallError("UPGRADE_CHECKSUM_MISMATCH", "test");
    expect(error.code).toBe("UPGRADE_CHECKSUM_MISMATCH");
  });
});

describe("REQ-bsu-004: Rollback on failure", () => {
  const { cancelUpgrade } = require("../install.js");
  
  it("can restore from backup", () => {
    const tdir = mkdtempSync(join(tmpdir(), "deck-rollback-"));
    const backupPath = join(tdir, "deck.backup");
    const targetPath = join(tdir, "deck");
    
    writeFileSync(backupPath, "restored content");
    
    cancelUpgrade(backupPath, targetPath);
    
    expect(existsSync(targetPath)).toBe(true);
    unlinkSync(targetPath);
    rmdirSync(tdir);
  });

  it("handles missing backup gracefully", () => {
    const tdir = mkdtempSync(join(tmpdir(), "deck-rollback2-"));
    const backupPath = join(tdir, "missing.backup");
    const targetPath = join(tdir, "deck");
    
    expect(() => cancelUpgrade(backupPath, targetPath)).not.toThrow();
    rmdirSync(tdir);
  });
});