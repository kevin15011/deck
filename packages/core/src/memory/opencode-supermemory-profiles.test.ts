import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOwnerOnlyFileSecretStore } from "../config/secret-store";
import {
  OPENCODE_SUPERMEMORY_PROFILE_SECRET,
  discoverLiteralSshHostAliases,
  discoverLiteralSshHostAliasesFromHome,
  inspectOpenCodeSupermemoryProfileConfiguration,
  listConfiguredOpenCodeSupermemoryProfiles,
  resolveOpenCodeSupermemoryCredential,
  storeOpenCodeSupermemoryCredential,
} from "./opencode-supermemory-profiles";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function memoryStore(initial?: string) {
  const values = new Map<string, string>();
  if (initial) values.set(OPENCODE_SUPERMEMORY_PROFILE_SECRET, initial);
  return {
    read: (name: string) => values.get(name),
    write: (name: string, value: string) => {
      values.set(name, value);
      return { backend: "owner-only-file" as const, path: "/tmp/redacted", limitation: "test" };
    },
  };
}

describe("OpenCode Supermemory profiles", () => {
  test("reports configured profile names without returning credential bytes", () => {
    const raw = JSON.stringify({
      schema: "deck-opencode-supermemory-profiles-v1",
      defaultToken: "sm_default_SHOULD_NOT_LEAK",
      profiles: {
        personal: "sm_personal_SHOULD_NOT_LEAK",
        work: "sm_work_SHOULD_NOT_LEAK",
      },
    });

    const configured = listConfiguredOpenCodeSupermemoryProfiles(raw);

    expect(configured).toEqual(["default", "personal", "work"]);
    expect(JSON.stringify(configured)).not.toContain("SHOULD_NOT_LEAK");
    expect(listConfiguredOpenCodeSupermemoryProfiles(undefined)).toEqual([]);
    expect(() => listConfiguredOpenCodeSupermemoryProfiles("not-json")).toThrow("invalid-store");
  });

  test("distinguishes the fallback default credential from an SSH alias literally named default", () => {
    const raw = JSON.stringify({
      schema: "deck-opencode-supermemory-profiles-v1",
      defaultToken: "sm_fallback_SHOULD_NOT_LEAK",
      profiles: {
        default: "sm_alias_SHOULD_NOT_LEAK",
        work: "sm_work_SHOULD_NOT_LEAK",
      },
    });

    const configuration = inspectOpenCodeSupermemoryProfileConfiguration(raw);

    expect(configuration).toEqual({ fallbackDefaultConfigured: true, configuredAliases: ["default", "work"] });
    expect(JSON.stringify(configuration)).not.toContain("SHOULD_NOT_LEAK");
  });

  test("discovers only unambiguous literal Host aliases without inspecting keys", () => {
    const result = discoverLiteralSshHostAliases(`
Host work
  HostName github.com
  IdentityFile ~/.ssh/id_work
Host personal other
  HostName github.com
Host *.example.com
  HostName github.com
Host duplicate
  HostName gitlab.com
Host duplicate
  HostName github.com
`);

    expect(result.aliases).toEqual(["other", "personal", "work"]);
    expect(result.ambiguousAliases).toEqual(["duplicate"]);
    expect(JSON.stringify(result)).not.toContain("id_work");
  });

  test("routes an exact logical SSH Host alias and falls back to explicit default for every unresolved origin", () => {
    const store = memoryStore();
    storeOpenCodeSupermemoryCredential({ store, token: "sm_work", alias: "work", eligibleAliases: ["work"] });
    storeOpenCodeSupermemoryCredential({ store, token: "sm_default", makeDefault: true, eligibleAliases: ["work"] });

    expect(resolveOpenCodeSupermemoryCredential({ store, origin: "git@work:org/repo.git", sshDiscoveryStatus: "trusted" })).toMatchObject({ ok: true, profile: "work", token: "sm_work", source: "alias" });
    for (const origin of [
      "https://github.com/org/repo.git",
      "git@unknown:org/repo.git",
      "ssh://git@unknown/org/repo.git",
      undefined,
      "not a remote",
    ]) {
      expect(resolveOpenCodeSupermemoryCredential({ store, origin })).toMatchObject({ ok: true, profile: "default", token: "sm_default", source: "default" });
    }
    expect(resolveOpenCodeSupermemoryCredential({ store, origin: "git@work:org/repo.git", ambiguousAliases: ["work"] }))
      .toMatchObject({ ok: true, profile: "default", token: "sm_default", source: "default" });
  });

  test("parses SSH URIs after excluding them from SCP-style matching", () => {
    const store = memoryStore();
    storeOpenCodeSupermemoryCredential({ store, token: "sm_work", alias: "work", eligibleAliases: ["work"] });

    expect(resolveOpenCodeSupermemoryCredential({ store, origin: "ssh://git@work/org/repo.git", sshDiscoveryStatus: "trusted" }))
      .toMatchObject({ ok: true, profile: "work", token: "sm_work", source: "alias" });
  });

  test("treats prototype property names as ordinary aliases without inheriting values", () => {
    const noProfiles = memoryStore('{"schema":"deck-opencode-supermemory-profiles-v1","profiles":{}}');
    expect(resolveOpenCodeSupermemoryCredential({ store: noProfiles, origin: "git@constructor:org/repo.git" }))
      .toMatchObject({ ok: false, reason: "missing-default" });

    const store = memoryStore();
    storeOpenCodeSupermemoryCredential({ store, token: "sm_constructor", alias: "constructor", eligibleAliases: ["constructor"] });
    expect(resolveOpenCodeSupermemoryCredential({ store, origin: "git@constructor:org/repo.git", sshDiscoveryStatus: "trusted" }))
      .toMatchObject({ ok: true, profile: "constructor", token: "sm_constructor", source: "alias" });
  });

  test("loads bounded trusted Include files and marks aliases repeated across files ambiguous", () => {
    const home = mkdtempSync(join(tmpdir(), "deck-ssh-home-"));
    roots.push(home);
    const ssh = join(home, ".ssh");
    mkdirSync(join(ssh, "config.d"), { recursive: true, mode: 0o700 });
    writeFileSync(join(ssh, "config"), "Include config.d/*\nHost primary\n", { mode: 0o600 });
    writeFileSync(join(ssh, "config.d", "work"), "Host work repeated\n", { mode: 0o600 });
    writeFileSync(join(ssh, "config.d", "other"), "Host repeated other\n", { mode: 0o600 });

    expect(discoverLiteralSshHostAliasesFromHome(home)).toEqual({
      status: "trusted",
      aliases: ["other", "primary", "work"],
      ambiguousAliases: ["repeated"],
    });
  });

  test("supports equals-form Host and Include directives", () => {
    const home = mkdtempSync(join(tmpdir(), "deck-ssh-home-"));
    roots.push(home);
    const ssh = join(home, ".ssh");
    mkdirSync(join(ssh, "config.d"), { recursive: true, mode: 0o700 });
    writeFileSync(join(ssh, "config"), "Include=config.d/work\nHost=primary\n", { mode: 0o600 });
    writeFileSync(join(ssh, "config.d", "work"), "Host=work\n", { mode: 0o600 });

    expect(discoverLiteralSshHostAliasesFromHome(home)).toEqual({
      status: "trusted",
      aliases: ["primary", "work"],
      ambiguousAliases: [],
    });
  });

  test("fails closed when SSH configuration ancestry or included files are untrusted", () => {
    const home = mkdtempSync(join(tmpdir(), "deck-ssh-home-"));
    const outside = mkdtempSync(join(tmpdir(), "deck-ssh-outside-"));
    roots.push(home, outside);
    writeFileSync(join(outside, "config"), "Host stolen\n", { mode: 0o600 });
    symlinkSync(outside, join(home, ".ssh"));
    expect(discoverLiteralSshHostAliasesFromHome(home)).toEqual({ status: "uncertain", aliases: [], ambiguousAliases: [] });

    rmSync(join(home, ".ssh"));
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    writeFileSync(join(home, ".ssh", "config"), "Include included\nHost primary\n", { mode: 0o600 });
    writeFileSync(join(home, ".ssh", "included"), "Host untrusted\n", { mode: 0o666 });
    chmodSync(join(home, ".ssh", "included"), 0o666);
    expect(discoverLiteralSshHostAliasesFromHome(home)).toEqual({ status: "uncertain", aliases: [], ambiguousAliases: [] });
  });

  test("marks unreadable and unsupported Include configurations uncertain and routes default-only", () => {
    const home = mkdtempSync(join(tmpdir(), "deck-ssh-home-"));
    roots.push(home);
    const ssh = join(home, ".ssh");
    mkdirSync(join(ssh, "config.d"), { recursive: true, mode: 0o700 });
    const config = join(ssh, "config");
    writeFileSync(config, "Host work\n", { mode: 0o600 });
    chmodSync(config, 0o000);
    const unreadable = discoverLiteralSshHostAliasesFromHome(home);
    expect(unreadable).toEqual({ status: "uncertain", aliases: [], ambiguousAliases: [] });

    chmodSync(config, 0o600);
    writeFileSync(config, "Include config.*/work\nHost work\n", { mode: 0o600 });
    const unsupported = discoverLiteralSshHostAliasesFromHome(home);
    expect(unsupported).toEqual({ status: "uncertain", aliases: [], ambiguousAliases: [] });

    const store = memoryStore();
    storeOpenCodeSupermemoryCredential({ store, token: "sm_work", alias: "work", eligibleAliases: ["work"] });
    storeOpenCodeSupermemoryCredential({ store, token: "sm_default", makeDefault: true, eligibleAliases: ["work"] });
    expect(resolveOpenCodeSupermemoryCredential({
      store,
      origin: "git@work:org/repo.git",
      sshDiscoveryStatus: unsupported.status,
    })).toMatchObject({ ok: true, profile: "default", token: "sm_default", source: "default" });
  });

  test("fails closed when neither the selected alias nor an explicit default has a token", () => {
    const store = memoryStore();
    storeOpenCodeSupermemoryCredential({ store, token: "sm_work", alias: "work", eligibleAliases: ["work"] });

    const result = resolveOpenCodeSupermemoryCredential({ store, origin: "git@unknown:org/repo.git" });
    expect(result).toEqual({
      ok: false,
      reason: "missing-default",
      message: "No OpenCode Supermemory credential is configured for the resolved profile and no explicit default credential is available.",
    });
    expect(JSON.stringify(result)).not.toContain("sm_work");
  });

  test("rejects unknown aliases and corrupt profile records without exposing stored bytes", () => {
    const store = memoryStore();
    expect(() => storeOpenCodeSupermemoryCredential({ store, token: "sm_secret", alias: "unknown", eligibleAliases: ["work"] })).toThrow("eligible literal SSH Host alias");

    const corrupt = memoryStore('{"schema":"wrong","token":"sm_leak"}');
    const result = resolveOpenCodeSupermemoryCredential({ store: corrupt, origin: "git@work:org/repo.git" });
    expect(result).toMatchObject({ ok: false, reason: "invalid-store" });
    expect(JSON.stringify(result)).not.toContain("sm_leak");
  });

  test("uses the secret store atomic update primitive for profile mutations", () => {
    let stored: string | undefined;
    const store = {
      read: () => { throw new Error("non-atomic read must not be used"); },
      write: () => { throw new Error("non-atomic write must not be used"); },
      update: (_name: string, updater: (current: string | undefined) => string) => {
        stored = updater(stored);
        return { backend: "owner-only-file" as const, path: "/tmp/redacted", limitation: "test" };
      },
    };

    storeOpenCodeSupermemoryCredential({ store, token: "sm_work", alias: "work", eligibleAliases: ["work"] });
    storeOpenCodeSupermemoryCredential({ store, token: "sm_default", makeDefault: true, eligibleAliases: ["work"] });
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ defaultToken: "sm_default", profiles: { work: "sm_work" } });
  });

  test("preserves concurrent profile writers through the owner-only file store", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-profile-concurrency-"));
    roots.push(root);
    const modulePath = resolve(import.meta.dir, "opencode-supermemory-profiles.ts");
    const secretStorePath = resolve(import.meta.dir, "../config/secret-store.ts");
    const aliases = ["one", "two", "three", "four", "five", "six"];
    const processes = aliases.map((alias) => Bun.spawn({
      cmd: [process.execPath, "-e", `
        import { createOwnerOnlyFileSecretStore } from ${JSON.stringify(secretStorePath)};
        import { storeOpenCodeSupermemoryCredential } from ${JSON.stringify(modulePath)};
        const store = createOwnerOnlyFileSecretStore({ configHome: ${JSON.stringify(root)} });
        storeOpenCodeSupermemoryCredential({ store, token: ${JSON.stringify(`sm_${alias}`)}, alias: ${JSON.stringify(alias)}, eligibleAliases: ${JSON.stringify(aliases)} });
      `],
      stdout: "pipe",
      stderr: "pipe",
    }));
    expect(await Promise.all(processes.map((process) => process.exited))).toEqual(aliases.map(() => 0));

    const store = createOwnerOnlyFileSecretStore({ configHome: root });
    for (const alias of aliases) {
      expect(resolveOpenCodeSupermemoryCredential({ store, origin: `git@${alias}:org/repo.git`, sshDiscoveryStatus: "trusted" }))
        .toMatchObject({ ok: true, profile: alias, token: `sm_${alias}`, source: "alias" });
    }
  });
});
