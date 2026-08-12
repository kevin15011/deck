import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprintSupermemoryProjectScope,
  resolveCanonicalSupermemoryProjectScope,
} from "./canonical-supermemory-project";

describe("canonical Supermemory project scope", () => {
  test("normalizes equivalent HTTPS, SSH, SCP, and SSH-alias GitHub remotes to one v1 scope", () => {
    const remotes = [
      "https://github.com/kevin15011/deck.git",
      "git@github.com:kevin15011/deck.git",
      "ssh://git@github.com/kevin15011/deck.git",
      "git@github-p:kevin15011/deck.git",
    ];

    const scopes = remotes.map((remote) => resolveCanonicalSupermemoryProjectScope({ projectRoot: "/repo/deck", remotes: [remote] }));

    expect(scopes.every((scope) => scope.ok)).toBe(true);
    expect(scopes.map((scope) => scope.ok ? scope.scope : "")).toEqual([
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
    ]);
    expect(scopes[3].ok && scopes[3].scope.includes("github-p")).toBe(false);
  });

  test("fails closed without falling back to directory basename or default scope", () => {
    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: "/repo/deck", remotes: [] });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SUPERMEMORY_PROJECT_IDENTITY_MISSING");
    expect(JSON.stringify(result)).not.toContain("sm_project_default");
    expect(JSON.stringify(result)).not.toContain("sm_project_deck");
  });

  test("rejects filesystem-like and malformed local path remotes", () => {
    for (const remote of ["/tmp/acme/repo.git", "../acme/repo.git", "file:///tmp/acme/repo.git", "not a remote"]) {
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: "/repo/deck", remotes: [remote] });
      expect(result.ok).toBe(false);
    }
  });

  test("uses verified project root to resolve origin when remotes are not supplied", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-scope-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github-p:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });

    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });

    expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
  });

  test("emits a redacted fingerprint rather than the raw project scope", () => {
    const fingerprint = fingerprintSupermemoryProjectScope("sm_project_v1_kevin15011_deck");

    expect(fingerprint).toMatch(/^smfp_[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("kevin15011");
    expect(fingerprint).not.toContain("deck");
  });
});
