import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AdaptiveMemoryActiveProvider,
  DeckConfigError,
  getDeckConfigPath,
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

describe("readDeckConfig", () => {
  test("returns provider none defaults when .deck/config.json is absent", () => {
    const root = createTempRoot();

    const config = readDeckConfig(root);

    expect(config).toEqual({
      version: 1,
      adaptiveMemory: { activeProvider: "none" },
    });
  });

  test("defaults missing active provider to none", () => {
    const config = validateDeckConfig({ version: 1, adaptiveMemory: {} });

    expect(config.adaptiveMemory.activeProvider).toBe("none");
  });
});

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
      { version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", token: "never" } } },
      { version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", credential: "never" } } },
      { version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", apiKey: "never" } } },
      { version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { userId: "u", nested: { secret: "never" } } } },
    ];

    for (const candidate of secretFieldCases) {
      expectDeckConfigError(
        () => validateDeckConfig(candidate),
        "SUPERMEMORY_CREDENTIAL_IN_DECK_CONFIG",
      );
    }
  });

  test("rejects unsupported providers", () => {
    expectDeckConfigError(
      () => validateDeckConfig({ version: 1, adaptiveMemory: { activeProvider: "other" } }),
      "ADAPTIVE_MEMORY_UNSUPPORTED_PROVIDER",
    );
  });
});

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
});

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
