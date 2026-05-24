import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateSupermemoryOpenCodeMcpConfig } from "./opencode-mcp-config";

function createTempDir(): string {
  const dir = join(tmpdir(), `deck-mcp-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("validateSupermemoryOpenCodeMcpConfig", () => {
  test("valid config with Supermemory entry returns ok: true and no diagnostics", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            oauth: false,
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics.length).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test("missing opencode.json returns ok: false with missing config diagnostic", () => {
    const dir = createTempDir();
    try {
      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath: join(dir, "opencode.json"),
        homeDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0]).toContain("missing");
    } finally {
      cleanup(dir);
    }
  });

  test("malformed JSON returns ok: false with parse error diagnostic", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, "{ not valid json", "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0]).toContain("malformed");
    } finally {
      cleanup(dir);
    }
  });

  test("no mcp.supermemory entry returns ok: false with missing server diagnostic", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          other: {
            type: "remote",
            url: "https://other.example.com",
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0]).toContain("missing server entry");
    } finally {
      cleanup(dir);
    }
  });

  test("empty Authorization header returns ok: false with invalid credentials diagnostic", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: {
              Authorization: "",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0]).toContain("Authorization");
    } finally {
      cleanup(dir);
    }
  });

  test("custom serverName parameter validates against provided name", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          mycustom: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            oauth: false,
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        serverName: "mycustom",
        homeDir: dir,
      });

      expect(result.ok).toBe(true);
      expect(result.diagnostics.length).toBe(0);
      expect(result.serverName).toBe("mycustom");
    } finally {
      cleanup(dir);
    }
  });

  test("no raw token appears in any diagnostic output", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            oauth: false,
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
      });

      // Ensure no raw token values leak into diagnostics
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic).not.toContain("sk-");
        expect(diagnostic).not.toContain("SUPERMEMORY_API_KEY");
        expect(diagnostic).not.toMatch(/Bearer\s+[A-Za-z0-9+/=]{20,}/);
      }
    } finally {
      cleanup(dir);
    }
  });
});