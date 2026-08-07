import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createNodeCodexFileEffects } from "./node-effects";
import type { CodexTransactionJournal } from "./transaction";

test("atomic journal retention never deletes active or conflicted transactions", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-codex-journals-"));
  try {
    let time = 1_000;
    const effects = createNodeCodexFileEffects({ journalRoot: root, now: () => time, retention: { maxCompleted: 0, minimumAgeMs: 0 } });
    const journal = (id: string, state: CodexTransactionJournal["state"]): CodexTransactionJournal => ({ version: 2, id, projectRoot: "/p", createdAt: 1, updatedAt: 1, state, entries: [] });
    await effects.persistJournalAtomic(journal("active", "applying"));
    await effects.persistJournalAtomic(journal("conflict", "conflict"));
    await effects.persistJournalAtomic(journal("complete", "verified"));
    time = 2_000;
    await effects.pruneJournals?.();
    expect((await effects.listJournals()).map((entry) => entry.id).sort()).toEqual(["active", "conflict"]);
    expect((await readdir(root)).every((name) => !name.endsWith(".tmp"))).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fsyncs containing directories after file, journal, and retention mutations", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-codex-fsync-"));
  const projectRoot = join(root, "project");
  const journalRoot = join(root, "journals");
  const synced: string[] = [];
  try {
    const effects = createNodeCodexFileEffects({
      journalRoot,
      now: () => 10,
      retention: { maxCompleted: 0, minimumAgeMs: 0 },
      onDirectoryFsync: (path) => { synced.push(path); },
    });
    const target = join(projectRoot, "nested", "file");
    await effects.writeAtomic(target, "value", 0o644, { projectRoot, expected: { kind: "absent" } });
    await effects.remove(target, { projectRoot, expectedHash: createHash("sha256").update("value").digest("hex") });
    await effects.persistJournalAtomic({ version: 2, id: "done", projectRoot, createdAt: 1, updatedAt: 1, state: "verified", entries: [] });
    await effects.pruneJournals?.();

    expect(synced).toEqual([join(projectRoot, "nested"), join(projectRoot, "nested"), journalRoot, journalRoot]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
