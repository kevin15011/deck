import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";

import type { CodexMutation, CodexMutationPlan, CodexPreimage } from "./types";

export const NODE_PATH_CAS_RESIDUAL_RISK = "Node/Bun do not expose renameat2/openat path-resolution guards; Deck revalidates every ancestor and the target immediately before atomic rename, but a privileged concurrent actor can still race pathname resolution.";

export type CodexInspectedFile = {
  content: string;
  mode?: number;
  kind?: "file" | "symlink" | "directory";
};

export type CodexJournalEntry = {
  mutation: CodexMutation;
  preimage: CodexInspectedFile | null;
  state: "prepared" | "writing" | "applied" | "verified" | "rolling-back" | "rolled-back" | "conflict";
  error?: string;
};

export type CodexTransactionJournal = {
  version: 2;
  id: string;
  operationId?: string;
  operationKind?: string;
  projectRoot: string;
  createdAt: number;
  updatedAt: number;
  state: "prepared" | "applying" | "verified" | "rollback" | "rolled-back" | "conflict";
  entries: CodexJournalEntry[];
};

export type CodexRollbackResult = {
  status: "rolled-back" | "conflict";
  journalId: string;
  conflicts: readonly string[];
};

export type CodexRecoveryResult =
  | { status: "already-complete"; journal: CodexTransactionJournal }
  | { status: "recovered" | "conflict"; journal: CodexTransactionJournal; rollback: CodexRollbackResult };

export type CodexWriteGuard = { projectRoot: string; expected: CodexPreimage };

export type CodexFileEffects = {
  inspect(absolutePath: string): Promise<CodexInspectedFile | null>;
  writeAtomic(absolutePath: string, content: string, mode: number, guard: CodexWriteGuard): Promise<void>;
  remove(absolutePath: string, guard: { projectRoot: string; expectedHash: string }): Promise<void>;
  persistJournalAtomic(journal: CodexTransactionJournal): Promise<void>;
  readJournal(id: string): Promise<CodexTransactionJournal | null>;
  listJournals(): Promise<readonly CodexTransactionJournal[]>;
  pruneJournals?(): Promise<void>;
  createTransactionId(): string;
  now(): number;
};

