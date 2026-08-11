import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeckConfigStore } from "./deck-config-store";
import { writeTavilyCredentialToActiveShellProfileTransaction } from "./web-search-shell-profile";
import { persistWebSearchCredentialAndEnable } from "./web-search-setup";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-web-search-setup-"));
  roots.push(root);
  return root;
}

function testStore(root: string, projectRoot = join(root, "project")) {
  return createDeckConfigStore({ homeDir: join(root, "home-config"), xdgConfigHome: join(root, "xdg-config"), projectRoot });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("persistWebSearchCredentialAndEnable", () => {
  test("persists only provider selection after the profile write and exposes the key only to this process", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const environment: Record<string, string | undefined> = {};
    const credential = "quoted'value";
    const configStore = testStore(root, projectRoot);
    mkdirSync(home);

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot,
      configStore,
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
    });

    expect(result).toMatchObject({ ok: true, profileStatus: "created" });
    expect(configStore.read().webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(environment.TAVILY_API_KEY).toBe(credential);
    expect(readFileSync(join(home, ".bashrc"), "utf8").includes("export TAVILY_API_KEY=")).toBe(true);
    expect(JSON.stringify(result).includes(credential)).toBe(false);
  });

  test("preserves config changes committed after profile write and before Web Search persistence", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const environment: Record<string, string | undefined> = {};
    const configStore = testStore(root, projectRoot);
    mkdirSync(home);
    configStore.write({ adaptiveMemory: { activeProvider: "none" }, packageInstructions: { codex: { serena: true } } });

    const result = persistWebSearchCredentialAndEnable({
      credential: "interleaved-value",
      projectRoot,
      configStore,
      environment,
      writeProfile: (value) => {
        const transaction = writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" });
        configStore.patch((current) => ({ ...current, orchestratorPersonality: "guia" }));
        return transaction;
      },
    });

    expect(result).toMatchObject({ ok: true });
    const config = configStore.read();
    expect(config.webSearch).toEqual({ enabled: true, provider: "tavily" });
    expect(config.orchestratorPersonality).toBe("guia");
    expect(config.packageInstructions.codex.serena).toBe(true);
  });

  test("rolls back a newly created profile and restores the exact previous environment when Deck config persistence fails", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const environment: Record<string, string | undefined> = { TAVILY_API_KEY: "previous-value" };
    const credential = "failure-value";
    mkdirSync(home);

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
      writeConfig: () => {
        throw new Error("test-only");
      },
    });

    expect(result).toMatchObject({ ok: false, credentialPresent: false, diagnosticCodes: ["deck-config-write-failed"] });
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
    expect(environment.TAVILY_API_KEY).toBe("previous-value");
    expect(JSON.stringify(result).includes(credential)).toBe(false);
  });

  test("rolls back a newly created profile when Deck config reading fails", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const environment: Record<string, string | undefined> = { TAVILY_API_KEY: "before-read-failure" };
    const credential = "read-failure-value";
    mkdirSync(home);

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
      readConfig: () => {
        throw new Error("test-only");
      },
      writeConfig: () => {},
    });

    expect(result).toMatchObject({ ok: false, credentialPresent: false, diagnosticCodes: ["deck-config-write-failed"] });
    expect(existsSync(join(home, ".bashrc"))).toBe(false);
    expect(environment.TAVILY_API_KEY).toBe("before-read-failure");
    expect(JSON.stringify(result).includes(credential)).toBe(false);
  });

  test("restores an updated profile's exact content and mode when Deck config persistence fails", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const target = join(home, ".bashrc");
    const environment: Record<string, string | undefined> = {};
    const credential = "replacement-value";
    const original = Buffer.from("# original\r\n", "utf8");
    const temporaryPaths: string[] = [];
    mkdirSync(home);
    writeFileSync(target, original);
    chmodSync(target, 0o640);

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, {
        home,
        shell: "/bin/bash",
        effects: {
          tempPath(path) {
            temporaryPaths.push(path);
            return path;
          },
        },
      }),
      writeConfig: () => {
        throw new Error("test-only");
      },
    });

    expect(result).toMatchObject({ ok: false, credentialPresent: false, diagnosticCodes: ["deck-config-write-failed"] });
    expect(readFileSync(target).equals(original)).toBe(true);
    expect(lstatSync(target).mode & 0o777).toBe(0o640);
    expect(Object.hasOwn(environment, "TAVILY_API_KEY")).toBe(false);
    expect(temporaryPaths).toHaveLength(2);
    expect(temporaryPaths.every((path) => !existsSync(path))).toBe(true);
    expect(JSON.stringify(result).includes(credential)).toBe(false);
  });

  test("reports manual cleanup for an updated profile when config failure rollback conflicts", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const target = join(home, ".bashrc");
    const environment: Record<string, string | undefined> = { TAVILY_API_KEY: "before" };
    const credential = "conflict-value";
    mkdirSync(home);
    writeFileSync(target, "# original\n", "utf8");

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
      writeConfig: () => {
        writeFileSync(target, "# changed elsewhere\n", "utf8");
        throw new Error("test-only");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      profileStatus: "manual-cleanup-required",
      credentialPresent: true,
      profilePath: target,
      diagnosticCodes: ["deck-config-write-failed", "profile-rollback-conflict"],
    });
    expect(result.message).toContain("may remain");
    expect(result.guidance).toContain("Deck-owned Web Search block");
    expect(readFileSync(target, "utf8")).toBe("# changed elsewhere\n");
    expect(environment.TAVILY_API_KEY).toBe("before");
    expect(JSON.stringify(result).includes(credential)).toBe(false);
  });

  test("reports manual cleanup for a newly created profile when config failure rollback conflicts", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const target = join(home, ".bashrc");
    const environment: Record<string, string | undefined> = { TAVILY_API_KEY: "before-create" };
    const credential = "create-conflict-value";
    const concurrentBytes = "# created elsewhere\n";
    mkdirSync(home);

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, { home, shell: "/bin/bash" }),
      writeConfig: () => {
        writeFileSync(target, concurrentBytes, "utf8");
        throw new Error("test-only");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      profileStatus: "manual-cleanup-required",
      credentialPresent: true,
      profilePath: target,
      diagnosticCodes: ["deck-config-write-failed", "profile-rollback-conflict"],
    });
    expect(result.message).toContain("may remain");
    expect(result.guidance).toContain("Deck-owned Web Search block");
    expect(readFileSync(target, "utf8")).toBe(concurrentBytes);
    expect(environment.TAVILY_API_KEY).toBe("before-create");
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  test("preserves manual-cleanup details when profile verification cannot safely roll back", () => {
    const root = temporaryRoot();
    const home = join(root, "home");
    const target = join(home, ".bashrc");
    const environment: Record<string, string | undefined> = { TAVILY_API_KEY: "before" };
    const credential = "propagation-race-value";
    const concurrentBytes = "# changed elsewhere\n";
    mkdirSync(home);
    writeFileSync(target, "# original\n", "utf8");

    const result = persistWebSearchCredentialAndEnable({
      credential,
      projectRoot: join(root, "project"),
      configStore: testStore(root),
      environment,
      writeProfile: (value) => writeTavilyCredentialToActiveShellProfileTransaction(value, {
        home,
        shell: "/bin/bash",
        effects: {
          rename(source, destination) {
            renameSync(source, destination);
            writeFileSync(destination, concurrentBytes, "utf8");
          },
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      profileStatus: "manual-cleanup-required",
      credentialPresent: true,
      profilePath: target,
      diagnosticCodes: ["profile-post-rename-rollback-conflict"],
    });
    expect(result.message).toContain("may remain");
    expect(result.guidance).toContain("Deck-owned Web Search block");
    expect(readFileSync(target, "utf8")).toBe(concurrentBytes);
    expect(environment.TAVILY_API_KEY).toBe("before");
    expect(JSON.stringify(result)).not.toContain(credential);
  });
});
