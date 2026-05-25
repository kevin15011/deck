import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AdaptiveMemoryActiveProvider,
  DeckConfigError,
  DEFAULT_ORCHESTRATOR_PERSONALITY,
  getDeckConfigPath,
  ORCHESTRATOR_PERSONALITIES,
  PACKAGE_INSTRUCTION_PACKAGE_IDS,
  PACKAGE_INSTRUCTION_RUNNERS,
  readDeckConfig,
  resolveActiveMemoryProvider,
  validateDeckConfig,
  writeDeckConfig,
  SDD_PHASES,
  type Profile,
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
  test("contains codebase-memory, context-mode, rtk, adaptive-memory", () => {
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("codebase-memory");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("context-mode");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("rtk");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toContain("adaptive-memory");
    expect(PACKAGE_INSTRUCTION_PACKAGE_IDS).toHaveLength(4);
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
        pi: { "codebase-memory": false, "context-mode": false, rtk: false, "adaptive-memory": false },
        opencode: { "codebase-memory": false, "context-mode": false, rtk: false, "adaptive-memory": false },
      },
      orchestratorPersonality: "pragmatica",
      profiles: [],
      activeProfile: "default",
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
        pi: { "codebase-memory": true, "context-mode": true, rtk: true, "adaptive-memory": true },
        opencode: { "codebase-memory": true, "context-mode": true, rtk: true, "adaptive-memory": true },
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
// Orchestrator Personality
// ---------------------------------------------------------------------------

describe("Orchestrator Personality", () => {
  describe("ORCHESTRATOR_PERSONALITIES constant", () => {
    test("contains exactly two values", () => {
      expect(ORCHESTRATOR_PERSONALITIES).toHaveLength(2);
    });

    test("contains guia and pragmatica", () => {
      expect(ORCHESTRATOR_PERSONALITIES).toContain("guia");
      expect(ORCHESTRATOR_PERSONALITIES).toContain("pragmatica");
    });
  });

  describe("DEFAULT_ORCHESTRATOR_PERSONALITY", () => {
    test("is pragmatica", () => {
      expect(DEFAULT_ORCHESTRATOR_PERSONALITY).toBe("pragmatica");
    });
  });

  describe("validateDeckConfig — orchestratorPersonality", () => {
    test("defaults to pragmatica when field is absent", () => {
      const config = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
      });

      expect(config.orchestratorPersonality).toBe("pragmatica");
    });

    test("defaults to pragmatica when config file is absent (readDeckConfig)", () => {
      const root = createTempRoot();
      const config = readDeckConfig(root);

      expect(config.orchestratorPersonality).toBe("pragmatica");
    });

    test("accepts guia as valid personality value", () => {
      const config = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        orchestratorPersonality: "guia",
      });

      expect(config.orchestratorPersonality).toBe("guia");
    });

    test("accepts pragmatica as valid personality value", () => {
      const config = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        orchestratorPersonality: "pragmatica",
      });

      expect(config.orchestratorPersonality).toBe("pragmatica");
    });

    test("rejects invalid string value with DECK_CONFIG_INVALID_SHAPE", () => {
      const error = expectDeckConfigError(
        () =>
          validateDeckConfig({
            version: 1,
            adaptiveMemory: { activeProvider: "none" },
            orchestratorPersonality: "chatty",
          }),
        "DECK_CONFIG_INVALID_SHAPE",
      );

      expect(error.fieldPath).toBe("orchestratorPersonality");
      expect(error.message).toContain("orchestratorPersonality");
      expect(error.message).toContain("guia");
      expect(error.message).toContain("pragmatica");
    });

    test("rejects non-string personality value (number)", () => {
      const error = expectDeckConfigError(
        () =>
          validateDeckConfig({
            version: 1,
            adaptiveMemory: { activeProvider: "none" },
            orchestratorPersonality: 42,
          }),
        "DECK_CONFIG_INVALID_SHAPE",
      );

      expect(error.fieldPath).toBe("orchestratorPersonality");
      expect(error.message).toContain("must be a string");
    });

    test("rejects non-string personality value (object)", () => {
      const error = expectDeckConfigError(
        () =>
          validateDeckConfig({
            version: 1,
            adaptiveMemory: { activeProvider: "none" },
            orchestratorPersonality: { value: "pragmatica" },
          }),
        "DECK_CONFIG_INVALID_SHAPE",
      );

      expect(error.fieldPath).toBe("orchestratorPersonality");
    });
  });

  describe("writeDeckConfig — orchestratorPersonality round-trip", () => {
    test("round-trip preserves each valid personality value", () => {
      const root = createTempRoot();

      for (const personality of ORCHESTRATOR_PERSONALITIES) {
        writeDeckConfig(root, {
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          orchestratorPersonality: personality,
        });

        const reRead = readDeckConfig(root);
        expect(reRead.orchestratorPersonality).toBe(personality);
      }
    });

    test("writing personality does not erase existing adaptiveMemory field", () => {
      const root = createTempRoot();

      // Write initial config with adaptiveMemory
      writeDeckConfig(root, {
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
      });

      // Write config with only orchestratorPersonality (adaptiveMemory omitted)
      const mergedInput = {
        version: 1,
        adaptiveMemory: { activeProvider: "none" }, // must be provided to avoid being dropped
        orchestratorPersonality: "guia",
      };
      writeDeckConfig(root, mergedInput);

      const reRead = readDeckConfig(root);
      expect(reRead.orchestratorPersonality).toBe("guia");
      expect(reRead.adaptiveMemory.activeProvider).toBe("none");
    });

    test("write-then-read round-trip preserves personality for each valid value", () => {
      const root = createTempRoot();

      for (const personality of ORCHESTRATOR_PERSONALITIES) {
        writeDeckConfig(root, {
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          orchestratorPersonality: personality,
        });

        const reRead = readDeckConfig(root);
        expect(reRead.orchestratorPersonality).toBe(personality);
      }
    });

    test("write then read preserves adaptiveMemory when included in the write input", () => {
      const root = createTempRoot();

      // Write initial config
      writeDeckConfig(root, {
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
      });

      // Write again including adaptiveMemory in the input
      writeDeckConfig(root, {
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        orchestratorPersonality: "guia",
      });

      const reRead = readDeckConfig(root);
      expect(reRead.orchestratorPersonality).toBe("guia");
      expect(reRead.adaptiveMemory.activeProvider).toBe("none");
    });
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

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

describe("SDD_PHASES constant", () => {
  test("contains all required phases", () => {
    expect(SDD_PHASES).toContain("explore");
    expect(SDD_PHASES).toContain("proposal");
    expect(SDD_PHASES).toContain("spec");
    expect(SDD_PHASES).toContain("design");
    expect(SDD_PHASES).toContain("tasks");
    expect(SDD_PHASES).toContain("apply");
    expect(SDD_PHASES).toContain("verify");
    expect(SDD_PHASES).toContain("review");
    expect(SDD_PHASES).toContain("archive");
    expect(SDD_PHASES).toContain("onboard");
    expect(SDD_PHASES).toHaveLength(10);
  });
});

describe("Profile defaults", () => {
  test("getDefaultDeckConfig returns empty profiles and default activeProfile", () => {
    const config = validateDeckConfig({ version: 1, adaptiveMemory: { activeProvider: "none" } });
    expect(config.profiles).toEqual([]);
    expect(config.activeProfile).toBe("default");
  });

  test("readDeckConfig with no config file returns default profile values", () => {
    const root = createTempRoot();
    const config = readDeckConfig(root);
    expect(config.profiles).toEqual([]);
    expect(config.activeProfile).toBe("default");
  });

  test("profile with no profiles field normalizes to empty array and default activeProfile", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
    });
    expect(config.profiles).toEqual([]);
    expect(config.activeProfile).toBe("default");
  });

  test("null config returns default profile values", () => {
    const config = validateDeckConfig(null);
    expect(config.profiles).toEqual([]);
    expect(config.activeProfile).toBe("default");
  });
});

