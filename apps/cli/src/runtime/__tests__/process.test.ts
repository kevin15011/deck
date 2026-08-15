/**
 * Unit tests for runtime/process.ts
 *
 * Tests actual child_process behavior without mocking.
 */

import { describe, it, expect } from "bun:test";

describe("runtime/process.ts", () => {
  describe("spawnAsync", () => {
    it("captures stdout and returns exitCode 0 for successful command", async () => {
      const { spawnAsync } = await import("../process");

      const result = await spawnAsync("echo", ["hello"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.stderr).toBe("");
    });

    it("captures stderr separately", async () => {
      const { spawnAsync } = await import("../process");

      // Write to stderr
      const result = await spawnAsync("node", ["-e", "console.error('err-output')"]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("err-output");
    });

    it("returns non-zero exitCode for failing command", async () => {
      const { spawnAsync } = await import("../process");

      const result = await spawnAsync("node", ["-e", "process.exit(1)"]);

      expect(result.exitCode).toBe(1);
    });

    it("accepts cwd option", async () => {
      const { spawnAsync } = await import("../process");

      const result = await spawnAsync("pwd", [], { cwd: "/tmp" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("/tmp");
    });

    it("accepts env option to pass environment variables", async () => {
      const { spawnAsync } = await import("../process");

      const result = await spawnAsync("node", ["-e", "console.log(process.env.TEST_VAR)"], {
        env: { ...process.env, TEST_VAR: "test-value" },
      });

      expect(result.stdout.trim()).toBe("test-value");
    });

    it("removes provider credentials from child env while preserving loopback token", async () => {
      const { spawnAsync } = await import("../process");
      const script = "console.log(JSON.stringify({sm:process.env.SUPERMEMORY_API_KEY,db:process.env.DATABASE_URL,uri:process.env.DATABASE_URI,dsn:process.env.SQLITE_DSN,loop:process.env.DECK_RUNNER_MEMORY_TOKEN}))";
      const result = await spawnAsync("node", ["-e", script], {
        env: { PATH: process.env.PATH ?? "/bin", SUPERMEMORY_API_KEY: "sm_test_secret", DATABASE_URL: "postgres://user:pass@host/db", DATABASE_URI: "postgres://user:pass@host/db", SQLITE_DSN: "file:///home/dev/private/customer.sqlite", DECK_RUNNER_MEMORY_TOKEN: "loopback-token" },
      });
      expect(JSON.parse(result.stdout)).toEqual({ loop: "loopback-token" });
    });
  });

  describe("spawnInherited", () => {
    it("returns a ChildProcess instance", async () => {
      const { spawnInherited } = await import("../process");

      const child = spawnInherited("echo", ["test"]);

      expect(child).toBeDefined();
      expect(typeof child.on).toBe("function");
      expect(typeof child.kill).toBe("function");
    });
  });

  describe("spawnSync", () => {
    it("returns synchronous result with exitCode, stdout, stderr", async () => {
      const { spawnSync } = await import("../process");

      const result = spawnSync("echo", ["sync-test"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("sync-test");
      expect(result.stderr).toBe("");
    });

    it("returns non-zero exitCode for failing command", async () => {
      const { spawnSync } = await import("../process");

      const result = spawnSync("node", ["-e", "process.exit(42)"]);

      expect(result.exitCode).toBe(42);
    });

    it("accepts cwd option", async () => {
      const { spawnSync } = await import("../process");

      const result = spawnSync("pwd", [], { cwd: "/usr" });

      expect(result.stdout.trim()).toBe("/usr");
    });

    it("handles non-existent command gracefully", async () => {
      const { spawnSync } = await import("../process");

      const result = spawnSync("nonexistent-command-xyz", []);

      expect(result.exitCode).toBe(1);
      // Error message contains path info - check for either format
      expect(result.stderr.includes("nonexistent-command-xyz") || result.stderr.includes("ENOENT")).toBe(true);
    });
  });
});