export class CodexTransactionError extends Error {
  readonly journalId: string;
  readonly rollback: CodexRollbackResult;
  constructor(message: string, journalId: string, rollback: CodexRollbackResult) {
    super(message);
    this.name = "CodexTransactionError";
    this.journalId = journalId;
    this.rollback = rollback;
  }
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function target(projectRoot: string, relativePath: string): string {
  const root = resolve(projectRoot);
  const absolute = resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error(`Path escapes project root: ${relativePath}`);
  return absolute;
}

function assertPreimage(mutation: CodexMutation, file: CodexInspectedFile | null): void {
  if (file?.kind === "symlink") throw new Error(`Unsafe symlink target: ${mutation.relativePath}`);
  if (file && file.kind && file.kind !== "file") throw new Error(`Target is not a regular file: ${mutation.relativePath}`);
  if (mutation.expected.kind === "absent" && file !== null) throw new Error(`Plan-time preimage changed: ${mutation.relativePath}`);
  if (mutation.expected.kind === "file" && (file === null || hash(file.content) !== mutation.expected.hash || (file.mode ?? 0o644) !== mutation.expected.mode)) {
    throw new Error(`Plan-time preimage changed: ${mutation.relativePath}`);
  }
}

async function assertSafeAncestors(projectRoot: string, absolutePath: string, effects: CodexFileEffects): Promise<void> {
  const rootInspection = await effects.inspect(resolve(projectRoot));
  if (rootInspection?.kind === "symlink") throw new Error(`Unsafe symlink project root: ${projectRoot}`);
  if (rootInspection?.kind === "file") throw new Error(`Project root is not a directory: ${projectRoot}`);
  const segments = relative(resolve(projectRoot), dirname(absolutePath)).split(sep).filter(Boolean);
  let current = resolve(projectRoot);
  for (const segment of segments) {
    current = resolve(current, segment);
    const inspected = await effects.inspect(current);
    if (inspected?.kind === "symlink") throw new Error(`Unsafe symlink ancestor: ${current}`);
    if (inspected?.kind === "file") throw new Error(`Non-directory ancestor: ${current}`);
  }
}

async function persist(journal: CodexTransactionJournal, effects: CodexFileEffects): Promise<void> {
  journal.updatedAt = effects.now();
  await effects.persistJournalAtomic(structuredClone(journal));
}

export async function applyCodexMutationPlan(
  plan: CodexMutationPlan,
  effects: CodexFileEffects,
  options: { autoRollback?: boolean; journalId?: string; operationId?: string; operationKind?: string } = {},
) {
  if (plan.blocked) throw new Error("Blocked Codex mutation plan cannot be applied.");
  for (const mutation of plan.mutations) {
    if (mutation.operation !== "delete" && hash(mutation.content) !== mutation.postimageHash) throw new Error(`Invalid postimage hash: ${mutation.relativePath}`);
  }
  const now = effects.now();
  const journal: CodexTransactionJournal = {
    version: 2,
    id: options.journalId ?? effects.createTransactionId(),
    operationId: options.operationId,
    operationKind: options.operationKind,
    projectRoot: plan.projectRoot,
    createdAt: now,
    updatedAt: now,
    state: "prepared",
    entries: [],
  };
  for (const mutation of plan.mutations) {
    const absolute = target(plan.projectRoot, mutation.relativePath);
    await assertSafeAncestors(plan.projectRoot, absolute, effects);
    const preimage = await effects.inspect(absolute);
    const entry: CodexJournalEntry = { mutation, preimage, state: "prepared" };
    journal.entries.push(entry);
    try {
      assertPreimage(mutation, preimage);
    } catch (error) {
      entry.state = "conflict";
      entry.error = error instanceof Error ? error.message : `Plan-time preimage changed: ${mutation.relativePath}`;
      journal.state = "conflict";
      await persist(journal, effects);
      throw new CodexTransactionError(entry.error, journal.id, {
        status: "conflict",
        journalId: journal.id,
        conflicts: [mutation.relativePath],
      });
    }
  }
  await persist(journal, effects);

  try {
    // One durable transaction-level intent covers every mutation. Recovery can
    // distinguish applied, untouched, and externally changed paths from the
    // journaled preimages/postimages, so per-file journal rewrites add no safety.
    journal.state = "applying";
    for (const entry of journal.entries) entry.state = "writing";
    await persist(journal, effects);

    for (const entry of journal.entries) {
      const absolute = target(plan.projectRoot, entry.mutation.relativePath);
      await assertSafeAncestors(plan.projectRoot, absolute, effects);
      try {
        assertPreimage(entry.mutation, await effects.inspect(absolute));
      } catch (error) {
        entry.state = "conflict";
        entry.error = error instanceof Error ? error.message : `Plan-time preimage changed: ${entry.mutation.relativePath}`;
        journal.state = "conflict";
        await persist(journal, effects);
        throw error;
      }
      if (entry.mutation.operation === "delete") {
        if (entry.mutation.expected.kind !== "file") throw new Error(`Delete requires a file preimage: ${entry.mutation.relativePath}`);
        await effects.remove(absolute, { projectRoot: plan.projectRoot, expectedHash: entry.mutation.expected.hash });
      } else {
        await effects.writeAtomic(absolute, entry.mutation.content, entry.mutation.postimageMode, {
          projectRoot: plan.projectRoot,
          expected: entry.mutation.expected,
        });
      }
      const installed = await effects.inspect(absolute);
      const verified = entry.mutation.operation === "delete"
        ? installed === null
        : installed !== null && installed.kind !== "symlink" && installed.kind !== "directory" && hash(installed.content) === entry.mutation.postimageHash;
      if (!verified) throw new Error(`Post-write verification failed: ${entry.mutation.relativePath}`);
      entry.state = "verified";
    }
    journal.state = "verified";
    await persist(journal, effects);
    await effects.pruneJournals?.();
    return { status: "verified" as const, journal };
  } catch (error) {
    if (options.autoRollback === false) throw error;
    const rollback = await rollbackCodexTransaction(journal, effects);
    throw new CodexTransactionError(error instanceof Error ? error.message : "Codex transaction failed.", journal.id, rollback);
  }
}

export async function rollbackCodexTransaction(journal: CodexTransactionJournal, effects: CodexFileEffects): Promise<CodexRollbackResult> {
  const conflicts: string[] = [];
  const pending: Array<{ entry: CodexJournalEntry; absolute: string }> = [];

  for (const entry of [...journal.entries].reverse()) {
    if (entry.state === "prepared" || entry.state === "rolled-back") continue;
    const absolute = target(journal.projectRoot, entry.mutation.relativePath);
    await assertSafeAncestors(journal.projectRoot, absolute, effects);
    const current = await effects.inspect(absolute);
    const restoredPreimage = entry.mutation.rollback === "restore"
      && entry.preimage !== null
      && current?.kind !== "symlink"
      && current?.kind !== "directory"
      && current !== null
      && hash(current.content) === hash(entry.preimage.content)
      && (current.mode ?? 0o644) === (entry.preimage.mode ?? 0o644);
    const deletedCreatedFile = entry.mutation.operation !== "delete" && entry.mutation.rollback === "delete" && current === null;
    if (restoredPreimage || deletedCreatedFile) {
      entry.state = "rolled-back";
      delete entry.error;
      continue;
    }
    const deletedPostimage = entry.mutation.operation === "delete" && current === null;
    const writtenPostimage = entry.mutation.operation !== "delete" && current?.kind === "file" && hash(current.content) === entry.mutation.postimageHash;
    if (!deletedPostimage && !writtenPostimage) {
      entry.state = "conflict";
      entry.error = "Current bytes do not match the installed postimage or restored preimage.";
      conflicts.push(entry.mutation.relativePath);
      continue;
    }
    entry.state = "rolling-back";
    pending.push({ entry, absolute });
  }

  // Persist every rollback intent together before changing any bytes. A crash
  // leaves enough preimage/postimage evidence to resume each path idempotently.
  journal.state = conflicts.length > 0 ? "conflict" : "rollback";
  await persist(journal, effects);

  for (const { entry, absolute } of pending) {
    if (entry.mutation.operation === "delete" && entry.preimage) {
      await effects.writeAtomic(absolute, entry.preimage.content, entry.preimage.mode ?? 0o644, {
        projectRoot: journal.projectRoot,
        expected: { kind: "absent" },
      });
    } else if (entry.mutation.rollback === "delete") {
      await effects.remove(absolute, { projectRoot: journal.projectRoot, expectedHash: entry.mutation.postimageHash });
    } else if (entry.preimage) {
      await effects.writeAtomic(absolute, entry.preimage.content, entry.preimage.mode ?? 0o644, {
        projectRoot: journal.projectRoot,
        expected: { kind: "file", hash: entry.mutation.postimageHash, mode: entry.mutation.postimageMode },
      });
    }
    entry.state = "rolled-back";
    delete entry.error;
  }

  journal.state = conflicts.length > 0 ? "conflict" : "rolled-back";
  await persist(journal, effects);
  if (journal.state === "rolled-back") await effects.pruneJournals?.();
  return { status: conflicts.length > 0 ? "conflict" : "rolled-back", journalId: journal.id, conflicts };
}

export async function reopenCodexTransaction(id: string, effects: CodexFileEffects): Promise<CodexTransactionJournal> {
  const journal = await effects.readJournal(id);
  if (!journal || journal.version !== 2 || journal.id !== id) throw new Error(`Codex transaction journal not found or invalid: ${id}`);
  return journal;
}

export async function recoverCodexTransaction(id: string, effects: CodexFileEffects): Promise<CodexRecoveryResult> {
  const journal = await reopenCodexTransaction(id, effects);
  if (journal.state === "verified" || journal.state === "rolled-back") return { status: "already-complete", journal };
  const rollback = await rollbackCodexTransaction(journal, effects);
  return { status: rollback.status === "conflict" ? "conflict" : "recovered", journal, rollback };
}

export const retryCodexRecovery = recoverCodexTransaction;
