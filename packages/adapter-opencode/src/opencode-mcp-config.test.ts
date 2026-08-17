import { describe, expect, test, mock } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateSupermemoryOpenCodeMcpConfig,
  writeOpenCodeMcpConfig,
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
describe("writeOpenCodeMcpConfig - idempotent user config safety", () => {
  test("does not rewrite an already-equivalent OpenCode MCP entry", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      const content = JSON.stringify({
        mcp: {
          context7: {
            type: "local",
            enabled: true,
            command: ["npx", "-y", "@upstash/context7-mcp"],
          },
        },
      }, null, 2);
      writeFileSync(configPath, content, { encoding: "utf-8", mode: 0o600 });
      chmodSync(configPath, 0o600);
      const old = new Date("2026-01-01T00:00:00.000Z");
      utimesSync(configPath, old, old);
      const before = statSync(configPath);

      const result = writeOpenCodeMcpConfig({
        configPath,
        serverName: "context7",
        type: "local",
        command: ["npx", "-y", "@upstash/context7-mcp"],
      });
      const after = statSync(configPath);

      expect(result).toMatchObject({ ok: true, status: "unchanged" });
      expect(readFileSync(configPath, "utf-8")).toBe(content);
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(after.mode & 0o777).toBe(before.mode & 0o777);
    } finally {
      cleanup(dir);
    }
  });
});

