import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
});
