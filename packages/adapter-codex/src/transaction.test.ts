import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  applyCodexMutationPlan,
  recoverCodexTransaction,
  reopenCodexTransaction,
  rollbackCodexTransaction,
  type CodexFileEffects,
  type CodexTransactionJournal,
} from "./transaction";
import type { CodexMutationPlan } from "./types";

function fakeEffects(
  initial: Record<string, { content: string; mode?: number; kind?: "file" | "symlink" | "directory" }> = {},
  failAtOperation?: number,
) {
  const files = new Map(Object.entries(initial));
  const journals = new Map<string, CodexTransactionJournal>();
  const snapshots: CodexTransactionJournal[] = [];
  const events: string[] = [];
  let operation = 0;
  let failureOperation = failAtOperation;
  let id = 0;
  let clock = 100;
  const boundary = (label: string) => {
    operation += 1;
    events.push(label);
    if (operation === failureOperation) throw new Error(`injected:${label}`);
  };
  const effects: CodexFileEffects = {
    inspect: async (path) => files.get(path) ?? null,
    writeAtomic: async (path, content, mode) => { boundary("write"); files.set(path, { content, mode, kind: "file" }); },
    remove: async (path) => { boundary("remove"); files.delete(path); },
    persistJournalAtomic: async (journal) => {
      boundary(`persist:${journal.state}:${journal.entries.map((entry) => entry.state).join(",")}`);
      const snapshot = structuredClone(journal);
      journals.set(journal.id, snapshot);
      snapshots.push(snapshot);
    },
    readJournal: async (journalId) => structuredClone(journals.get(journalId) ?? null),
    listJournals: async () => [...journals.values()].map((journal) => structuredClone(journal)),
    createTransactionId: () => `tx-${++id}`,
    now: () => ++clock,
  };
  return { files, journals, snapshots, events, effects, failAfter: (operations: number) => { failureOperation = operation + operations; } };
}

const createdPlan: CodexMutationPlan = {
  projectRoot: "/project",
  blocked: false,
  diagnostics: [],
  expectedFiles: [{ relativePath: ".codex/agents/deck-lead.toml", hash: "4b168d88dc872a7753c2bc35b36a2d4249487af55baf78f247f38cae2fe962da", content: "role", mode: 0o644, kind: "role" }],
  inventory: { agentRoleIds: [], agentBoundSkillIds: [], externalStandaloneSkillIds: [], bootstrapSkillIds: [] },
  mutations: [{
    relativePath: ".codex/agents/deck-lead.toml",
    expected: { kind: "absent" },
    postimageHash: "4b168d88dc872a7753c2bc35b36a2d4249487af55baf78f247f38cae2fe962da",
    postimageMode: 0o644,
    ownership: { kind: "deck-file", marker: "manifest:deck-lead" },
    rollback: "delete",
    content: "role",
  }],
};

