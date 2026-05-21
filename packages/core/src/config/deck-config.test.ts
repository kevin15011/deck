import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AdaptiveMemoryActiveProvider,
  DeckConfigError,
  getDeckConfigPath,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  PACKAGE_INSTRUCTION_RUNNERS,
  readDeckConfig,
  resolveActiveMemoryProvider,
  validateDeckConfig,
  writeDeckConfig,
} from "./deck-config";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-config-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function expectDeckConfigError(fn: () => unknown, code: DeckConfigError["code"]): DeckConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DeckConfigError);
    expect((error as DeckConfigError).code).toBe(code);
    return error as DeckConfigError;
  }

  throw new Error(`Expected DeckConfigError with code ${code}`);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("PACKAGE_INSTRUCTION_RUNNERS", () => {
  test("contains pi and opencode", () => {
    expect(PACKAGE_INSTRUCTION_RUNNERS).toContain("pi");
    expect(PACKAGE_INSTRUCTION_RUNNERS).toContain("opencode");
    expect(PACKAGE_INSTRUCTION_RUNNERS).toHaveLength(2);
  });
});

describe("PACKAGE_INSTRUCTION_PACKAGE_IDS", () => {
  test("contains codebase-memory, context-mode, rtk", () => {
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("codebase-memory");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("context-mode");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("rtk");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// readDeckConfig
// ---------------------------------------------------------------------------

describe("readDeckConfig", () => {
  test("returns provider none defaults when .deck/config.json is absent", () => {
    const root = createTempRoot();

    const config = readDeckConfig(root);

    expect(config).toEqual({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {
        pi: { "codebase-memory": false, "context-mode": false, rtk: false },
        opencode: { "codebase-memory": false, "context-mode": false, rtk: false },
      },
    });
  });

  test("defaults missing active provider to none", () => {
    const config = validateDeckConfig({ version: 1, adaptiveMemory: {} });

    expect(config.adaptiveMemory.activeProvider).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// validateDeckConfig — packageInstructions
// ---------------------------------------------------------------------------

describe("validateDeckConfig — packageInstructions", () => {
  test("defaults all package instruction toggles to false when field is absent", () => {
    const config = validateDeckConfig({ version: 1, adaptiveMemory: { activeProvider: "none" } });

    expect(config.packageInstructions.pi["codebase-memory"]).toBe(false);
    expect(config.packageInstructions.pi["context-mode"]).toBe(false);
    expect(config.packageInstructions.pi.rtk).toBe(false);
    expect(config.packageInstructions.opencode["codebase-memory"]).toBe(false);
    expect(config.packageInstructions.opencode["context-mode"]).toBe(false);
    expect(config.packageInstructions.opencode.rtk).toBe(false);
  });

  test("accepts valid per-runner boolean toggles", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {
        pi: { "codebase-memory": true, "context-mode": false },
        opencode: { rtk: true },
      },
    });

    expect(config.packageInstructions.pi["codebase-memory"]).toBe(true);
    expect(config.packageInstructions.pi["context-mode"]).toBe(false);
    expect(config.packageInstructions.pi.rtk).toBe(false);
    expect(config.packageInstructions.opencode.rtk).toBe(true);
    expect(config.packageInstructions.opencode["codebase-memory"]).toBe(false);
  });

  test("treats missing runner inside packageInstructions as empty object defaults to false", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {},
    });

    // All packages for all runners default to false
    expect(config.packageInstructions.pi["codebase-memory"]).toBe(false);
    expect(config.packageInstructions.opencode.rtk).toBe(false);
  });

  test("treats null config input as default config (all package instructions disabled)", () => {
    const config = validateDeckConfig(null);

    expect(config.packageInstructions.pi["codebase-memory"]).toBe(false);
    expect(config.packageInstructions.pi["context-mode"]).toBe(false);
    expect(config.packageInstructions.pi.rtk).toBe(false);
    expect(config.packageInstructions.opencode["codebase-memory"]).toBe(false);
    expect(config.packageInstructions.opencode["context-mode"]).toBe(false);
    expect(config.packageInstructions.opencode.rtk).toBe(false);
  });

  test("rejects unknown runner key inside packageInstructions", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { unknownRunner: { rtk: true } },
        }),
      "DECK_CONFIG_UNKNOWN_FIELD",
    );

    expect(error.fieldPath).toBe("packageInstructions.unknownRunner");
  });

  test("rejects unknown package ID inside runner sub-object", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { pi: { "unknown-pkg": true } },
        }),
      "DECK_CONFIG_UNKNOWN_FIELD",
    );

    expect(error.fieldPath).toBe("packageInstructions.pi.unknown-pkg");
  });

  test("rejects non-boolean value for package toggle", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { pi: { rtk: "yes" } },
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );

    expect(error.fieldPath).toBe("packageInstructions.pi.rtk");
  });

  test("rejects non-boolean value for package toggle (number)", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { pi: { "codebase-memory": 1 } },
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );

    expect(error.fieldPath).toBe("packageInstructions.pi.codebase-memory");
  });

  test("rejects non-boolean value for package toggle (null)", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { opencode: { rtk: null } },
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );

    expect(error.fieldPath).toBe("packageInstructions.opencode.rtk");
  });

  test("rejects non-object packageInstructions value", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: "not-an-object",
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );

    expect(error.fieldPath).toBe("packageInstructions");
  });

  test("rejects secret-like field inside packageInstructions sub-object", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          packageInstructions: { pi: { "codebase-memory": true, token: "secret" } },
        }),
      "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG",
    );
  });

  test("accepts all booleans set to true for both runners", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {
        pi: { "codebase-memory": true, "context-mode": true, rtk: true },
        opencode: { "codebase-memory": true, "context-mode": true, rtk: true },
      },
    });

    for (const runner of PACKAGE_INSTRUCTION_RUNNERS) {
      for (const pkg of PACKAGE_INSTRUCTION_PACKAGE_IDS) {
        expect(config.packageInstructions[runner][pkg]).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// validateDeckConfig — adaptive memory (existing tests preserved)
// ---------------------------------------------------------------------------

describe("validateDeckConfig", () => {
  test("accepts non-secret Supermemory config with required userId", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: {
        activeProvider: "supermemory",
        supermemory: {
          mcpServerName: "supermemory",
          userId: "user-123",
          teamId: "team-123",
          orgId: "org-123",
          searchMode: "memories",
          maxMemoriesPerSession: 7,
        },
      },
    });

    expect(config.adaptiveMemory.activeProvider).toBe("supermemory");
    expect(config.adaptiveMemory.supermemory?.userId).toBe("user-123");
    expect(config.adaptiveMemory.supermemory?.teamId).toBe("team-123");
    expect(config.adaptiveMemory.supermemory?.orgId).toBe("org-123");
  });

  test("requires userId when Supermemory is active", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: {
            activeProvider: "supermemory",
            supermemory: { mcpServerName: "supermemory" },
          },
        }),
      "SUPERMEMORY_USER_ID_REQUIRED",
    );
  });

  test("rejects empty userId when provided", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: {
            activeProvider: "supermemory",
            supermemory: { userId: "   " },
          },
        }),
      "SUPERMEMORY_USER_ID_REQUIRED",
    );
  });

  test("rejects token, credential, and secret-like fields anywhere in config", () => {
    const secretFieldCases = [
      {
        version: 1,
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", token: "never" } },
      },
      {
        version: 1,
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", credential: "never" } },
      },
      {
        version: 1,
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", apiKey: "never" } },
      },
      {
        version: 1,
        adaptiveMemory: {
          activeProvider: "supermemory",
          supermemory: { userId: "u", nested: { secret: "never" } },
        },
      },
    ];

    for (const candidate of secretFieldCases) {
      expectDeckConfigError(() => validateDeckConfig(candidate), "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG");
    }
  });

  test("rejects empty string as provider", () => {
    expectDeckConfigError(
      () => validateDeckConfig({ version: 1, adaptiveMemory: { activeProvider: "" } }),
      "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER",
    );
  });
});

