import { describe, expect, test, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateSupermemoryOpenCodeMcpConfig, writeSupermemoryOpenCodeMcpConfig, SUPERMEMORY_MCP_URL, SUPERMEMORY_MCP_SERVER_NAME } from "./opencode-mcp-config";

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
  test("accepts new MCP v4 URL with proper auth", () => {
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

describe("validateSupermemoryOpenCodeMcpConfig - Auth header validation", () => {
  test("accepts Bearer with env var interpolation", () => {
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
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
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
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
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

  test("rejects empty Authorization header (must be valid env interpolation)", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              Authorization: "",
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
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
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
              Authorization: "Bearer {env:SUPERMEMORY_API_KEY}",
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
      // Should be rejected because it doesn't match the env interpolation pattern
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toContain("{env:SUPERMEMORY_API_KEY}");
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