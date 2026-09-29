import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOwnerOnlyFileSecretStore, redactSecretDiagnostic } from "./secret-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("owner-only Deck secret store fallback", () => {
  test("writes Supermemory API key atomically to 0700/0600 protected path", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-secret-store-"));
    roots.push(root);
    const store = createOwnerOnlyFileSecretStore({ configHome: root });

    const receipt = store.write("supermemory-api-key", "sm_secret_value");

    expect(receipt.backend).toBe("owner-only-file");
    expect(receipt.limitation).toContain("filesystem-protected");
    expect(existsSync(receipt.path)).toBe(true);
    expect(statSync(join(root, "deck", "secrets")).mode & 0o777).toBe(0o700);
    expect(statSync(receipt.path).mode & 0o777).toBe(0o600);
    expect(readFileSync(receipt.path, "utf8")).toBe("sm_secret_value");
    expect(store.read("supermemory-api-key")).toBe("sm_secret_value");
  });

  test("diagnostics redact secret values and paths are constrained under config home", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-secret-store-"));
    roots.push(root);
    const store = createOwnerOnlyFileSecretStore({ configHome: root });

    expect(() => store.write("../escape", "secret")).toThrow("Invalid secret name");
    expect(redactSecretDiagnostic("failed for sm_secret_value Authorization: Bearer token")).not.toContain("sm_secret_value");
    expect(redactSecretDiagnostic("failed for sm_secret_value Authorization: Bearer token")).not.toContain("token");
  });

  test("rejects symlinks, non-regular targets, and unsafe permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-secret-store-"));
    const outside = mkdtempSync(join(tmpdir(), "deck-secret-outside-"));
    roots.push(root, outside);
    mkdirSync(join(root, "deck", "secrets"), { recursive: true, mode: 0o700 });
    writeFileSync(join(outside, "value"), "sm_outside", { mode: 0o600 });
    symlinkSync(join(outside, "value"), join(root, "deck", "secrets", "linked.secret"));
    expect(() => createOwnerOnlyFileSecretStore({ configHome: root }).read("linked")).toThrow(/symbolic link|regular file/);

    rmSync(join(root, "deck", "secrets", "linked.secret"));
    mkdirSync(join(root, "deck", "secrets", "directory.secret"));
    expect(() => createOwnerOnlyFileSecretStore({ configHome: root }).read("directory")).toThrow(/regular file/);

    writeFileSync(join(root, "deck", "secrets", "open.secret"), "sm_open", { mode: 0o666 });
    chmodSync(join(root, "deck", "secrets", "open.secret"), 0o666);
    expect(() => createOwnerOnlyFileSecretStore({ configHome: root }).read("open")).toThrow(/owner-only permissions/);
  });

  test("rejects a symlink in the managed directory ancestry", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-secret-store-"));
    const outside = mkdtempSync(join(tmpdir(), "deck-secret-outside-"));
    roots.push(root, outside);
    mkdirSync(join(root, "deck"), { mode: 0o700 });
    symlinkSync(outside, join(root, "deck", "secrets"));

    expect(() => createOwnerOnlyFileSecretStore({ configHome: root }).write("profile", "sm_secret"))
      .toThrow(/symbolic link/);
  });

  test("accepts an owned readable config root but rejects group/world writable roots", () => {
    const readableRoot = mkdtempSync(join(tmpdir(), "deck-secret-store-readable-"));
    const groupWritableRoot = mkdtempSync(join(tmpdir(), "deck-secret-store-group-writable-"));
    const worldWritableRoot = mkdtempSync(join(tmpdir(), "deck-secret-store-world-writable-"));
    roots.push(readableRoot, groupWritableRoot, worldWritableRoot);

    chmodSync(readableRoot, 0o755);
    if (typeof process.getuid === "function") expect(statSync(readableRoot).uid).toBe(process.getuid());
    expect(createOwnerOnlyFileSecretStore({ configHome: readableRoot }).write("profile", "sm_secret").backend)
      .toBe("owner-only-file");

    chmodSync(groupWritableRoot, 0o770);
    expect(() => createOwnerOnlyFileSecretStore({ configHome: groupWritableRoot }).write("profile", "sm_secret"))
      .toThrow(/config home.*writable/i);

    chmodSync(worldWritableRoot, 0o707);
    expect(() => createOwnerOnlyFileSecretStore({ configHome: worldWritableRoot }).read("profile"))
      .toThrow(/config home.*writable/i);
  });
});