// ---------------------------------------------------------------------------
// writeDeckConfig
// ---------------------------------------------------------------------------

describe("writeDeckConfig", () => {
  test("persists only normalized non-secret config", () => {
    const root = createTempRoot();

    const written = writeDeckConfig(root, {
      version: 1,
      adaptiveMemory: {
        activeProvider: "supermemory",
        supermemory: { userId: "user-123", searchMode: "memories" },
      },
    });

    const path = getDeckConfigPath(root);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf-8");
    expect(raw).not.toMatch(/token|credential|secret|apiKey/i);
    expect(JSON.parse(raw)).toEqual(written);
    expect(written.adaptiveMemory.supermemory?.mcpServerName).toBe("supermemory");
  });

  test("persists packageInstructions when provided", () => {
    const root = createTempRoot();

    const input = {
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {
        pi: { "codebase-memory": true, "context-mode": false, rtk: false },
        opencode: { "codebase-memory": false, "context-mode": true, rtk: false },
      },
    };

    const written = writeDeckConfig(root, input);

    const path = getDeckConfigPath(root);
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.packageInstructions.pi["codebase-memory"]).toBe(true);
    expect(parsed.packageInstructions.pi["context-mode"]).toBe(false);
    expect(parsed.packageInstructions.opencode["context-mode"]).toBe(true);
    expect(parsed).toEqual(written);
  });

  test("rejects secret fields before writing", () => {
    const root = createTempRoot();

    expectDeckConfigError(
      () =>
        writeDeckConfig(root, {
          version: 1,
          adaptiveMemory: {
            activeProvider: "supermemory",
            supermemory: { userId: "user-123", token: "do-not-store" },
          },
        }),
      "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG",
    );

    expect(existsSync(getDeckConfigPath(root))).toBe(false);
  });

  test("round-trip: written config can be re-read with same packageInstructions values", () => {
    const root = createTempRoot();

    writeDeckConfig(root, {
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      packageInstructions: {
        pi: { "codebase-memory": true, "context-mode": false, rtk: true },
        opencode: { "codebase-memory": false, "context-mode": true, rtk: false },
      },
    });

    const reRead = readDeckConfig(root);

    expect(reRead.packageInstructions.pi["codebase-memory"]).toBe(true);
    expect(reRead.packageInstructions.pi["context-mode"]).toBe(false);
    expect(reRead.packageInstructions.pi.rtk).toBe(true);
    expect(reRead.packageInstructions.opencode["codebase-memory"]).toBe(false);
    expect(reRead.packageInstructions.opencode["context-mode"]).toBe(true);
    expect(reRead.packageInstructions.opencode.rtk).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveActiveMemoryProvider (existing tests preserved)
// ---------------------------------------------------------------------------

describe("resolveActiveMemoryProvider", () => {
  test("uses CLI override before config", () => {
    const resolution = resolveActiveMemoryProvider({
      cliProvider: "none",
      config: {
        version: 1,
        adaptiveMemory: {
          activeProvider: "supermemory",
          supermemory: { userId: "user-123" },
        },
      },
    });

    expect(resolution.activeProvider).toBe("none");
    expect(resolution.source).toBe("cli");
  });

  test("uses config when CLI override is absent", () => {
    const resolution = resolveActiveMemoryProvider({
      config: { version: 1, adaptiveMemory: { activeProvider: "engram" } },
    });

    expect(resolution.activeProvider).toBe("engram");
    expect(resolution.source).toBe("config");
  });

  test("falls back to none when no CLI override or config file is present", () => {
    const root = createTempRoot();

    const resolution = resolveActiveMemoryProvider({ projectRoot: root });

    expect(resolution.activeProvider).toBe("none");
    expect(resolution.source).toBe("default");
  });

  test("resolves CLI Supermemory only when non-secret config contains userId", () => {
    const valid = resolveActiveMemoryProvider({
      cliProvider: "supermemory" satisfies AdaptiveMemoryActiveProvider,
      config: { version: 1, adaptiveMemory: { supermemory: { userId: "user-123" } } },
    });
    expect(valid.activeProvider).toBe("supermemory");
    expect(valid.supermemory?.userId).toBe("user-123");

    expectDeckConfigError(
      () =>
        resolveActiveMemoryProvider({
          cliProvider: "supermemory",
          config: { version: 1, adaptiveMemory: {} },
        }),
      "SUPERMEMORY_USER_ID_REQUIRED",
    );
  });

  test("reads project config file for resolver precedence", () => {
    const root = createTempRoot();
    writeDeckConfig(root, { version: 1, adaptiveMemory: { activeProvider: "engram" } });

    const resolution = resolveActiveMemoryProvider({ projectRoot: root });

    expect(resolution.activeProvider).toBe("engram");
    expect(resolution.source).toBe("config");
  });
});