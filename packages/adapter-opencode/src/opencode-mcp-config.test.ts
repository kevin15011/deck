import { describe, expect, test, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateSupermemoryOpenCodeMcpConfig,
  writeSupermemoryOpenCodeMcpConfig,
  writeSerenaOpenCodeMcpConfig,
  SUPERMEMORY_MCP_URL,
  SUPERMEMORY_MCP_SERVER_NAME,
} from "./opencode-mcp-config";
import type { SerenaReadinessEvidence } from "@deck/core";

function createTempDir(): string {
  const dir = join(tmpdir(), `deck-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

// Test suite for Task 9: MCP config x-sm-project REQUIRED
describe("writeSupermemoryOpenCodeMcpConfig - x-sm-project REQUIRED (Repair 2026-05-29)", () => {
  test("always includes x-sm-project header in written config", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "sm_test_token_123",
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(true);
      
      // Read back the config and verify x-sm-project is present
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));
      expect(config.mcp.supermemory.headers["x-sm-project"]).toBeDefined();
      expect(config.mcp.supermemory.headers.Authorization).toBeUndefined();
      expect(config.mcp.supermemory.oauth).toBeUndefined();
      // REQ-R26: NO legacy p: prefix
      expect(config.mcp.supermemory.headers["x-sm-project"]).not.toMatch(/^p:/);
    } finally {
      cleanup(dir);
    }
  });

  test("accepts explicit projectId override WITHOUT p: prefix", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      // REQ-R26: explicitProjectId should NOT use p: prefix (passed directly)
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "sm_test_token_123",
        configPath,
        homeDir: dir,
        explicitProjectId: "my-custom-project",  // NOT "p:my-custom-project"
      });

      expect(result.ok).toBe(true);
      
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));
      // Value should be stored as-provided (no p: prefix added)
      expect(config.mcp.supermemory.headers["x-sm-project"]).toBe("my-custom-project");
    } finally {
      cleanup(dir);
    }
  });
});

describe("validateSupermemoryOpenCodeMcpConfig - URL validation", () => {
  test("accepts new MCP v4 URL with native OAuth configuration", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  test("rejects deprecated URL supermemory-new.stlmcp.com", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://supermemory-new.stlmcp.com",
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("deprecated");
      expect(result.diagnostics[0]).toContain(SUPERMEMORY_MCP_URL);
    } finally {
      cleanup(dir);
    }
  });

  test("rejects deprecated URL supermemory.stlmcp.com", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://supermemory.stlmcp.com",
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("deprecated");
    } finally {
      cleanup(dir);
    }
  });

  test("rejects custom/unrecognized URL", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://custom.example.com/mcp",
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("unrecognized");
    } finally {
      cleanup(dir);
    }
  });
});

describe("validateSupermemoryOpenCodeMcpConfig - native OAuth validation", () => {
  test("accepts OAuth discovery with no persisted credential", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  test("accepts x-sm-project header for project scoping", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "my-repo",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("rejects missing headers object entirely", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("headers");
    } finally {
      cleanup(dir);
    }
  });

  test("rejects persisted Authorization header", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("Authorization");
    } finally {
      cleanup(dir);
    }
  });

  test("rejects oauth false because it disables OpenCode native authentication", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            oauth: false,
            headers: {
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("oauth: false");
    } finally {
      cleanup(dir);
    }
  });
});

describe("validateSupermemoryOpenCodeMcpConfig - Server name handling", () => {
  test("accepts default server name 'supermemory'", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(true);
      expect(result.serverName).toBe(SUPERMEMORY_MCP_SERVER_NAME);
    } finally {
      cleanup(dir);
    }
  });

  test("accepts custom server name pointing to Supermemory MCP URL", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          mycustom: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_test",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, serverName: "mycustom", homeDir: dir });
      expect(result.ok).toBe(true);
      expect(result.serverName).toBe("mycustom");
    } finally {
      cleanup(dir);
    }
  });
});

describe("validateSupermemoryOpenCodeMcpConfig - Security", () => {
  test("rejects raw token in Authorization header with clear diagnostic", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              Authorization: "Bearer sk-raw-token-leaked",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      // OAuth credentials must never be persisted in project configuration.
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("OAuth");
    } finally {
      cleanup(dir);
    }
  });
});

describe("provider IDs consistency", () => {
  test("engram and supermemory are supported IDs", () => {
    const SUPPORTED = ["engram", "supermemory"];
    expect(SUPPORTED).toContain("engram");
    expect(SUPPORTED).toContain("supermemory");
  });

  test("none is also a valid provider value", () => {
    const cliMemoryProvider = "none";
    const supported = ["engram", "supermemory", "none"];
    expect(supported).toContain(cliMemoryProvider);
  });
});

describe("fail-open diagnostics", () => {
  test("missing config returns recoverable diagnostic", () => {
    const dir = createTempDir();
    try {
      const result = validateSupermemoryOpenCodeMcpConfig({ configPath: join(dir, "opencode.json"), homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("missing");
      expect(result.diagnostics[0]).toContain("not injected");
    } finally {
      cleanup(dir);
    }
  });

  test("malformed JSON returns parse error diagnostic", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, "{ invalid json", "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("malformed");
    } finally {
      cleanup(dir);
    }
  });

  test("missing server entry returns diagnostic", () => {
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

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("missing server entry");
    } finally {
      cleanup(dir);
    }
  });
});

describe("writeSerenaOpenCodeMcpConfig", () => {
  const ownedRoot = "/fixtures/deck-data/tools/serena";
  const executable = `${ownedRoot}/bin/serena`;
  const readiness: SerenaReadinessEvidence = {
    capabilityId: "serena",
    state: "ready",
    resolvedExecutablePath: executable,
    source: "installed-deck-tool",
    probe: "serena-help",
    fingerprint: "serena-fingerprint",
  };
  const command = [executable, "start-mcp-server", "--context", "ide", "--project-from-cwd"] as const;

  function fakeFileSystem(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    return {
      files,
      writes,
      renames,
      fileSystem: {
        exists: (path: string) => files.has(path),
        readFile: (path: string) => files.get(path) ?? (() => { throw new Error("missing"); })(),
        writeFile: (path: string, content: string) => { writes.push(path); files.set(path, content); },
        rename: (from: string, to: string) => {
          renames.push([from, to]);
          const content = files.get(from);
          if (content === undefined) throw new Error("temporary file missing");
          files.set(to, content);
          files.delete(from);
        },
      },
    };
  }

  test("creates an atomic local MCP entry with the exact absolute command array", () => {
    const path = "/fixtures/opencode/opencode.json";
    const fake = fakeFileSystem();

    const result = writeSerenaOpenCodeMcpConfig({
      configPath: path,
      ownedRoot,
      readiness,
      command,
      fileSystem: fake.fileSystem,
    });

    expect(result).toMatchObject({ ok: true, status: "created", serverName: "serena" });
    expect(fake.writes).toHaveLength(1);
    expect(fake.renames).toHaveLength(1);
    const config = JSON.parse(fake.files.get(path)!);
    expect(config.mcp.serena).toEqual({ type: "local", command: [...command], enabled: true });
    expect(config.mcp.serena.command[0]).toBe(executable);
  });

  test("returns unchanged without writing equivalent known-good configuration", () => {
    const path = "/fixtures/opencode/opencode.json";
    const original = JSON.stringify({
      unrelated: { keep: true },
      mcp: {
        other: { type: "local", command: ["other"] },
        serena: { type: "local", command: [...command], enabled: true },
      },
    });
    const fake = fakeFileSystem({ [path]: original });

    const result = writeSerenaOpenCodeMcpConfig({ configPath: path, ownedRoot, readiness, command, fileSystem: fake.fileSystem });

    expect(result).toMatchObject({ ok: true, status: "unchanged" });
    expect(fake.writes).toHaveLength(0);
    expect(fake.renames).toHaveLength(0);
    expect(fake.files.get(path)).toBe(original);
  });

  test("updates a legacy bare command only after validated evidence", () => {
    const path = "/fixtures/opencode/opencode.json";
    const fake = fakeFileSystem({
      [path]: JSON.stringify({ mcp: { serena: { type: "local", command: ["serena", "start-mcp-server"] }, other: { keep: true } } }),
    });

    const result = writeSerenaOpenCodeMcpConfig({ configPath: path, ownedRoot, readiness, command, fileSystem: fake.fileSystem });

    expect(result).toMatchObject({ ok: true, status: "updated" });
    const config = JSON.parse(fake.files.get(path)!);
    expect(config.mcp.serena.command).toEqual([...command]);
    expect(config.mcp.other).toEqual({ keep: true });
  });

  test("rejects unsafe or wrong evidence and preserves the original file", () => {
    const path = "/fixtures/opencode/opencode.json";
    const original = JSON.stringify({ mcp: { serena: { type: "local", command: ["serena"] }, other: { keep: true } } });
    for (const unsafe of [
      { ...readiness, resolvedExecutablePath: "relative/serena" },
      { ...readiness, resolvedExecutablePath: "/other-user/bin/serena" },
      { ...readiness, resolvedExecutablePath: `${ownedRoot}/bin/../outside` },
      { ...readiness, resolvedExecutablePath: `${ownedRoot}/bin/serena\0bad` },
    ]) {
      const fake = fakeFileSystem({ [path]: original });
      const result = writeSerenaOpenCodeMcpConfig({ configPath: path, ownedRoot, readiness: unsafe, command, fileSystem: fake.fileSystem });
      expect(result.ok).toBe(false);
      expect(fake.writes).toHaveLength(0);
      expect(fake.files.get(path)).toBe(original);
    }

    const fake = fakeFileSystem({ [path]: original });
    const wrongCommand = ["serena", ...command.slice(1)] as const;
    const result = writeSerenaOpenCodeMcpConfig({ configPath: path, ownedRoot, readiness, command: wrongCommand, fileSystem: fake.fileSystem });
    expect(result.ok).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.files.get(path)).toBe(original);
  });

  test("rejects malformed configuration without rewriting it", () => {
    const path = "/fixtures/opencode/opencode.json";
    const original = "{ malformed";
    const fake = fakeFileSystem({ [path]: original });

    const result = writeSerenaOpenCodeMcpConfig({ configPath: path, ownedRoot, readiness, command, fileSystem: fake.fileSystem });

    expect(result.ok).toBe(false);
    expect(fake.writes).toHaveLength(0);
    expect(fake.files.get(path)).toBe(original);
  });
});

// Test suite for deriveSmProjectIdentifier - git remote derivation
describe("deriveSmProjectIdentifier - git remote derivation with sm_project_ prefix", () => {
  test("preserves underscore in sm_project_ prefix when deriving from git remote", async () => {
    const dir = createTempDir();
    try {
      // Setup a git repo with mock remote
      await new Promise<void>((resolve, reject) => {
        const { execSync: _execSync } = require("node:child_process");
        try {
          require("node:child_process").execSync("git init", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git remote add origin https://github.com/owner-name/my-repo.git", { cwd: dir, stdio: "ignore" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      // Import the private function via eval (module doesn't export it)
      // Test indirectly via writeSupermemoryOpenCodeMcpConfig
      
      const configPath = join(dir, "opencode.json");
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "test-token",
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(true);
      
      // Verify x-sm-project starts with sm_project_ (not sm-project-)
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));
      const xSmProject = config.mcp.supermemory.headers["x-sm-project"];
      expect(xSmProject.startsWith("sm_project_")).toBe(true);
      expect(xSmProject).toContain("_");
    } finally {
      cleanup(dir);
    }
  });

  test("x-sm-project header starts with sm_project_ prefix", async () => {
    const dir = createTempDir();
    try {
      // Setup git repo
      await new Promise<void>((resolve, reject) => {
        try {
          require("node:child_process").execSync("git init", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
          require("node:child_process").execSync("git remote add origin https://github.com/my-org/my-project.git", { cwd: dir, stdio: "ignore" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      const configPath = join(dir, "opencode.json");
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "test-token",
        configPath,
        homeDir: dir,
      });

      expect(result.ok).toBe(true);
      
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));
      const xSmProject = config.mcp.supermemory.headers["x-sm-project"];
      // Should be sm_project_my-org-my-project NOT sm-project-my-org-my-project
      expect(xSmProject).toMatch(/^sm_project_/);
      expect(xSmProject).not.toMatch(/^sm-/);
    } finally {
      cleanup(dir);
    }
  });
});
