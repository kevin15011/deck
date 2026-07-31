import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { tmpdir } from "node:os";

import { parseRegistryDocumentPairV1 } from "@deck/core/spec-registry";

import { buildRegistryIntentV1, type RegistryIntentInputV1, type RegistryIntentV1 } from "../contracts/registry-intent";
import { createRegistryCoordinatorV1 } from "./registry-coordinator";
import {
  createFileSystemRegistryStoreV1,
  createNodeRegistryFileSystemPortV1,
  type RegistryFileSystemPortV1,
} from "./filesystem-registry-store";
import { buildRegistryPairTransactionV1, classifyRegistryRecoveryV1, parseRegistryPairTransactionV1 } from "./registry-transaction";
import type { RegistryPairCommitRequestV1 } from "./registry-pair-store";

const roots: string[] = [];
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}` as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "deck-registry-"));
  roots.push(root);
  const changeId = "registry-fixture";
  const directory = join(root, "openspec", "changes", changeId);
  await fs.mkdir(directory, { recursive: true });
  const stateSource = `# preserve state\nschema: spec-registry-v1\nchangeId: ${changeId}\ncurrentPhase: design\nstatus: completed\nunknown: keep\nauthorization: "HISTORICAL_USER_STATEMENT_SENTINEL"\nartifacts:\n  design: design.md\nprovenance:\n  - phase: design\n    agent: design\n    model: model\n    timestamp: "2026-07-16T00:00:00.000Z"\n    registryWrite: non-deferred\n`;
  const eventsSource = `# preserve events\nschema: spec-registry-events-v1\nevents:\n  - phase: design\n    status: completed\n    event: design.completed\n    artifact: design.md\n    timestamp: "2026-07-16T00:00:00.000Z"\n    actor: design\n`;
  await fs.writeFile(join(directory, "state.yaml"), stateSource, { mode: 0o640 });
  await fs.writeFile(join(directory, "events.yaml"), eventsSource, { mode: 0o640 });
  await fs.writeFile(join(directory, "apply-progress.md"), "applied\n", { mode: 0o640 });
  const store = createFileSystemRegistryStoreV1({ projectRoot: root });
  const snapshot = await store.read(changeId);
  const intent = buildRegistryIntentV1({
    schema: "registry-intent-v1",
    idempotencyKey: sha("apply-transition"),
    changeId,
    base: { stateDigest: snapshot.stateDigest, eventsDigest: snapshot.eventsDigest },
    phase: "apply",
    status: "completed",
    artifact: { kind: "apply-progress", path: "apply-progress.md", digest: sha("applied\n") },
    provenance: { agent: "apply", model: "model", timestamp: "2026-07-16T01:00:00.000Z", note: "Completed registry transition safely" },
    event: { name: "apply.completed", actor: "apply", timestamp: "2026-07-16T01:00:00.000Z", notes: ["Completed"] },
  });
  return { root, changeId, directory, stateSource, eventsSource, store, snapshot, intent };
}

async function readPair(directory: string) {
  return parseRegistryDocumentPairV1({
    stateSource: await fs.readFile(join(directory, "state.yaml"), "utf8"),
    eventsSource: await fs.readFile(join(directory, "events.yaml"), "utf8"),
    expectedChangeId: "registry-fixture",
  });
}

function countIntent(pair: ReturnType<typeof parseRegistryDocumentPairV1>, intentId: string): number {
  const data = pair.events.data as { events: Array<{ intent_id?: string }> };
  return data.events.filter((event) => event.intent_id === intentId).length;
}

function countProvenance(pair: ReturnType<typeof parseRegistryDocumentPairV1>, intentId: string): number {
  const data = pair.state.data as { provenance: Array<{ intentId?: string }> };
  return data.provenance.filter((entry) => entry.intentId === intentId).length;
}

function reviseIntent(intent: RegistryIntentV1, changes: Partial<RegistryIntentInputV1>): RegistryIntentV1 {
  const { intentId: _intentId, digest: _digest, ...input } = intent;
  return buildRegistryIntentV1({ ...input, ...changes });
}