describe("Profile validation", () => {
  test("accepts valid profile with name only", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [{ name: "fast" }],
    });
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0].name).toBe("fast");
    expect(config.activeProfile).toBe("default"); // activeProfile not explicitly set
  });

  test("accepts profile with phase overrides for valid phases", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [{
        name: "fast",
        description: "Fast track profile",
        phaseOverrides: {
          verify: { skip: true },
          spec: { mode: "quick" },
        },
      }],
      activeProfile: "fast",
    });
    expect(config.profiles).toHaveLength(1);
    expect(config.activeProfile).toBe("fast");
    expect(config.profiles[0].phaseOverrides?.verify).toEqual({ skip: true });
  });

  test("accepts profile with valid strategy value", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [{ name: "multi", strategy: "generated-multi" }],
    });
    expect(config.profiles[0].strategy).toBe("generated-multi");
  });

  test("accepts profile with external-single-active strategy", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [{ name: "single", strategy: "external-single-active" }],
    });
    expect(config.profiles[0].strategy).toBe("external-single-active");
  });

  test("rejects duplicate profile names with DECK_CONFIG_INVALID_SHAPE", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "fast" }, { name: "fast" }],
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
  });

  test("rejects unknown phase key in phaseOverrides with DECK_CONFIG_UNKNOWN_FIELD", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "test", phaseOverrides: { unknownPhase: {} } }],
        }),
      "DECK_CONFIG_UNKNOWN_FIELD",
    );
  });

  test("rejects invalid strategy value with DECK_CONFIG_INVALID_SHAPE", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "bad", strategy: "invalid-strategy" }],
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
  });

  test("rejects unknown activeProfile name with available names in error", () => {
    const error = expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "fast" }],
          activeProfile: "nonexistent",
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
    expect(error.message).toContain("nonexistent");
    expect(error.message).toContain("fast");
  });

  test("activeProfile 'default' is valid even with empty profiles array", () => {
    const config = validateDeckConfig({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [],
      activeProfile: "default",
    });
    expect(config.activeProfile).toBe("default");
    expect(config.profiles).toEqual([]);
  });

  test("non-string strategy value is rejected", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "bad", strategy: 123 as unknown as string }],
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
  });

  test("non-array profiles value is rejected", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: "not-an-array",
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
  });

  test("profile with empty name is rejected", () => {
    expectDeckConfigError(
      () =>
        validateDeckConfig({
          version: 1,
          adaptiveMemory: { activeProvider: "none" },
          profiles: [{ name: "" }],
        }),
      "DECK_CONFIG_INVALID_SHAPE",
    );
  });
});

