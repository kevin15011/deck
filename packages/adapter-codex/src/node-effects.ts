import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { CodexFileEffects, CodexInspectedFile, CodexTransactionJournal, CodexWriteGuard } from "./transaction";

function sha256(content: string): string { return createHash("sha256").update(content).digest("hex"); }

async function inspect(path: string): Promise<CodexInspectedFile | null> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return { content: "", mode: stat.mode & 0o777, kind: "symlink" };
    if (!stat.isFile()) return { content: "", mode: stat.mode & 0o777, kind: "directory" };
    return { content: await readFile(path, "utf8"), mode: stat.mode & 0o777, kind: "file" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function assertNoSymlinkAncestors(projectRoot: string, path: string): Promise<void> {
  const root = resolve(projectRoot);
  const absolute = resolve(path);
  if (!absolute.startsWith(`${root}${sep}`)) throw new Error(`Write escapes approved root: ${path}`);
  let current = root;
  for (const segment of relative(root, dirname(absolute)).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const state = await inspect(current);
    if (state?.kind === "symlink") throw new Error(`Symlink ancestor appeared before rename: ${current}`);
    if (state?.kind === "file") throw new Error(`Non-directory ancestor appeared before rename: ${current}`);
  }
}

async function assertGuard(path: string, guard: CodexWriteGuard): Promise<void> {
  await assertNoSymlinkAncestors(guard.projectRoot, path);
  const current = await inspect(path);
  if (current?.kind === "symlink" || current?.kind === "directory") throw new Error(`Unsafe target appeared before rename: ${path}`);
  if (guard.expected.kind === "absent" && current !== null) throw new Error(`CAS failed immediately before rename: ${path}`);
  if (guard.expected.kind === "file" && (!current || sha256(current.content) !== guard.expected.hash || (current.mode ?? 0o644) !== guard.expected.mode)) {
    throw new Error(`CAS failed immediately before rename: ${path}`);
  }
}

export function createNodeCodexFileEffects(options: {
  journalRoot: string;
  now?: () => number;
  createTransactionId?: () => string;
  retention?: { maxCompleted?: number; minimumAgeMs?: number };
  onDirectoryFsync?: (path: string) => void | Promise<void>;
}): CodexFileEffects {
  const now = options.now ?? Date.now;
  const createTransactionId = options.createTransactionId ?? randomUUID;
  const maxCompleted = options.retention?.maxCompleted ?? 10;
  const minimumAgeMs = options.retention?.minimumAgeMs ?? 60_000;
  const journalPath = (id: string) => join(options.journalRoot, `${id}.json`);
  const syncDirectory = async (path: string): Promise<void> => {
    await fsyncDirectory(path);
    await options.onDirectoryFsync?.(path);
  };

  const readJournal = async (id: string): Promise<CodexTransactionJournal | null> => {
    try {
      const parsed = JSON.parse(await readFile(journalPath(id), "utf8")) as CodexTransactionJournal;
      return parsed?.version === 2 && parsed.id === id ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const listJournals = async (): Promise<readonly CodexTransactionJournal[]> => {
    try {
      const journals: CodexTransactionJournal[] = [];
      for (const entry of await readdir(options.journalRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const value = await readJournal(entry.name.slice(0, -5));
        if (value) journals.push(value);
      }
      return journals;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };

  return {
    inspect,
    now,
    createTransactionId,
    readJournal,
    listJournals,
    async writeAtomic(path, content, mode, guard) {
      await mkdir(dirname(path), { recursive: true });
      await assertNoSymlinkAncestors(guard.projectRoot, path);
      const temp = `${path}.deck-${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", mode);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await chmod(temp, mode);
        await assertGuard(path, guard);
        await rename(temp, path);
        await syncDirectory(dirname(path));
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async remove(path, guard) {
      await assertNoSymlinkAncestors(guard.projectRoot, path);
      const current = await inspect(path);
      if (!current || current.kind !== "file" || sha256(current.content) !== guard.expectedHash) throw new Error(`CAS failed immediately before delete: ${path}`);
      await rm(path);
      await syncDirectory(dirname(path));
    },
    async persistJournalAtomic(journal) {
      await mkdir(options.journalRoot, { recursive: true, mode: 0o700 });
      const path = journalPath(journal.id);
      const temp = `${path}.${randomUUID()}.tmp`;
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(journal), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temp, path);
        await chmod(path, 0o600);
        await syncDirectory(options.journalRoot);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async pruneJournals() {
      const completed = (await listJournals())
        .filter((journal) => journal.state === "verified" || journal.state === "rolled-back")
        .sort((left, right) => right.updatedAt - left.updatedAt);
      for (const journal of completed.slice(maxCompleted)) {
        if (now() - journal.updatedAt < minimumAgeMs) continue;
        await rm(journalPath(journal.id), { force: true });
        await syncDirectory(options.journalRoot);
      }
    },
  };
}