describe("central registry coordinator", () => {
  test("commits one complete pair and replays without byte changes", async () => {
    const value = await fixture();
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store: value.store, createTransactionId: () => "tx-commit" });
    const committed = await coordinator.commit(value.intent);
    expect(committed.code).toBe("committed");
    const first = await readPair(value.directory);
    expect(first.state.source).toContain("# preserve state");
    expect(first.events.source).toContain("# preserve events");
    expect(countIntent(first, value.intent.intentId)).toBe(1);
    const replay = await coordinator.commit(value.intent);
    expect(replay.code).toBe("replayed");
    const second = await readPair(value.directory);
    expect(second.state.source).toBe(first.state.source);
    expect(second.events.source).toBe(first.events.source);
    expect((await fs.stat(join(value.directory, "state.yaml")).then((item) => item.mode & 0o777))).toBe(0o640);
  });

  test("rejects competing intents and missing or mismatched artifacts without writes", async () => {
    const value = await fixture();
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store: value.store, createTransactionId: () => "tx-conflict" });
    expect((await coordinator.commit(value.intent)).code).toBe("committed");
    const current = await value.store.read(value.changeId);
    const competing = reviseIntent(value.intent, {
      idempotencyKey: value.intent.idempotencyKey,
      base: { stateDigest: current.stateDigest, eventsDigest: current.eventsDigest },
      status: "failed",
      event: { ...value.intent.event, name: "apply.failed" },
    });
    expect((await coordinator.commit(competing)).code).toBe("registry-intent-conflict");
    const missing = reviseIntent(value.intent, {
      idempotencyKey: sha("missing"),
      base: { stateDigest: current.stateDigest, eventsDigest: current.eventsDigest },
      artifact: { kind: "review-report", path: "missing.md" },
      event: { ...value.intent.event, name: "review.completed" },
      phase: "review",
    });
    expect((await coordinator.commit(missing)).code).toBe("invalid-evidence");
    expect(countIntent(await readPair(value.directory), value.intent.intentId)).toBe(1);
  });

  test("distributed-compatible mode never writes", async () => {
    const value = await fixture();
    const coordinator = createRegistryCoordinatorV1({ mode: "distributed-compatible", store: value.store });
    expect((await coordinator.commit(value.intent)).code).toBe("distributed-compatible");
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(value.stateSource);
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(value.eventsSource);
  });

  test("validates an intent chain from one base before committing any prefix", async () => {
    const value = await fixture();
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store: value.store, createTransactionId: () => "tx-chain" });
    const invalidSecond = reviseIntent(value.intent, {
      idempotencyKey: sha("chain-invalid"),
      artifact: { kind: "review-report", path: "does-not-exist.md" },
      phase: "review",
      event: { ...value.intent.event, name: "review.completed" },
    });
    const outcomes = await coordinator.commitAll([value.intent, invalidSecond]);
    expect(outcomes.at(-1)?.code).toBe("invalid-evidence");
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(value.stateSource);
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(value.eventsSource);
  });

  test("accepts bounded prose notes and rejects secret-bearing intent notes", async () => {
    const value = await fixture();
    expect(value.intent.provenance.note).toBe("Completed registry transition safely");
    expect(() => reviseIntent(value.intent, {
      provenance: { ...value.intent.provenance, note: "api_key=raw-secret-value" },
    })).toThrow("unsafe-diagnostic-content");
  });

  test("serializes concurrent coordinators through one writer lock", async () => {
    const value = await fixture();
    const first = createRegistryCoordinatorV1({ mode: "centralized", store: value.store, createTransactionId: () => "tx-concurrent-a" });
    const second = createRegistryCoordinatorV1({ mode: "centralized", store: value.store, createTransactionId: () => "tx-concurrent-b" });
    const initial = await Promise.all([first.commit(value.intent), second.commit(value.intent)]);
    expect(initial.filter((outcome) => outcome.code === "committed")).toHaveLength(1);
    const pending = initial[0].code === "registry-recovery-required" ? first : second;
    expect((await pending.commit(value.intent)).code).toBe("replayed");
    const pair = await readPair(value.directory);
    expect(countIntent(pair, value.intent.intentId)).toBe(1);
    expect(countProvenance(pair, value.intent.intentId)).toBe(1);
  });

  test("reads and updates archived registry records without migration", async () => {
    const value = await fixture();
    const archived = join(value.root, "openspec", "archive", value.changeId);
    await fs.mkdir(join(value.root, "openspec", "archive"), { recursive: true });
    await fs.rename(value.directory, archived);
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-archive" });
    expect((await coordinator.commit(value.intent)).code).toBe("committed");
    expect(countIntent(await readPair(archived), value.intent.intentId)).toBe(1);
    expect((await fs.stat(join(value.root, "openspec", "changes", value.changeId)).catch(() => undefined))).toBeUndefined();
  });
});