describe("Profile persistence round-trip", () => {
  test("write then read preserves profiles and activeProfile", () => {
    const root = createTempRoot();

    const input = {
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [
        { name: "fast", description: "Fast track", phaseOverrides: { verify: { skip: true } } },
        { name: "full", description: "Full review" },
      ],
      activeProfile: "fast",
    };

    writeDeckConfig(root, input);
    const reRead = readDeckConfig(root);

    expect(reRead.profiles).toHaveLength(2);
    expect(reRead.profiles[0].name).toBe("fast");
    expect(reRead.profiles[0].phaseOverrides?.verify).toEqual({ skip: true });
    expect(reRead.profiles[1].name).toBe("full");
    expect(reRead.activeProfile).toBe("fast");
  });

  test("profile with all SDD phase overrides can be written and read back", () => {
    const root = createTempRoot();

    const input = {
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
      profiles: [{
        name: "all-phases",
        phaseOverrides: {
          explore: { mode: "quick" },
          proposal: { mode: "quick" },
          spec: { mode: "detailed" },
          design: { mode: "detailed" },
          tasks: { mode: "standard" },
          apply: { mode: "standard" },
          verify: { skip: true },
          review: { mode: "thorough" },
          archive: { mode: "standard" },
          onboard: { mode: "standard" },
        },
      }],
      activeProfile: "all-phases",
    };

    writeDeckConfig(root, input);
    const reRead = readDeckConfig(root);

    expect(reRead.profiles[0].phaseOverrides?.verify).toEqual({ skip: true });
    expect(reRead.profiles[0].phaseOverrides?.spec).toEqual({ mode: "detailed" });
    expect(reRead.activeProfile).toBe("all-phases");
  });
});