import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

import { parseRegistryDocumentPairV1, registryDocumentDigestV1 } from "@deck/core/spec-registry";

import {
  applyRegistryDocumentEditsV1,
  classifyRegistryRecoveryV1,
  markRegistryTransactionCommittedV1,
  parseRegistryPairTransactionV1,
} from "./registry-transaction";
import type {
  RegistryArtifactInspectionV1,
  RegistryPairCommitRequestV1,
  RegistryPairSnapshotV1,
  RegistryPairStoreAdapterV1,
  RegistryPairStoreResultV1,
} from "./registry-pair-store";

export interface RegistryFileStatV1 {
  readonly exists: boolean;
  readonly mode?: number;
  readonly directory?: boolean;
}

export interface RegistryFileSystemPortV1 {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string, options?: { readonly exclusive?: boolean; readonly mode?: number }): Promise<void>;
  fsyncFile(path: string): Promise<void>;
  fsyncDirectory(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<RegistryFileStatV1>;
  chmod(path: string, mode: number): Promise<void>;
  processAlive(pid: number): Promise<boolean>;
  now(): number;
  pid(): number;
}

export interface FileSystemRegistryStoreOptionsV1 {
  readonly projectRoot: string;
  readonly runtimeStateRoot?: string;
  readonly lockTtlMs?: number;
  readonly fileSystem?: RegistryFileSystemPortV1;
}

interface LockRecordV1 {
  readonly schema: "registry-lock-v1";
  readonly changeId: string;
  readonly transactionId: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly expiresAt: number;
}

const complete = (code: RegistryPairStoreResultV1["code"], reason: RegistryPairStoreResultV1["reason"] = "none"):
  RegistryPairStoreResultV1 => Object.freeze({ code, reason });

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

function validChangeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(value);
}

function validTransactionId(value: string): boolean {
  return /^[A-Za-z0-9:._-]{1,200}$/.test(value);
}

export function createNodeRegistryFileSystemPortV1(): RegistryFileSystemPortV1 {
  return {
    mkdir: async (path) => { await fs.mkdir(path, { recursive: true }); },
    readFile: (path) => fs.readFile(path, "utf8"),
    writeFile: async (path, content, options) => {
      await fs.writeFile(path, content, { encoding: "utf8", flag: options?.exclusive ? "wx" : "w", mode: options?.mode });
    },
    fsyncFile: async (path) => { const handle = await fs.open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } },
    fsyncDirectory: async (path) => { const handle = await fs.open(path, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } },
    rename: (from, to) => fs.rename(from, to),
    remove: async (path) => { await fs.rm(path, { force: true }); },
    stat: async (path) => {
      try {
        const value = await fs.stat(path);
        return { exists: true, mode: value.mode & 0o777, directory: value.isDirectory() };
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { exists: false };
        throw error;
      }
    },
    chmod: (path, mode) => fs.chmod(path, mode),
    processAlive: async (pid) => {
      try { process.kill(pid, 0); return true; } catch (error) { return errorCode(error) === "EPERM"; }
    },
    now: () => Date.now(),
    pid: () => process.pid,
  };
}