describe("registry pair transaction recovery", () => {
  test("classifies every base, next, and third digest pair", () => {
    const transaction = {
      base: { stateDigest: sha("state-base"), eventsDigest: sha("events-base") },
      next: { stateDigest: sha("state-next"), eventsDigest: sha("events-next") },
    } as Pick<RegistryPairCommitRequestV1, "base" | "next">;
    const states = [transaction.base.stateDigest, transaction.next.stateDigest, sha("state-third")];
    const events = [transaction.base.eventsDigest, transaction.next.eventsDigest, sha("events-third")];
    const expected = [
      ["roll-forward-both", "roll-forward-state", "conflict"],
      ["roll-forward-events", "finalize", "conflict"],
      ["conflict", "conflict", "conflict"],
    ] as const;
    for (let state = 0; state < states.length; state++) {
      for (let event = 0; event < events.length; event++) {
        expect(classifyRegistryRecoveryV1({ stateDigest: states[state], eventsDigest: events[event] }, transaction)).toBe(expected[state][event]);
      }
    }
  });

  test("preserves a prepared journal and authoritative files on third-digest interference", async () => {
    const value = await fixture();
    const pair = parseRegistryDocumentPairV1({ stateSource: value.stateSource, eventsSource: value.eventsSource });
    const { applyRegistryIntentToDocumentsV1 } = await import("@deck/core/spec-registry");
    const applied = applyRegistryIntentToDocumentsV1(pair, value.intent, { transactionId: "tx-third", artifactExists: true });
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-third",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: applied.pair.state.source,
      eventsSource: applied.pair.events.source,
      stateEdits: applied.edits.state,
      eventsEdits: applied.edits.events,
    });
    const runtime = join(value.root, ".deck", "runtime", "spec-registry", value.changeId);
    await fs.mkdir(runtime, { recursive: true });
    await fs.writeFile(join(runtime, "transaction.json"), `${JSON.stringify(transaction)}\n`);
    const third = `${value.stateSource}legacy_writer: true\n`;
    await fs.writeFile(join(value.directory, "state.yaml"), third);
    const recovery = await value.store.recover(value.changeId);
    expect(recovery).toEqual({ code: "registry-intent-conflict", reason: "third-digest" });
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(third);
    expect((await fs.stat(join(runtime, "transaction.json"))).isFile()).toBe(true);
  });

  test("pair CAS rejects a legacy writer racing after intent preparation", async () => {
    const value = await fixture();
    const { applyRegistryIntentToDocumentsV1 } = await import("@deck/core/spec-registry");
    const pair = parseRegistryDocumentPairV1({ stateSource: value.stateSource, eventsSource: value.eventsSource });
    const applied = applyRegistryIntentToDocumentsV1(pair, value.intent, { transactionId: "tx-race", artifactExists: true });
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-race",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: applied.pair.state.source,
      eventsSource: applied.pair.events.source,
      stateEdits: applied.edits.state,
      eventsEdits: applied.edits.events,
    });
    const legacy = `${value.eventsSource}legacy-writer: true\n`;
    await fs.writeFile(join(value.directory, "events.yaml"), legacy);
    expect(await value.store.commit(transaction)).toEqual({ code: "registry-intent-conflict", reason: "third-digest" });
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(legacy);
  });

  test("rechecks every ordered chain artifact under the writer lock", async () => {
    const value = await fixture();
    const earlierPath = "earlier-report.md";
    await fs.writeFile(join(value.directory, earlierPath), "stable\n");
    const { applyRegistryIntentToDocumentsV1 } = await import("@deck/core/spec-registry");
    const pair = parseRegistryDocumentPairV1({ stateSource: value.stateSource, eventsSource: value.eventsSource });
    const applied = applyRegistryIntentToDocumentsV1(pair, value.intent, { transactionId: "tx-artifacts", artifactExists: true });
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-artifacts",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      artifacts: [
        { path: earlierPath, digest: sha("stable\n") },
        { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      ],
      base: value.snapshot,
      stateSource: applied.pair.state.source,
      eventsSource: applied.pair.events.source,
      stateEdits: applied.edits.state,
      eventsEdits: applied.edits.events,
    });
    await fs.writeFile(join(value.directory, earlierPath), "changed\n");

    expect(await value.store.commit(transaction)).toEqual({ code: "registry-recovery-required", reason: "artifact-mismatch" });
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(value.stateSource);
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(value.eventsSource);
  });

  test("detects a legacy write between pair renames without overwriting it", async () => {
    const value = await fixture();
    const { applyRegistryIntentToDocumentsV1 } = await import("@deck/core/spec-registry");
    const pair = parseRegistryDocumentPairV1({ stateSource: value.stateSource, eventsSource: value.eventsSource });
    const applied = applyRegistryIntentToDocumentsV1(pair, value.intent, { transactionId: "tx-mid-race", artifactExists: true });
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-mid-race",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: applied.pair.state.source,
      eventsSource: applied.pair.events.source,
      stateEdits: applied.edits.state,
      eventsEdits: applied.edits.events,
    });
    const base = createNodeRegistryFileSystemPortV1();
    const legacy = `${value.eventsSource}legacy-writer: mid-commit\n`;
    const port: RegistryFileSystemPortV1 = {
      ...base,
      rename: async (from, to) => {
        await base.rename(from, to);
        if (basename(to) === "state.yaml") await base.writeFile(join(value.directory, "events.yaml"), legacy);
      },
    };
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: port });
    expect(await store.commit(transaction)).toEqual({ code: "registry-intent-conflict", reason: "third-digest" });
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(legacy);
    expect((await fs.stat(join(value.root, ".deck", "runtime", "spec-registry", value.changeId, "transaction.json"))).isFile()).toBe(true);
  });

  test("rechecks artifact identity under the writer lock", async () => {
    const value = await fixture();
    const { applyRegistryIntentToDocumentsV1 } = await import("@deck/core/spec-registry");
    const pair = parseRegistryDocumentPairV1({ stateSource: value.stateSource, eventsSource: value.eventsSource });
    const applied = applyRegistryIntentToDocumentsV1(pair, value.intent, { transactionId: "tx-artifact", artifactExists: true });
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-artifact",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: applied.pair.state.source,
      eventsSource: applied.pair.events.source,
      stateEdits: applied.edits.state,
      eventsEdits: applied.edits.events,
    });
    await fs.rm(join(value.directory, value.intent.artifact.path));
    expect(await value.store.commit(transaction)).toEqual({ code: "registry-recovery-required", reason: "artifact-mismatch" });
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(value.stateSource);
    expect(await fs.readFile(join(value.directory, "events.yaml"), "utf8")).toBe(value.eventsSource);
  });

  test("rejects unsafe journal documents before persistence", async () => {
    const value = await fixture();
    expect(() => buildRegistryPairTransactionV1({
      transactionId: "tx-unsafe",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: `${value.stateSource}proof: raw-secret-value\n`,
      eventsSource: value.eventsSource,
      stateEdits: [{ start: value.stateSource.length, end: value.stateSource.length, value: "proof: raw-secret-value\n" }],
      eventsEdits: [],
    })).toThrow("invalid-evidence");
  });

  test("journals only safe edits and never duplicates unchanged historical statements", async () => {
    const value = await fixture();
    const failpoint = failpointPort((operation, path) => operation === "write" && basename(path).endsWith("-state.tmp"));
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: failpoint.port });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-safe-delta" });
    expect((await coordinator.commit(value.intent)).code).toBe("registry-recovery-required");
    expect(failpoint.triggered()).toBe(true);
    const journalPath = join(value.root, ".deck", "runtime", "spec-registry", value.changeId, "transaction.json");
    const journal = await fs.readFile(journalPath, "utf8");
    expect(journal).toContain("stateEdits");
    expect(journal).not.toContain("HISTORICAL_USER_STATEMENT_SENTINEL");
    expect(journal).not.toContain("# preserve state");
    failpoint.disarm();
    expect((await coordinator.commit(value.intent)).code).toBe("replayed");
  });

  test("rejects change-id traversal before accessing runtime paths", async () => {
    const value = await fixture();
    expect(await value.store.recover("../escape")).toEqual({ code: "registry-recovery-required", reason: "journal-invalid" });
    await expect(value.store.read("../escape")).rejects.toThrow("registry-recovery-required");
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-safe-path",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: value.stateSource,
      eventsSource: value.eventsSource,
      stateEdits: [],
      eventsEdits: [],
    });
    const escaped = { ...transaction, changeId: "../escape" } as unknown as RegistryPairCommitRequestV1;
    expect(await value.store.commit(escaped)).toEqual({ code: "registry-recovery-required", reason: "journal-invalid" });
    expect(await fs.stat(join(value.root, ".deck", "runtime", "escape")).catch(() => undefined)).toBeUndefined();
  });

  test("rejects a self-inconsistent journal before recovery", async () => {
    const value = await fixture();
    const transaction = buildRegistryPairTransactionV1({
      transactionId: "tx-integrity",
      intentId: value.intent.intentId,
      idempotencyKey: value.intent.idempotencyKey,
      artifact: { path: value.intent.artifact.path, digest: value.intent.artifact.digest! },
      base: value.snapshot,
      stateSource: value.stateSource,
      eventsSource: value.eventsSource,
      stateEdits: [],
      eventsEdits: [],
    });
    expect(() => parseRegistryPairTransactionV1({
      ...transaction,
      next: { ...transaction.next, stateDigest: sha("tampered") },
    })).toThrow("registry-recovery-required");
  });
});

