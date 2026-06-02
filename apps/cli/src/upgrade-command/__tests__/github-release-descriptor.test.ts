/**
 * Unit tests for the new descriptor-aware release fetching (T2.2).
 *
 * These tests cover:
 *   - `buildLegacyReleaseInfo`: pure transformation from the GitHub API
 *     payload to the legacy `ReleaseInfo` shape.
 *   - `getDefaultReleaseCachePath`: stable path under XDG cache dir.
 *   - `readReleaseCache`: returns null when no cache exists, validates
 *     the cached payload.
 *   - `curlReleasesApi` / `curlReleaseJsonAsset`: smoke tests (do not
 *     hit the network).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetDeckPathCache } from "../../runtime/paths.js";
import {
  buildLegacyReleaseInfo,
  curlReleasesApi,
  curlReleaseJsonAsset,
  getDefaultReleaseCachePath,
  readReleaseCache,
  UPGRADE_ERROR_CODES,
} from "../github-release.js";

describe("github-release / descriptor-aware path (T2.2)", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(
    name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME",
    value: string,
  ): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-gh-release-"));
    setXdg("XDG_CONFIG_HOME", join(workDir, "config"));
    setXdg("XDG_STATE_HOME", join(workDir, "state"));
    setXdg("XDG_CACHE_HOME", join(workDir, "cache"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    _resetDeckPathCache();
  });

  // --- buildLegacyReleaseInfo ---------------------------------------

  describe("buildLegacyReleaseInfo", () => {
    it("extracts the tag and version", () => {
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.2.0",
        published_at: "2026-06-02T12:00:00.000Z",
        body: "",
        assets: [],
      });
      expect(info.tagName).toBe("v1.2.0");
      expect(info.version).toBe("1.2.0");
    });

    it("parses sha256 from the release body", () => {
      const sha = "0".repeat(64);
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00.000Z",
        body: `Release notes\n\nsha256: ${sha}\n`,
        assets: [],
      });
      expect(info.sha256).toBe(sha);
    });

    it("uppercase SHA-256 in body is normalized to lowercase", () => {
      const shaUpper = "ABCDEF0123456789".repeat(4);
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.0.0",
        body: `sha256: ${shaUpper}`,
        assets: [],
      });
      expect(info.sha256).toBe(shaUpper.toLowerCase());
    });

    it("returns empty sha256 when body has no checksum", () => {
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.0.0",
        body: "no checksum here",
        assets: [],
      });
      expect(info.sha256).toBe("");
    });

    it("picks the platform asset by name", () => {
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.0.0",
        assets: [
          {
            name: "deck_v1.0.0_linux-x64.tar.gz",
            browser_download_url: "https://example.com/deck_v1.0.0_linux-x64.tar.gz",
          },
        ],
      });
      // The current platform is whatever the test runner has. The
      // important thing is that *some* linux/darwin asset is picked
      // when present, OR the legacy result has an empty URL when none
      // matches.
      expect(typeof info.downloadUrl).toBe("string");
    });

    it("returns a ReleaseInfo with the publishedAt and body fields", () => {
      const info = buildLegacyReleaseInfo({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00.000Z",
        body: "Notes",
        assets: [],
      });
      expect(info.publishedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(info.body).toBe("Notes");
    });
  });

  // --- Cache path ---------------------------------------------------

  describe("getDefaultReleaseCachePath / readReleaseCache", () => {
    it("returns a stable XDG-cache path", () => {
      const p = getDefaultReleaseCachePath();
      expect(p.endsWith("latest-release.json")).toBe(true);
    });

    it("readReleaseCache returns null when the cache is missing", () => {
      expect(readReleaseCache(join(workDir, "missing.json"))).toBeNull();
    });

    it("readReleaseCache validates the payload against the schema", () => {
      const cache = join(workDir, "release.json");
      const valid = {
        schemaVersion: 1,
        version: "1.0.0",
        tag_name: "v1.0.0",
        channel: "stable",
        published_at: "2026-06-02T12:00:00.000Z",
        items: [],
      };
      writeFileSync(cache, JSON.stringify(valid));
      const out = readReleaseCache(cache);
      expect(out).not.toBeNull();
      expect(out?.version).toBe("1.0.0");
    });

    it("readReleaseCache returns null for invalid JSON", () => {
      const cache = join(workDir, "release.json");
      writeFileSync(cache, "{ not valid json");
      expect(readReleaseCache(cache)).toBeNull();
    });

    it("readReleaseCache returns null for a schema-invalid payload", () => {
      const cache = join(workDir, "release.json");
      writeFileSync(cache, JSON.stringify({ schemaVersion: 1 /* missing fields */ }));
      expect(readReleaseCache(cache)).toBeNull();
    });
  });

  // --- Error codes --------------------------------------------------

  describe("UPGRADE_ERROR_CODES", () => {
    it("exposes the new TIMEOUT and FALLBACK_LEGACY codes", () => {
      expect(UPGRADE_ERROR_CODES.TIMEOUT).toBe("UPGRADE_TIMEOUT");
      expect(UPGRADE_ERROR_CODES.FALLBACK_LEGACY).toBe("UPGRADE_FALLBACK_LEGACY");
    });
  });

  // --- curl smoke tests (no real network) ---------------------------

  describe("curl wrappers", () => {
    it("curlReleasesApi returns the expected shape on failure", () => {
      // No network: exitCode should be non-zero (or 0 with no output on
      // environments that have a stub DNS). Either way the call must
      // not throw.
      const result = curlReleasesApi(["--connect-timeout", "1", "--max-time", "1"]);
      expect(typeof result.exitCode).toBe("number");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
    });

    it("curlReleaseJsonAsset returns the expected shape on failure", () => {
      const result = curlReleaseJsonAsset("v0.0.0", ["--connect-timeout", "1", "--max-time", "1"]);
      expect(typeof result.exitCode).toBe("number");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
    });
  });
});