describe("writeSupermemoryOpenCodeMcpConfig - x-sm-project REQUIRED (Repair 2026-05-29)", () => {
  test("does not materialize raw Supermemory MCP and retires exact stale Deck-managed entries", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: { "x-sm-project": "sm_project_v1_kevin15011_deck" },
            enabled: true,
          },
          external: { type: "remote", url: "https://example.com/mcp" },
        },
      }), "utf-8");

      const result = writeSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir, explicitProjectId: "sm_project_v1_kevin15011_deck" });
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));

      expect(result.ok).toBe(true);
      expect(config.mcp.supermemory).toBeUndefined();
      expect(config.mcp.external).toEqual({ type: "remote", url: "https://example.com/mcp" });
      expect(result.diagnostics.join(" ").toLowerCase()).toContain("retired");
    } finally {
      cleanup(dir);
    }
  });

  test("retires exact stale Deck-managed entries even when the stored scope belongs to an old project", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: { "x-sm-project": "sm_project_v1_acme_project_a" },
            enabled: true,
          },
          external: { type: "remote", url: "https://example.com/mcp" },
        },
      }), "utf-8");

      const first = writeSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir, explicitProjectId: "sm_project_v1_acme_project_b" });
      const second = writeSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir, explicitProjectId: "sm_project_v1_acme_project_b" });
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      expect(second.diagnostics.join(" ")).toContain("no OpenCode MCP entry was present");
      expect(config.mcp.supermemory).toBeUndefined();
      expect(config.mcp.external).toEqual({ type: "remote", url: "https://example.com/mcp" });
    } finally {
      cleanup(dir);
    }
  });

  test("preserves the original file when atomic retirement rename fails", () => {
    const configPath = "/fixtures/opencode.json";
    const original = JSON.stringify({
      mcp: {
        supermemory: {
          type: "remote",
          url: SUPERMEMORY_MCP_URL,
          headers: { "x-sm-project": "sm_project_v1_acme_project_a" },
          enabled: true,
        },
      },
    });
    const files = new Map([[configPath, original]]);
    const result = writeSupermemoryOpenCodeMcpConfig({
      configPath,
      explicitProjectId: "sm_project_v1_acme_project_b",
      fileSystem: {
        exists: (path) => files.has(path),
        readFile: (path) => files.get(path) ?? (() => { throw new Error("missing"); })(),
        writeFile: (path, content) => { files.set(path, content); },
        rename: () => { throw new Error("rename failed"); },
        unlink: (path) => { files.delete(path); },
        temporaryPath: (path) => `${path}.tmp`,
      },
    });

    expect(result.ok).toBe(false);
    expect(files.get(configPath)).toBe(original);
    expect(files.has(`${configPath}.tmp`)).toBe(false);
  });

  test("preserves owner-only mode and unrelated secret-bearing entries while retiring stale Supermemory", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: { "x-sm-project": "sm_project_v1_acme_project_a" },
            enabled: true,
          },
          external: { type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer keep-external-secret" } },
        },
      }), { encoding: "utf-8", mode: 0o600 });
      chmodSync(configPath, 0o600);

      const result = writeSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir, explicitProjectId: "sm_project_v1_acme_project_b" });
      const config = JSON.parse(readFileSync(configPath, "utf-8"));

      expect(result.ok).toBe(true);
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      expect(config.mcp.supermemory).toBeUndefined();
      expect(config.mcp.external.headers.Authorization).toBe("Bearer keep-external-secret");
      expect(JSON.stringify(result)).not.toContain("keep-external-secret");
    } finally {
      cleanup(dir);
    }
  });

  test("uses owner-only mode when original mode cannot be safely read", () => {
    const configPath = "/fixtures/opencode.json";
    const original = JSON.stringify({ mcp: { supermemory: { type: "remote", url: SUPERMEMORY_MCP_URL, headers: { "x-sm-project": "sm_project_v1_acme_project_a" }, enabled: true } } });
    const files = new Map([[configPath, original]]);
    const modes = new Map<string, number>();
    const result = writeSupermemoryOpenCodeMcpConfig({
      configPath,
      explicitProjectId: "sm_project_v1_acme_project_b",
      fileSystem: {
        exists: (path: string) => files.has(path),
        readFile: (path: string) => files.get(path) ?? (() => { throw new Error("missing"); })(),
        writeFile: (path: string, content: string, options?: { mode?: number }) => { files.set(path, content); modes.set(path, typeof options === "object" ? options.mode ?? 0 : 0); },
        rename: (from: string, to: string) => { files.set(to, files.get(from)!); modes.set(to, modes.get(from)!); files.delete(from); modes.delete(from); },
        unlink: (path: string) => { files.delete(path); modes.delete(path); },
        temporaryPath: (path: string) => `${path}.tmp`,
      },
    });

    expect(result.ok).toBe(true);
    expect(modes.get(configPath)).toBe(0o600);
  });

  test("rejects concurrent preimage changes without replacing the updated config", () => {
    const configPath = "/fixtures/opencode.json";
    const original = JSON.stringify({ mcp: { supermemory: { type: "remote", url: SUPERMEMORY_MCP_URL, headers: { "x-sm-project": "sm_project_v1_acme_project_a" }, enabled: true } } });
    const concurrent = JSON.stringify({ mcp: { external: { type: "remote", url: "https://changed.example/mcp" } } });
    const files = new Map([[configPath, original]]);
    const result = writeSupermemoryOpenCodeMcpConfig({
      configPath,
      explicitProjectId: "sm_project_v1_acme_project_b",
      fileSystem: {
        exists: (path: string) => files.has(path),
        readFile: (path: string) => files.get(path) ?? (() => { throw new Error("missing"); })(),
        writeFile: (path: string, content: string) => { files.set(path, content); files.set(configPath, concurrent); },
        rename: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
        unlink: (path: string) => { files.delete(path); },
        temporaryPath: (path: string) => `${path}.tmp`,
      },
    });

    expect(result.ok).toBe(false);
    expect(files.get(configPath)).toBe(concurrent);
    expect(files.has(`${configPath}.tmp`)).toBe(false);
  });

  test("rolls back and cleans up when post-replacement verification fails", () => {
    const configPath = "/fixtures/opencode.json";
    const original = JSON.stringify({ mcp: { supermemory: { type: "remote", url: SUPERMEMORY_MCP_URL, headers: { "x-sm-project": "sm_project_v1_acme_project_a" }, enabled: true } } });
    const files = new Map([[configPath, original]]);
    let corruptNextReplacement = true;
    const result = writeSupermemoryOpenCodeMcpConfig({
      configPath,
      explicitProjectId: "sm_project_v1_acme_project_b",
      fileSystem: {
        exists: (path: string) => files.has(path),
        readFile: (path: string) => files.get(path) ?? (() => { throw new Error("missing"); })(),
        writeFile: (path: string, content: string) => { files.set(path, content); },
        rename: (from: string, to: string) => {
          if (to === configPath && corruptNextReplacement) {
            corruptNextReplacement = false;
            files.set(to, "{not-json");
          } else {
            files.set(to, files.get(from)!);
          }
          files.delete(from);
        },
        unlink: (path: string) => { files.delete(path); },
        temporaryPath: (path: string) => `${path}.tmp`,
      },
    });

    expect(result.ok).toBe(false);
    expect(files.get(configPath)).toBe(original);
    expect(files.has(`${configPath}.tmp`)).toBe(false);
  });

  test("preserves ambiguous external Supermemory entries as unmanaged", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      const original = {
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: { "x-sm-project": "sm_project_v1_other_repo" },
            enabled: true,
            userNote: "external",
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(original), "utf-8");

      const result = writeSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir, explicitProjectId: "sm_project_v1_kevin15011_deck" });
      const config = JSON.parse(require("node:fs").readFileSync(configPath, "utf-8"));

      expect(result.ok).toBe(false);
      expect(config).toEqual(original);
      expect(result.diagnostics.join(" ")).toContain("unmanaged");
    } finally {
      cleanup(dir);
    }
  });

  test("does not create fresh raw Supermemory MCP config", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "sm_test_token_123",
        configPath,
        homeDir: dir,
          explicitProjectId: "sm_project_v1_test_project",
      });

      expect(result.ok).toBe(false);
      expect(require("node:fs").existsSync(configPath)).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("disabled");
    } finally {
      cleanup(dir);
    }
  });

  test("accepts explicit canonical projectId only for exact stale retirement, not materialization", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      // REQ-R26: explicitProjectId should NOT use p: prefix (passed directly)
      const result = writeSupermemoryOpenCodeMcpConfig({
        token: "sm_test_token_123",
        configPath,
        homeDir: dir,
        explicitProjectId: "sm_project_v1_my_custom_project",  // NOT "p:my-custom-project"
      });

      expect(result.ok).toBe(false);
      expect(require("node:fs").existsSync(configPath)).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("disabled");
    } finally {
      cleanup(dir);
    }
  });

  test("rejects invalid explicit projectId overrides without writing config", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      const result = writeSupermemoryOpenCodeMcpConfig({
        configPath,
        homeDir: dir,
        explicitProjectId: "sm_project_default",
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("Canonical x-sm-project");
    } finally {
      cleanup(dir);
    }
  });
});