describe("registry writer lock", () => {
  async function writeLock(value: Awaited<ReturnType<typeof fixture>>, lock: unknown, journal?: string) {
    const runtime = join(value.root, ".deck", "runtime", "spec-registry", value.changeId);
    await fs.mkdir(runtime, { recursive: true });
    await fs.writeFile(join(runtime, "writer.lock"), `${JSON.stringify(lock)}\n`);
    if (journal !== undefined) await fs.writeFile(join(runtime, "transaction.json"), journal);
    return runtime;
  }

  test("does not reclaim a live or unexpired lock", async () => {
    const value = await fixture();
    const io = { ...createNodeRegistryFileSystemPortV1(), now: () => 1_000, pid: () => 123, processAlive: async () => true };
    const runtime = await writeLock(value, {
      schema: "registry-lock-v1", changeId: value.changeId, transactionId: "other", pid: 999, startedAt: 0, expiresAt: 2_000,
    });
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: io });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-lock" });
    expect((await coordinator.commit(value.intent)).code).toBe("registry-recovery-required");
    expect((await fs.stat(join(runtime, "writer.lock"))).isFile()).toBe(true);
    expect(await fs.readFile(join(value.directory, "state.yaml"), "utf8")).toBe(value.stateSource);
  });

  test("reclaims an expired dead-process lock only after journal inspection", async () => {
    const value = await fixture();
    const io = { ...createNodeRegistryFileSystemPortV1(), now: () => 1_000, pid: () => 123, processAlive: async () => false };
    await writeLock(value, {
      schema: "registry-lock-v1", changeId: value.changeId, transactionId: "other", pid: 999, startedAt: 0, expiresAt: 500,
    });
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: io });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-reclaimed" });
    expect((await coordinator.commit(value.intent)).code).toBe("committed");
    expect(countIntent(await readPair(value.directory), value.intent.intentId)).toBe(1);
  });

  test("preserves stale lock and malformed journal instead of deleting blindly", async () => {
    const value = await fixture();
    const io = { ...createNodeRegistryFileSystemPortV1(), now: () => 1_000, pid: () => 123, processAlive: async () => false };
    const runtime = await writeLock(value, {
      schema: "registry-lock-v1", changeId: value.changeId, transactionId: "other", pid: 999, startedAt: 0, expiresAt: 500,
    }, "{malformed");
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: io });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-malformed" });
    expect((await coordinator.commit(value.intent)).code).toBe("registry-recovery-required");
    expect((await fs.stat(join(runtime, "writer.lock"))).isFile()).toBe(true);
    expect(await fs.readFile(join(runtime, "transaction.json"), "utf8")).toBe("{malformed");
  });
});

