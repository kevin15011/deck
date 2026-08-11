import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  DECK_WEB_SEARCH_PROFILE_END,
  DECK_WEB_SEARCH_PROFILE_START,
  writeTavilyCredentialToActiveShellProfile,
} from "./web-search-shell-profile";

const homes: string[] = [];

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), "deck-web-search-profile-"));
  homes.push(home);
  return home;
}

function profile(home: string, name: ".bashrc" | ".zshrc" = ".bashrc"): string {
  return join(home, name);
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("writeTavilyCredentialToActiveShellProfile", () => {
  test("selects only the supported bash and zsh profile paths", () => {
    const home = temporaryHome();

    const bash = writeTavilyCredentialToActiveShellProfile("bash-value", { home, shell: "/bin/bash" });
    const zsh = writeTavilyCredentialToActiveShellProfile("zsh-value", { home, shell: "/bin/zsh" });
    const unsupported = writeTavilyCredentialToActiveShellProfile("ignored", { home, shell: "/bin/fish" });
    const ambiguous = writeTavilyCredentialToActiveShellProfile("ignored", { home, shell: "bash" });

    expect(bash).toMatchObject({ ok: true, status: "created", path: profile(home) });
    expect(zsh).toMatchObject({ ok: true, status: "created", path: profile(home, ".zshrc") });
    expect(unsupported).toMatchObject({ ok: false, diagnosticCodes: ["unsupported-shell"] });
    expect(ambiguous).toMatchObject({ ok: false, diagnosticCodes: ["unsupported-shell"] });
  });

  test("creates, replaces its exact owned block, and leaves a second write unchanged", () => {
    const home = temporaryHome();
    const target = profile(home);
    writeFileSync(target, "export KEEP=1\n", "utf8");

    const created = writeTavilyCredentialToActiveShellProfile("initial-value", { home, shell: "/bin/bash" });
    const updated = writeTavilyCredentialToActiveShellProfile("replacement-value", { home, shell: "/bin/bash" });
    const unchanged = writeTavilyCredentialToActiveShellProfile("replacement-value", { home, shell: "/bin/bash" });
    const content = readFileSync(target, "utf8");

    expect(created).toMatchObject({ ok: true, status: "updated", credentialPresent: true });
    expect(updated).toMatchObject({ ok: true, status: "updated", credentialPresent: true });
    expect(unchanged).toMatchObject({ ok: true, status: "unchanged", credentialPresent: true });
    expect(content).toContain("export KEEP=1\n");
    expect(content.split(DECK_WEB_SEARCH_PROFILE_START)).toHaveLength(2);
    expect(content.split(DECK_WEB_SEARCH_PROFILE_END)).toHaveLength(2);
  });

  test("uses POSIX-safe quoting for a value containing a single quote without printing it", () => {
    const home = temporaryHome();
    const target = profile(home);
    const result = writeTavilyCredentialToActiveShellProfile("quote'value", { home, shell: "/bin/bash" });
    const parsed = spawnSync("/bin/sh", ["-n", target], { encoding: "utf8" });

    expect(result.ok).toBe(true);
    expect(parsed.status).toBe(0);
  });

  test("preserves CRLF and unrelated bytes while replacing its block", () => {
    const home = temporaryHome();
    const target = profile(home);
    const original = Buffer.from(`alpha=1\r\n${DECK_WEB_SEARCH_PROFILE_START}\r\nexport TAVILY_API_KEY='old'\r\n${DECK_WEB_SEARCH_PROFILE_END}\r\nomega=2\r\n`, "utf8");
    writeFileSync(target, original);

    const result = writeTavilyCredentialToActiveShellProfile("new-value", { home, shell: "/bin/bash" });
    const content = readFileSync(target);

    expect(result).toMatchObject({ ok: true, status: "updated" });
    expect(content.includes(Buffer.from("alpha=1\r\n", "utf8"))).toBe(true);
    expect(content.includes(Buffer.from("omega=2\r\n", "utf8"))).toBe(true);
    expect(content.includes(Buffer.from("\n", "utf8"))).toBe(true);
    expect(content.toString("utf8").replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("hardens existing 0644 and 0640 profiles and creates a new profile with mode 0600", () => {
    for (const mode of [0o644, 0o640]) {
      const home = temporaryHome();
      const existing = profile(home);
      writeFileSync(existing, "# existing\n", "utf8");
      chmodSync(existing, mode);

      expect(writeTavilyCredentialToActiveShellProfile("mode-value", { home, shell: "/bin/bash" }).ok).toBe(true);
      expect(lstatSync(existing).mode & 0o777).toBe(0o600);
    }

    const freshHome = temporaryHome();
    expect(writeTavilyCredentialToActiveShellProfile("mode-value", { home: freshHome, shell: "/bin/bash" }).ok).toBe(true);
    expect(lstatSync(profile(freshHome)).mode & 0o777).toBe(0o600);
  });

  test("refuses an existing profile whose owner cannot be proven to be the effective user", () => {
    const home = temporaryHome();
    const target = profile(home);
    const original = "# existing\n";
    writeFileSync(target, original, "utf8");

    const result = writeTavilyCredentialToActiveShellProfile("owner-value", {
      home,
      shell: "/bin/bash",
      effects: {
        lstat(path) {
          const stat = lstatSync(path);
          if (path !== target) return stat;
          return Object.create(stat, {
            uid: { value: stat.uid + 1 },
          }) as Stats;
        },
      },
    });

    expect(result).toMatchObject({ ok: false, diagnosticCodes: ["profile-ownership-refused"] });
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(JSON.stringify(result)).not.toContain("owner-value");
  });

  test("refuses duplicate or malformed owned marker blocks without rewriting the profile", () => {
    const duplicateHome = temporaryHome();
    const duplicate = profile(duplicateHome);
    const malformedHome = temporaryHome();
    const malformed = profile(malformedHome);
    writeFileSync(duplicate, `${DECK_WEB_SEARCH_PROFILE_START}\nexport TAVILY_API_KEY='one'\n${DECK_WEB_SEARCH_PROFILE_END}\n${DECK_WEB_SEARCH_PROFILE_START}\nexport TAVILY_API_KEY='two'\n${DECK_WEB_SEARCH_PROFILE_END}\n`);
    writeFileSync(malformed, `${DECK_WEB_SEARCH_PROFILE_START}\nnot-an-export\n${DECK_WEB_SEARCH_PROFILE_END}\n`);
    const duplicateBefore = readFileSync(duplicate);
    const malformedBefore = readFileSync(malformed);

    const duplicateResult = writeTavilyCredentialToActiveShellProfile("ignored", { home: duplicateHome, shell: "/bin/bash" });
    const malformedResult = writeTavilyCredentialToActiveShellProfile("ignored", { home: malformedHome, shell: "/bin/bash" });

    expect(duplicateResult).toMatchObject({ ok: false, diagnosticCodes: ["profile-marker-duplicate"] });
    expect(malformedResult).toMatchObject({ ok: false, diagnosticCodes: ["profile-marker-malformed"] });
    expect(readFileSync(duplicate).equals(duplicateBefore)).toBe(true);
    expect(readFileSync(malformed).equals(malformedBefore)).toBe(true);
  });

  test("rejects symlink and non-regular profile targets", () => {
    const symlinkHome = temporaryHome();
    const targetHome = temporaryHome();
    const symlinkTarget = profile(targetHome);
    writeFileSync(symlinkTarget, "# target\n");
    symlinkSync(symlinkTarget, profile(symlinkHome));
    const directoryHome = temporaryHome();
    mkdirSync(profile(directoryHome));

    expect(writeTavilyCredentialToActiveShellProfile("ignored", { home: symlinkHome, shell: "/bin/bash" })).toMatchObject({
      ok: false,
      diagnosticCodes: ["profile-symlink-target"],
    });
    expect(writeTavilyCredentialToActiveShellProfile("ignored", { home: directoryHome, shell: "/bin/bash" })).toMatchObject({
      ok: false,
      diagnosticCodes: ["profile-unsafe-target"],
    });
  });

  test("refuses a concurrent target change and cleans a failed exclusive temp file", () => {
    const home = temporaryHome();
    const target = profile(home);
    writeFileSync(target, "# before\n");
    let temporaryPath = "";
    const concurrent = writeTavilyCredentialToActiveShellProfile("new-value", {
      home,
      shell: "/bin/bash",
      effects: {
        beforeRename(path) {
          writeFileSync(path, "# changed elsewhere\n");
        },
        tempPath(path) {
          temporaryPath = path;
          return path;
        },
      },
    });

    expect(concurrent).toMatchObject({ ok: false, diagnosticCodes: ["profile-concurrent-change"] });
    expect(readFileSync(target, "utf8")).toBe("# changed elsewhere\n");
    expect(existsSync(temporaryPath)).toBe(false);
  });

  test("leaves the original profile untouched and removes its private temp when atomic rename fails", () => {
    const home = temporaryHome();
    const target = profile(home);
    writeFileSync(target, "# original\n");
    let temporaryPath = "";

    const result = writeTavilyCredentialToActiveShellProfile("new-value", {
      home,
      shell: "/bin/bash",
      effects: {
        tempPath(path) {
          temporaryPath = path;
          return path;
        },
        rename() {
          throw new Error("test-only");
        },
      },
    });

    expect(result).toMatchObject({ ok: false, diagnosticCodes: ["profile-write-failed"] });
    expect(readFileSync(target, "utf8")).toBe("# original\n");
    expect(existsSync(temporaryPath)).toBe(false);
  });

  test("restores the preimage when post-rename verification fails without a concurrent target change", () => {
    const home = temporaryHome();
    const target = profile(home);
    const original = "# original\n";
    writeFileSync(target, original, "utf8");
    let poisonNextStat = false;

    const result = writeTavilyCredentialToActiveShellProfile("verification-value", {
      home,
      shell: "/bin/bash",
      effects: {
        afterRename() {
          poisonNextStat = true;
        },
        lstat(path) {
          const stat = lstatSync(path);
          if (path === target && poisonNextStat) {
            poisonNextStat = false;
            return Object.create(stat, { mtimeMs: { value: stat.mtimeMs + 1 } }) as Stats;
          }
          return stat;
        },
      },
    });

    expect(result).toMatchObject({ ok: false, status: "failed", credentialPresent: false, diagnosticCodes: ["profile-write-failed"] });
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(JSON.stringify(result)).not.toContain("verification-value");
  });

  test("reports possible credential persistence when concurrent bytes prevent post-rename rollback", () => {
    const home = temporaryHome();
    const target = profile(home);
    const concurrentBytes = "# changed elsewhere\n";
    const credential = "race-value";
    writeFileSync(target, "# original\n", "utf8");

    const result = writeTavilyCredentialToActiveShellProfile(credential, {
      home,
      shell: "/bin/bash",
      effects: {
        rename(source, destination) {
          renameSync(source, destination);
          writeFileSync(destination, concurrentBytes, "utf8");
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "manual-cleanup-required",
      credentialPresent: true,
      path: target,
      diagnosticCodes: ["profile-post-rename-rollback-conflict"],
    });
    expect(result.guidance).toContain("Deck-owned Web Search block");
    expect(readFileSync(target, "utf8")).toBe(concurrentBytes);
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  test("returns codes only and never includes rejected input in result diagnostics", () => {
    const home = temporaryHome();
    const forbidden = "line\nvalue";
    const result = writeTavilyCredentialToActiveShellProfile(forbidden, { home, shell: "/bin/bash" });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ ok: false, credentialPresent: false, diagnosticCodes: ["invalid-credential"] });
    expect(serialized.includes(forbidden)).toBe(false);
  });
});
