import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type DeckSecretName = "supermemory-api-key" | (string & {});

export type DeckSecretWriteReceipt = Readonly<{
  backend: "owner-only-file";
  path: string;
  limitation: string;
}>;

export type DeckSecretStore = Readonly<{
  write(name: DeckSecretName, value: string): DeckSecretWriteReceipt;
  read(name: DeckSecretName): string | undefined;
}>;

export function createOwnerOnlyFileSecretStore(input: { configHome: string }): DeckSecretStore {
  const configHome = resolve(input.configHome);
  const directory = join(configHome, "deck", "secrets");
  return {
    read(name) {
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error("Invalid secret name.");
      const target = resolve(directory, `${name}.secret`);
      assertContained(configHome, target);
      try {
        validateOwner(directory);
        validateOwner(target);
        return readFileSync(target, "utf8");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return undefined;
        throw new Error(redactSecretDiagnostic(error instanceof Error ? error.message : String(error)));
      }
    },
    write(name, value) {
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error("Invalid secret name.");
      const target = resolve(directory, `${name}.secret`);
      assertContained(configHome, target);
      ensureOwnerOnlyDirectory(directory);
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        const fd = openSync(temp, "wx", 0o600);
        try {
          writeFileSync(fd, value, "utf8");
        } finally {
          closeSync(fd);
        }
        renameSync(temp, target);
        chmodIfAvailable(target, 0o600);
      } catch (error) {
        try {
          if (existsSync(temp)) unlinkSync(temp);
        } catch {
          // best-effort cleanup only
        }
        throw new Error(redactSecretDiagnostic(error instanceof Error ? error.message : String(error)));
      }
      return {
        backend: "owner-only-file",
        path: target,
        limitation: "Supermemory credential is filesystem-protected by an owner-only Deck secret file, not by hardware/keychain-backed storage.",
      };
    },
  };
}

export function redactSecretDiagnostic(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/sm_[A-Za-z0-9_-]+/g, "sm_[REDACTED]")
    .replace(/(?:api[_-]?key|token|secret|password)=?[^\s]*/gi, "[REDACTED_SECRET]");
}

function ensureOwnerOnlyDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodIfAvailable(directory, 0o700);
  validateOwner(directory);
}

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (relation.startsWith("..") || relation === "" || relation.includes("..")) throw new Error("Secret path escaped Deck config home.");
}

function validateOwner(path: string): void {
  if (typeof process.getuid !== "function") return;
  try {
    const stat = lstatSync(realpathSync(path));
    if (stat.uid !== process.getuid()) throw new Error("Secret path is not owned by the current user.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("not owned")) throw error;
  }
}

function chmodIfAvailable(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // chmod is unavailable on some platforms; Doctor discloses filesystem fallback limitations.
  }
}