type FailureRule = (operation: string, path: string, occurrence: number) => boolean;

function failpointPort(rule: FailureRule) {
  const base = createNodeRegistryFileSystemPortV1();
  const counts = new Map<string, number>();
  let armed = true;
  let triggered = false;
  const hit = (operation: string, path: string) => {
    const key = `${operation}:${path}`;
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    if (armed && rule(operation, path, occurrence)) {
      armed = false;
      triggered = true;
      throw new Error(`failpoint:${key}:${occurrence}`);
    }
  };
  const port: RegistryFileSystemPortV1 = {
    ...base,
    writeFile: async (path, content, options) => { hit("write", path); await base.writeFile(path, content, options); },
    fsyncFile: async (path) => { hit("fsync-file", path); await base.fsyncFile(path); },
    fsyncDirectory: async (path) => { hit("fsync-dir", path); await base.fsyncDirectory(path); },
    rename: async (from, to) => { hit(`rename-${basename(to)}`, from); await base.rename(from, to); },
    remove: async (path) => { hit("remove", path); await base.remove(path); },
  };
  return { port, disarm: () => { armed = false; }, triggered: () => triggered };
}

const CRASH_BOUNDARIES: ReadonlyArray<{ name: string; rule: FailureRule }> = [
  { name: "prepared journal write", rule: (op, path, n) => op === "write" && basename(path) === "transaction.tmp" && n === 1 },
  { name: "prepared journal fsync", rule: (op, path, n) => op === "fsync-file" && basename(path) === "transaction.tmp" && n === 1 },
  { name: "prepared journal rename", rule: (op, path, n) => op === "rename-transaction.json" && basename(path) === "transaction.tmp" && n === 1 },
  { name: "prepared journal directory fsync", rule: (op, path, n) => op === "fsync-dir" && path.includes(`${sep}.deck${sep}runtime${sep}`) && n === 4 },
  { name: "state temp write", rule: (op, path) => op === "write" && basename(path).endsWith("-state.tmp") },
  { name: "state temp fsync", rule: (op, path) => op === "fsync-file" && basename(path).endsWith("-state.tmp") },
  { name: "state rename", rule: (op, path) => op === "rename-state.yaml" && basename(path).endsWith("-state.tmp") },
  { name: "state directory fsync", rule: (op, path, n) => op === "fsync-dir" && !path.includes(`${sep}.deck${sep}runtime${sep}`) && n === 1 },
  { name: "events temp write", rule: (op, path) => op === "write" && basename(path).endsWith("-events.tmp") },
  { name: "events temp fsync", rule: (op, path) => op === "fsync-file" && basename(path).endsWith("-events.tmp") },
  { name: "events rename", rule: (op, path) => op === "rename-events.yaml" && basename(path).endsWith("-events.tmp") },
  { name: "events directory fsync", rule: (op, path, n) => op === "fsync-dir" && !path.includes(`${sep}.deck${sep}runtime${sep}`) && n === 2 },
  { name: "commit marker write", rule: (op, path, n) => op === "write" && basename(path) === "transaction.tmp" && n === 2 },
  { name: "commit marker fsync", rule: (op, path, n) => op === "fsync-file" && basename(path) === "transaction.tmp" && n === 2 },
  { name: "commit marker rename", rule: (op, path, n) => op === "rename-transaction.json" && basename(path) === "transaction.tmp" && n === 2 },
  { name: "commit marker directory fsync", rule: (op, path, n) => op === "fsync-dir" && path.includes(`${sep}.deck${sep}runtime${sep}`) && n === 5 },
  { name: "journal cleanup", rule: (op, path) => op === "remove" && basename(path) === "transaction.json" },
  { name: "cleanup directory fsync", rule: (op, path, n) => op === "fsync-dir" && path.includes(`${sep}.deck${sep}runtime${sep}`) && n === 6 },
];