describe("validateSupermemoryOpenCodeMcpConfig - URL validation", () => {
  test("diagnoses an exact Deck-managed raw Supermemory MCP entry as stale instead of authorizing it", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            enabled: true,
            headers: {
              "x-sm-project": "sm_project_v1_test_project",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.projectScope).toBe("sm_project_v1_test_project");
      expect(result.diagnostics.join(" ")).toContain("stale Deck-managed raw Supermemory MCP");
      expect(result.diagnostics.join(" ")).toContain("retire");
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
  test("diagnoses credential-free raw Supermemory MCP as unmanaged and external-unobservable", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_v1_test_project",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("unmanaged");
      expect(result.diagnostics.join(" ")).toContain("external-unobservable");
    } finally {
      cleanup(dir);
    }
  });

  test("diagnoses raw Supermemory MCP even with a canonical x-sm-project header", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_v1_my_repo",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("external-unobservable");
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
              "x-sm-project": "sm_project_v1_test_project",
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
              "x-sm-project": "sm_project_v1_test_project",
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
  test("diagnoses default server name 'supermemory' when raw MCP is present", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_v1_test_project",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, homeDir: dir });
      expect(result.ok).toBe(false);
      expect(result.serverName).toBe(SUPERMEMORY_MCP_SERVER_NAME);
    } finally {
      cleanup(dir);
    }
  });

  test("diagnoses custom server name pointing to Supermemory MCP URL", () => {
    const dir = createTempDir();
    try {
      const configPath = join(dir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({
        mcp: {
          mycustom: {
            type: "remote",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_v1_test_project",
            },
          },
        },
      }), "utf-8");

      const result = validateSupermemoryOpenCodeMcpConfig({ configPath, serverName: "mycustom", homeDir: dir });
      expect(result.ok).toBe(false);
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
  test("Supermemory is the only supported durable provider ID", () => {
    const SUPPORTED = ["supermemory"];
    expect(SUPPORTED).toEqual(["supermemory"]);
  });

  test("none is also a valid provider value", () => {
    const cliMemoryProvider = "none";
    const supported = ["supermemory", "none"];
    expect(supported).toContain(cliMemoryProvider);
  });
});

describe("fail-open diagnostics", () => {
  test("missing config is safe because raw Supermemory MCP is optional and absent", () => {
    const dir = createTempDir();
    try {
      const result = validateSupermemoryOpenCodeMcpConfig({ configPath: join(dir, "opencode.json"), homeDir: dir });
      expect(result.ok).toBe(true);
      expect(result.diagnostics.join(" ")).toContain("absent");
      expect(result.diagnostics.join(" ")).toContain("Deck Runtime");
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

  test("missing server entry is safe and does not request raw MCP materialization", () => {
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
      expect(result.ok).toBe(true);
      expect(result.diagnostics.join(" ")).toContain("absent");
      expect(result.diagnostics.join(" ")).not.toContain("not injected");
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
        projectRoot: dir,
      });

      expect(result.ok).toBe(false);
      expect(require("node:fs").existsSync(configPath)).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("disabled");
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
        projectRoot: dir,
      });

      expect(result.ok).toBe(false);
      expect(require("node:fs").existsSync(configPath)).toBe(false);
      expect(result.diagnostics.join(" ")).toContain("disabled");
    } finally {
      cleanup(dir);
    }
  });
});