describe("Codex durable transaction", () => {
  test("uses transaction-level durable intents instead of rewriting the journal per file", async () => {
    const plan: CodexMutationPlan = {
      ...createdPlan,
      expectedFiles: [],
      mutations: ["one", "two", "three"].map((relativePath) => ({
        ...createdPlan.mutations[0]!,
        relativePath,
      })),
    };
    const fake = fakeEffects();

    const transaction = await applyCodexMutationPlan(plan, fake.effects);
    const applyPersists = fake.events.filter((event) => event.startsWith("persist:")).length;
    expect(applyPersists).toBe(3);
    expect(fake.events.filter((event) => event === "write")).toHaveLength(3);

    await rollbackCodexTransaction(transaction.journal, fake.effects);
    const totalPersists = fake.events.filter((event) => event.startsWith("persist:")).length;
    expect(totalPersists - applyPersists).toBe(2);
    expect(fake.events.filter((event) => event === "remove")).toHaveLength(3);
  });

  test("persists every transition, uses unique ids, and rolls back only matching postimages", async () => {
    const fake = fakeEffects();
    const transaction = await applyCodexMutationPlan(createdPlan, fake.effects);
    expect(transaction.status).toBe("verified");
    expect(fake.snapshots.map((journal) => journal.state)).toContain("prepared");
    expect(fake.snapshots.some((journal) => journal.entries[0]?.state === "writing")).toBe(true);
    const rollback = await rollbackCodexTransaction(transaction.journal, fake.effects);
    expect(rollback).toMatchObject({ status: "rolled-back", conflicts: [] });
    expect(fake.files.has("/project/.codex/agents/deck-lead.toml")).toBe(false);

    const empty = { ...createdPlan, mutations: [], expectedFiles: [] };
    const one = await applyCodexMutationPlan(empty, fake.effects);
    const two = await applyCodexMutationPlan(empty, fake.effects);
    expect(one.journal.id).not.toBe(two.journal.id);
  });

  test("deletes only an owned stale postimage and restores it through rollback", async () => {
    const oldHash = createHash("sha256").update("owned-old").digest("hex");
    const plan: CodexMutationPlan = {
      ...createdPlan,
      expectedFiles: [],
      mutations: [{
        operation: "delete",
        relativePath: "stale",
        expected: { kind: "file", hash: oldHash, mode: 0o644 },
        postimageHash: createHash("sha256").update("").digest("hex"),
        postimageMode: 0o644,
        ownership: { kind: "deck-file", marker: "stale:test" },
        rollback: "restore",
        content: "",
      }],
    };
    const fake = fakeEffects({ "/project/stale": { content: "owned-old", mode: 0o644, kind: "file" } });
    const transaction = await applyCodexMutationPlan(plan, fake.effects);
    expect(fake.files.has("/project/stale")).toBe(false);
    expect(await rollbackCodexTransaction(transaction.journal, fake.effects)).toMatchObject({ status: "rolled-back" });
    expect(fake.files.get("/project/stale")?.content).toBe("owned-old");
  });

  test("deterministically reopens and recovers a crash after every persisted intent", async () => {
    const baseline = fakeEffects();
    await applyCodexMutationPlan(createdPlan, baseline.effects);
    const boundaryCount = baseline.events.length;
    for (let failAt = 1; failAt <= boundaryCount; failAt += 1) {
      const fake = fakeEffects({}, failAt);
      try { await applyCodexMutationPlan(createdPlan, fake.effects, { autoRollback: false }); } catch { /* injected crash */ }
      const persisted = [...fake.journals.values()].at(-1);
      if (!persisted) {
        expect(fake.files.size).toBe(0);
        continue;
      }
      const reopened = await reopenCodexTransaction(persisted.id, fake.effects);
      expect(reopened.id).toBe(persisted.id);
      const recovery = await recoverCodexTransaction(persisted.id, fake.effects);
      expect(["recovered", "already-complete"]).toContain(recovery.status);
      expect(fake.files.size).toBe(recovery.status === "already-complete" ? 1 : 0);
      const firstWrite = fake.events.indexOf("write");
      if (firstWrite >= 0) expect(fake.events.slice(0, firstWrite).some((event) => event.includes("writing"))).toBe(true);
    }
  });

  test("persists and surfaces optimistic rollback conflicts for retry", async () => {
    const fake = fakeEffects();
    const transaction = await applyCodexMutationPlan(createdPlan, fake.effects);
    fake.files.set("/project/.codex/agents/deck-lead.toml", { content: "later edit", kind: "file" });
    const rollback = await rollbackCodexTransaction(transaction.journal, fake.effects);
    expect(rollback).toEqual({ status: "conflict", journalId: transaction.journal.id, conflicts: [".codex/agents/deck-lead.toml"] });
    expect((await reopenCodexTransaction(transaction.journal.id, fake.effects)).state).toBe("conflict");
    expect((await recoverCodexTransaction(transaction.journal.id, fake.effects)).status).toBe("conflict");
  });

  test("recovers when a crash occurred after rollback bytes changed but before completion persisted", async () => {
    const oldHash = createHash("sha256").update("old").digest("hex");
    const newHash = createHash("sha256").update("new").digest("hex");
    const fake = fakeEffects({ "/project/existing": { content: "old", mode: 0o600, kind: "file" } });
    const journal: CodexTransactionJournal = {
      version: 2,
      id: "interrupted-rollback",
      projectRoot: "/project",
      createdAt: 1,
      updatedAt: 1,
      state: "rollback",
      entries: [
        { mutation: createdPlan.mutations[0]!, preimage: null, state: "rolling-back" },
        {
          mutation: {
            relativePath: "existing",
            expected: { kind: "file", hash: oldHash, mode: 0o600 },
            postimageHash: newHash,
            postimageMode: 0o600,
            ownership: { kind: "deck-file", marker: "test" },
            rollback: "restore",
            content: "new",
          },
          preimage: { content: "old", mode: 0o600, kind: "file" },
          state: "rolling-back",
        },
      ],
    };
    fake.journals.set(journal.id, structuredClone(journal));

    const recovery = await recoverCodexTransaction(journal.id, fake.effects);
    expect(recovery.status).toBe("recovered");
    expect(recovery.journal.entries.every((entry) => entry.state === "rolled-back")).toBe(true);
    expect(fake.files.get("/project/existing")?.content).toBe("old");
  });

  test("retries rollback after injected delete and restore completion-persistence failures", async () => {
    const created = fakeEffects();
    const createdTransaction = await applyCodexMutationPlan(createdPlan, created.effects);
    created.failAfter(3);
    await expect(rollbackCodexTransaction(createdTransaction.journal, created.effects)).rejects.toThrow("injected:persist");
    expect(created.files.has("/project/.codex/agents/deck-lead.toml")).toBe(false);
    expect((await recoverCodexTransaction(createdTransaction.journal.id, created.effects)).status).toBe("recovered");

    const oldHash = createHash("sha256").update("old").digest("hex");
    const newHash = createHash("sha256").update("new").digest("hex");
    const restorePlan: CodexMutationPlan = {
      ...createdPlan,
      expectedFiles: [{ ...createdPlan.expectedFiles[0]!, relativePath: "existing", hash: newHash, content: "new", mode: 0o600 }],
      mutations: [{
        relativePath: "existing",
        expected: { kind: "file", hash: oldHash, mode: 0o600 },
        postimageHash: newHash,
        postimageMode: 0o600,
        ownership: { kind: "deck-file", marker: "test" },
        rollback: "restore",
        content: "new",
      }],
    };
    const restored = fakeEffects({ "/project/existing": { content: "old", mode: 0o600, kind: "file" } });
    const restoreTransaction = await applyCodexMutationPlan(restorePlan, restored.effects);
    restored.failAfter(3);
    await expect(rollbackCodexTransaction(restoreTransaction.journal, restored.effects)).rejects.toThrow("injected:persist");
    expect(restored.files.get("/project/existing")?.content).toBe("old");
    expect((await recoverCodexTransaction(restoreTransaction.journal.id, restored.effects)).status).toBe("recovered");
  });

  test("rejects changed preimages and target or ancestor symlinks", async () => {
    const changed = fakeEffects({ "/project/.codex/agents/deck-lead.toml": { content: "changed", kind: "file" } });
    await expect(applyCodexMutationPlan(createdPlan, changed.effects)).rejects.toThrow("preimage");
    expect([...changed.journals.values()].at(-1)).toMatchObject({
      state: "conflict",
      entries: [{ state: "conflict", error: expect.stringContaining("preimage") }],
    });
    await expect(applyCodexMutationPlan(createdPlan, fakeEffects({ "/project/.codex/agents/deck-lead.toml": { content: "", kind: "symlink" } }).effects)).rejects.toThrow("symlink");
    await expect(applyCodexMutationPlan(createdPlan, fakeEffects({ "/project/.codex": { content: "", kind: "symlink" } }).effects)).rejects.toThrow("symlink");
  });
});