for (const boundary of CRASH_BOUNDARIES) {
  test(`recovers deterministically after ${boundary.name}`, async () => {
    const value = await fixture();
    const failpoint = failpointPort(boundary.rule);
    const store = createFileSystemRegistryStoreV1({ projectRoot: value.root, fileSystem: failpoint.port });
    const coordinator = createRegistryCoordinatorV1({ mode: "centralized", store, createTransactionId: () => "tx-failpoint" });
    const interrupted = await coordinator.commit(value.intent);
    expect(failpoint.triggered()).toBe(true);
    expect(["registry-recovery-required", "committed"]).toContain(interrupted.code);
    failpoint.disarm();
    const retried = await coordinator.commit(value.intent);
    expect(["committed", "replayed"]).toContain(retried.code);
    const pair = await readPair(value.directory);
    expect(countIntent(pair, value.intent.intentId)).toBe(1);
    expect(countProvenance(pair, value.intent.intentId)).toBe(1);
    expect((pair.state.data as { currentPhase: string }).currentPhase).toBe("apply");
    const runtime = join(value.root, ".deck", "runtime", "spec-registry", value.changeId);
    const runtimeEntries = await fs.readdir(runtime).catch(() => []);
    expect(runtimeEntries.filter((name) => name === "transaction.json" || name.endsWith(".tmp"))).toEqual([]);
    expect((await fs.readdir(value.directory)).filter((name) => name.startsWith(".deck-registry-"))).toEqual([]);
  });
}
