import { constants, chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
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
  update?(name: DeckSecretName, updater: (current: string | undefined) => string): DeckSecretWriteReceipt;
}>;

export function createOwnerOnlyFileSecretStore(input: { configHome: string }): DeckSecretStore {
  const configHome = resolve(input.configHome);
  const directory = join(configHome, "deck", "secrets");
  const resolveTarget = (name: DeckSecretName): string => {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error("Invalid secret name.");
    const target = resolve(directory, `${name}.secret`);
    assertContained(configHome, target);
    return target;
  };
  const readTarget = (target: string): string | undefined => {
    let fd: number | undefined;
    try {
      validateManagedAncestry(configHome, directory, false);
      validateSecretFile(target);
      fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      validateSecretStat(fstatSync(fd));
      return readFileSync(fd, "utf8");
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return undefined;
      throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const writeTarget = (target: string, value: string): DeckSecretWriteReceipt => {
    ensureOwnerOnlyDirectory(configHome, directory);
    validateExistingTarget(target);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        writeFileSync(fd, value, "utf8");
        validateSecretStat(fstatSync(fd));
      } finally {
        closeSync(fd);
      }
      renameSync(temp, target);
      chmodSync(target, 0o600);
      validateSecretFile(target);
    } catch (error) {
      try {
        if (existsSync(temp)) unlinkSync(temp);
      } catch {
        // best-effort cleanup only
      }
      throw error;
    }
    return receipt(target);
  };
  return {
    read(name) {
      try {
        return readTarget(resolveTarget(name));
      } catch (error) {
        throw new Error(redactSecretDiagnostic(error instanceof Error ? error.message : String(error)));
      }
    },
    write(name, value) {
      const target = resolveTarget(name);
      try {
        return writeTarget(target, value);
      } catch (error) {
        throw new Error(redactSecretDiagnostic(error instanceof Error ? error.message : String(error)));
      }
    },
    update(name, updater) {
      const target = resolveTarget(name);
      const lock = `${target}.lock`;
      try {
        ensureOwnerOnlyDirectory(configHome, directory);
        acquireLock(lock);
        try {
          return writeTarget(target, updater(readTarget(target)));
        } finally {
          unlinkSync(lock);
        }
      } catch (error) {
        throw new Error(redactSecretDiagnostic(error instanceof Error ? error.message : String(error)));
      }
    },
  };
}

export function redactSecretDiagnostic(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/sm_[A-Za-z0-9_-]+/g, "sm_[REDACTED]")
    .replace(/(?:api[_-]?key|token|secret|password)=?[^\s]*/gi, "[REDACTED_SECRET]");
}

function ensureOwnerOnlyDirectory(configHome: string, directory: string): void {
  if (!existsSync(configHome)) mkdirSync(configHome, { mode: 0o700 });
  validateConfigHome(configHome);
  const deckDirectory = join(configHome, "deck");
  mkdirSync(deckDirectory, { recursive: true, mode: 0o700 });
  validateDirectory(deckDirectory, false);
  chmodSync(deckDirectory, 0o700);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  validateDirectory(directory, false);
  chmodSync(directory, 0o700);
  validateManagedAncestry(configHome, directory, true);
}

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (relation.startsWith("..") || relation === "" || relation.includes("..")) throw new Error("Secret path escaped Deck config home.");
}

function validateManagedAncestry(configHome: string, directory: string, requireSecrets: boolean): void {
  validateConfigHome(configHome);
  validateDirectory(join(configHome, "deck"), true);
  if (requireSecrets || existsSync(directory)) validateDirectory(directory, true);
}

function validateConfigHome(path: string): void {
  const stat = validateDirectory(path, false);
  if ((stat.mode & 0o022) !== 0) throw new Error("Secret config home must not be writable by group or other users.");
}

function validateDirectory(path: string, ownerOnly: boolean): Stats {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Secret path ancestry contains a symbolic link.");
  if (!stat.isDirectory()) throw new Error("Secret path ancestry is not a directory.");
  validateOwner(stat);
  if (ownerOnly && (stat.mode & 0o077) !== 0) throw new Error("Secret directory must use owner-only permissions.");
  return stat;
}

function validateExistingTarget(path: string): void {
  try {
    validateSecretFile(path);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) throw error;
  }
}

function validateSecretFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Secret file must not be a symbolic link.");
  validateSecretStat(stat);
}

function validateSecretStat(stat: Stats): void {
  if (!stat.isFile()) throw new Error("Secret path must be a regular file.");
  validateOwner(stat);
  if ((stat.mode & 0o077) !== 0) throw new Error("Secret file must use owner-only permissions.");
}

function validateOwner(stat: Stats): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Secret path is not owned by the current user.");
  }
}

function acquireLock(path: string): void {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      closeSync(fd);
      return;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST") || Date.now() >= deadline) throw new Error("Secret store is busy; retry the operation.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

function receipt(target: string): DeckSecretWriteReceipt {
  return {
    backend: "owner-only-file",
    path: target,
    limitation: "Supermemory credential is filesystem-protected by an owner-only Deck secret file, not by hardware/keychain-backed storage.",
  };
}