export function createFileSystemRegistryStoreV1(options: FileSystemRegistryStoreOptionsV1): RegistryPairStoreAdapterV1 {
  const io = options.fileSystem ?? createNodeRegistryFileSystemPortV1();
  const projectRoot = resolve(options.projectRoot);
  const runtimeRoot = resolve(options.runtimeStateRoot ?? join(projectRoot, ".deck", "runtime", "spec-registry"));
  const lockTtlMs = options.lockTtlMs ?? 30_000;
  if (!Number.isFinite(lockTtlMs) || lockTtlMs <= 0 || lockTtlMs > 300_000) throw new Error("invalid-evidence");

  const runtimeDirectory = (changeId: string) => join(runtimeRoot, changeId);
  const lockPath = (changeId: string) => join(runtimeDirectory(changeId), "writer.lock");
  const journalPath = (changeId: string) => join(runtimeDirectory(changeId), "transaction.json");
  const journalTempPath = (changeId: string) => join(runtimeDirectory(changeId), "transaction.tmp");

  async function changeDirectory(changeId: string): Promise<string> {
    if (!validChangeId(changeId)) throw new Error("invalid-evidence");
    const active = join(projectRoot, "openspec", "changes", changeId);
    if ((await io.stat(active)).directory) return active;
    const archived = join(projectRoot, "openspec", "archive", changeId);
    if ((await io.stat(archived)).directory) return archived;
    throw new Error("invalid-evidence");
  }

  async function rawRead(changeId: string): Promise<RegistryPairSnapshotV1> {
    const directory = await changeDirectory(changeId);
    const statePath = join(directory, "state.yaml"), eventsPath = join(directory, "events.yaml");
    const [stateSource, eventsSource, stateStat, eventsStat] = await Promise.all([
      io.readFile(statePath), io.readFile(eventsPath), io.stat(statePath), io.stat(eventsPath),
    ]);
    if (!stateStat.exists || !eventsStat.exists || stateStat.mode === undefined || eventsStat.mode === undefined) throw new Error("invalid-evidence");
    return Object.freeze({
      changeId,
      changeDirectory: directory,
      stateSource,
      eventsSource,
      stateDigest: registryDocumentDigestV1(stateSource),
      eventsDigest: registryDocumentDigestV1(eventsSource),
      stateMode: stateStat.mode,
      eventsMode: eventsStat.mode,
    });
  }

  async function inspectJournal(changeId: string): Promise<RegistryPairCommitRequestV1 | undefined> {
    if (!(await io.stat(journalPath(changeId))).exists) return undefined;
    try { return parseRegistryPairTransactionV1(JSON.parse(await io.readFile(journalPath(changeId)))); }
    catch { throw new Error("journal-invalid"); }
  }

  async function acquire(changeId: string, transactionId: string): Promise<LockRecordV1> {
    await io.mkdir(runtimeDirectory(changeId));
    const now = io.now();
    const lock: LockRecordV1 = Object.freeze({
      schema: "registry-lock-v1",
      changeId,
      transactionId,
      pid: io.pid(),
      startedAt: now,
      expiresAt: now + lockTtlMs,
    });
    let created = false;
    try {
      await io.writeFile(lockPath(changeId), `${JSON.stringify(lock)}\n`, { exclusive: true, mode: 0o600 });
      created = true;
      await io.fsyncFile(lockPath(changeId));
      await io.fsyncDirectory(runtimeDirectory(changeId));
      return lock;
    } catch (error) {
      if (created) {
        try { await io.remove(lockPath(changeId)); } catch {}
      }
      if (errorCode(error) !== "EEXIST") throw error;
    }
    let existing: LockRecordV1;
    try {
      existing = JSON.parse(await io.readFile(lockPath(changeId))) as LockRecordV1;
      if (existing.schema !== "registry-lock-v1" || existing.changeId !== changeId || !validTransactionId(existing.transactionId) ||
        !Number.isInteger(existing.pid) || existing.pid <= 0 || !Number.isFinite(existing.startedAt) ||
        !Number.isFinite(existing.expiresAt) || existing.expiresAt < existing.startedAt) throw new Error("invalid");
      await inspectJournal(changeId);
    } catch {
      throw new Error("stale-lock-invalid");
    }
    if (existing.expiresAt > now || await io.processAlive(existing.pid)) throw new Error("lock-contention");
    await io.remove(lockPath(changeId));
    await io.fsyncDirectory(runtimeDirectory(changeId));
    await io.writeFile(lockPath(changeId), `${JSON.stringify(lock)}\n`, { exclusive: true, mode: 0o600 });
    await io.fsyncFile(lockPath(changeId));
    await io.fsyncDirectory(runtimeDirectory(changeId));
    return lock;
  }

  async function release(changeId: string, lock: LockRecordV1): Promise<void> {
    try {
      const current = JSON.parse(await io.readFile(lockPath(changeId))) as LockRecordV1;
      if (current.transactionId === lock.transactionId && current.pid === lock.pid) {
        try { await io.remove(lockPath(changeId)); } catch { await io.remove(lockPath(changeId)); }
        await io.fsyncDirectory(runtimeDirectory(changeId));
      }
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }

  function temporaryPaths(transaction: RegistryPairCommitRequestV1, directory: string) {
    return {
      state: join(directory, `.deck-registry-${transaction.transactionId}-state.tmp`),
      events: join(directory, `.deck-registry-${transaction.transactionId}-events.tmp`),
    };
  }

  async function writeJournal(changeId: string, transaction: RegistryPairCommitRequestV1): Promise<void> {
    const temporary = journalTempPath(changeId);
    await io.writeFile(temporary, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
    await io.chmod(temporary, 0o600);
    await io.fsyncFile(temporary);
    await io.rename(temporary, journalPath(changeId));
    await io.fsyncDirectory(runtimeDirectory(changeId));
  }

  async function replaceTarget(path: string, temporary: string, source: string, mode: number): Promise<void> {
    await io.writeFile(temporary, source, { mode });
    await io.chmod(temporary, mode);
    await io.fsyncFile(temporary);
    await io.rename(temporary, path);
    await io.fsyncDirectory(dirname(path));
  }

  async function requireDocumentDigest(path: string, expected: `sha256:${string}`): Promise<void> {
    if (registryDocumentDigestV1(await io.readFile(path)) !== expected) throw new Error("third-digest");
  }

  function renderTransactionTargets(snapshot: RegistryPairSnapshotV1, transaction: RegistryPairCommitRequestV1) {
    const stateSource = snapshot.stateDigest === transaction.next.stateDigest
      ? snapshot.stateSource
      : applyRegistryDocumentEditsV1(snapshot.stateSource, transaction.target.stateEdits, "state");
    const eventsSource = snapshot.eventsDigest === transaction.next.eventsDigest
      ? snapshot.eventsSource
      : applyRegistryDocumentEditsV1(snapshot.eventsSource, transaction.target.eventsEdits, "events");
    if (registryDocumentDigestV1(stateSource) !== transaction.next.stateDigest ||
      registryDocumentDigestV1(eventsSource) !== transaction.next.eventsDigest) throw new Error("journal-invalid");
    const pair = parseRegistryDocumentPairV1({ stateSource, eventsSource, expectedChangeId: transaction.changeId });
    if (!pair.writable) throw new Error("journal-invalid");
    return { stateSource, eventsSource };
  }

  async function cleanup(changeId: string, transaction: RegistryPairCommitRequestV1, directory: string): Promise<void> {
    const temporary = temporaryPaths(transaction, directory);
    await io.remove(temporary.state);
    await io.remove(temporary.events);
    await io.remove(journalTempPath(changeId));
    await io.remove(journalPath(changeId));
    await io.fsyncDirectory(runtimeDirectory(changeId));
  }

  async function recover(changeId: string): Promise<RegistryPairStoreResultV1> {
    if (!validChangeId(changeId)) return complete("registry-recovery-required", "journal-invalid");
    try {
      if (!(await io.stat(journalPath(changeId))).exists) return complete("none");
    } catch {
      return complete("registry-recovery-required", "io-interrupted");
    }
    let lock: LockRecordV1 | undefined;
    try {
      lock = await acquire(changeId, `recovery-${io.now()}`);
      const transaction = await inspectJournal(changeId);
      if (!transaction || transaction.changeId !== changeId) return complete("registry-recovery-required", "journal-invalid");
      const snapshot = await rawRead(changeId);
      for (const expectedArtifact of transaction.artifacts ?? [transaction.artifact]) {
        const artifact = await inspectArtifact(changeId, expectedArtifact.path);
        if (!artifact.exists || artifact.digest !== expectedArtifact.digest) {
          return complete("registry-recovery-required", "artifact-mismatch");
        }
      }
      const action = classifyRegistryRecoveryV1(snapshot, transaction);
      if (action === "conflict") return complete("registry-intent-conflict", "third-digest");
      const target = renderTransactionTargets(snapshot, transaction);
      const paths = temporaryPaths(transaction, snapshot.changeDirectory);
      if (action === "roll-forward-both" || action === "roll-forward-state") {
        await requireDocumentDigest(join(snapshot.changeDirectory, "state.yaml"), transaction.base.stateDigest);
        await replaceTarget(join(snapshot.changeDirectory, "state.yaml"), paths.state, target.stateSource, transaction.fileMode.state);
        await requireDocumentDigest(join(snapshot.changeDirectory, "state.yaml"), transaction.next.stateDigest);
      }
      if (action === "roll-forward-both" || action === "roll-forward-events") {
        await requireDocumentDigest(join(snapshot.changeDirectory, "events.yaml"), transaction.base.eventsDigest);
        await replaceTarget(join(snapshot.changeDirectory, "events.yaml"), paths.events, target.eventsSource, transaction.fileMode.events);
        await requireDocumentDigest(join(snapshot.changeDirectory, "events.yaml"), transaction.next.eventsDigest);
      }
      if (classifyRegistryRecoveryV1(await rawRead(changeId), transaction) !== "finalize") {
        return complete("registry-intent-conflict", "third-digest");
      }
      await writeJournal(changeId, markRegistryTransactionCommittedV1(transaction));
      await cleanup(changeId, transaction, snapshot.changeDirectory);
      return complete("recovered");
    } catch (error) {
      const message = error instanceof Error ? error.message : "io-interrupted";
      if (message === "lock-contention" || message === "stale-lock-invalid" || message === "journal-invalid") {
        return complete("registry-recovery-required", message);
      }
      if (message === "third-digest") return complete("registry-intent-conflict", "third-digest");
      return complete("registry-recovery-required", "io-interrupted");
    } finally {
      if (lock) {
        try { await release(changeId, lock); } catch {}
      }
    }
  }

  async function read(changeId: string): Promise<RegistryPairSnapshotV1> {
    const recovery = await recover(changeId);
    if (recovery.code === "registry-intent-conflict" || recovery.code === "registry-recovery-required") {
      throw new Error(recovery.code);
    }
    let lock: LockRecordV1 | undefined;
    try {
      lock = await acquire(changeId, `read-${io.pid()}-${io.now()}`);
      if (await inspectJournal(changeId)) throw new Error("registry-recovery-required");
      return await rawRead(changeId);
    } catch (error) {
      if (error instanceof Error && error.message === "registry-intent-conflict") throw error;
      throw new Error("registry-recovery-required");
    } finally {
      if (lock) {
        try { await release(changeId, lock); } catch {}
      }
    }
  }

  async function inspectArtifact(changeId: string, artifactPath: string): Promise<RegistryArtifactInspectionV1> {
    const directory = await changeDirectory(changeId);
    const path = resolve(directory, artifactPath);
    const fromChange = relative(directory, path);
    if (!fromChange || fromChange.startsWith("..") || resolve(directory, fromChange) !== path) return Object.freeze({ exists: false });
    const status = await io.stat(path);
    if (!status.exists || status.directory) return Object.freeze({ exists: false });
    const digest = `sha256:${createHash("sha256").update(await io.readFile(path), "utf8").digest("hex")}` as const;
    return Object.freeze({ exists: true, digest });
  }

  async function commit(transaction: RegistryPairCommitRequestV1): Promise<RegistryPairStoreResultV1> {
    let parsed: RegistryPairCommitRequestV1;
    try { parsed = parseRegistryPairTransactionV1(transaction); }
    catch { return complete("registry-recovery-required", "journal-invalid"); }
    let recovery: RegistryPairStoreResultV1;
    try { recovery = await recover(parsed.changeId); }
    catch { return complete("registry-recovery-required", "io-interrupted"); }
    if (recovery.code === "registry-intent-conflict" || recovery.code === "registry-recovery-required") return recovery;
    let lock: LockRecordV1 | undefined;
    try {
      if (parsed.status !== "prepared") return complete("registry-recovery-required", "journal-invalid");
      lock = await acquire(parsed.changeId, parsed.transactionId);
      const snapshot = await rawRead(parsed.changeId);
      for (const expectedArtifact of parsed.artifacts ?? [parsed.artifact]) {
        const artifact = await inspectArtifact(parsed.changeId, expectedArtifact.path);
        if (!artifact.exists || artifact.digest !== expectedArtifact.digest) return complete("registry-recovery-required", "artifact-mismatch");
      }
      const action = classifyRegistryRecoveryV1(snapshot, parsed);
      if (action === "finalize") return complete("replayed");
      if (action !== "roll-forward-both") return complete("registry-intent-conflict", "third-digest");
      const target = renderTransactionTargets(snapshot, parsed);
      await writeJournal(parsed.changeId, parsed);
      const paths = temporaryPaths(parsed, snapshot.changeDirectory);
      await requireDocumentDigest(join(snapshot.changeDirectory, "state.yaml"), parsed.base.stateDigest);
      await replaceTarget(join(snapshot.changeDirectory, "state.yaml"), paths.state, target.stateSource, parsed.fileMode.state);
      await requireDocumentDigest(join(snapshot.changeDirectory, "state.yaml"), parsed.next.stateDigest);
      await requireDocumentDigest(join(snapshot.changeDirectory, "events.yaml"), parsed.base.eventsDigest);
      await replaceTarget(join(snapshot.changeDirectory, "events.yaml"), paths.events, target.eventsSource, parsed.fileMode.events);
      await requireDocumentDigest(join(snapshot.changeDirectory, "events.yaml"), parsed.next.eventsDigest);
      if (classifyRegistryRecoveryV1(await rawRead(parsed.changeId), parsed) !== "finalize") {
        return complete("registry-intent-conflict", "third-digest");
      }
      await writeJournal(parsed.changeId, markRegistryTransactionCommittedV1(parsed));
      await cleanup(parsed.changeId, parsed, snapshot.changeDirectory);
      return complete("committed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "io-interrupted";
      if (message === "lock-contention" || message === "stale-lock-invalid") return complete("registry-recovery-required", message);
      if (message === "third-digest") return complete("registry-intent-conflict", "third-digest");
      if (message === "registry-recovery-required" || message === "journal-invalid") return complete("registry-recovery-required", "journal-invalid");
      return complete("registry-recovery-required", "io-interrupted");
    } finally {
      if (lock) {
        try { await release(parsed.changeId, lock); } catch {}
      }
    }
  }

  return Object.freeze({ read, inspectArtifact, commit, recover });
}
