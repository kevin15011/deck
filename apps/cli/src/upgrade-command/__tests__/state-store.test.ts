/**
 * Unit tests for the state store (REQ-ATM-005, REQ-ATM-006, etc.).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetDeckPathCache } from "../../runtime/paths.js";
import {
  acquireLock,
  appendHistory,
  buildDefaultState,
  clearActiveOperation,
  DeckUpdateStateSchema,
  getStateStorePaths,
  isLockStale,
  isPidAlive,
  readHistory,
  readState,
  releaseLock,
  rotateHistory,
  setActiveOperation,
  STATE_ERROR_CODES,
  StateStoreError,
  writeState,
  STALE_AFTER_SECONDS,
} from "../state-store.js";

describe("state-store", () => {
  let workDir: string;
  const saved: Record<string, string | undefined> = {};

  function setXdg(name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME" | "XDG_CACHE_HOME", value: string): void {
    saved[name] = process.env[name];
    process.env[name] = value;
    _resetDeckPathCache();
  }

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "deck-state-store-"));
    setXdg("XDG_CONFIG_HOME", join(workDir, "config"));
    setXdg("XDG_STATE_HOME", join(workDir, "state"));
    setXdg("XDG_CACHE_HOME", join(workDir, "cache"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const) {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    }
    _resetDeckPathCache();
  });

  // --- Defaults ---------------------------------------------------------

  describe("buildDefaultState", () => {
    it("returns schemaVersion=1 and the provided currentVersion", () => {
      const state = buildDefaultState("1.2.3");
      expect(state.schemaVersion).toBe(1);
      expect(state.currentVersion).toBe("1.2.3");
      expect(state.installKind).toBe("unknown");
      expect(state.installHistory.path).toContain("upgrade-history.jsonl");
    });
  });

  // --- Read / write ----------------------------------------------------

  describe("readState / writeState", () => {
    it("returns default state when no file exists", () => {
      const state = readState("1.2.3", "binary");
      expect(state.schemaVersion).toBe(1);
      expect(state.currentVersion).toBe("1.2.3");
      expect(state.installKind).toBe("binary");
    });

    it("writes then reads the same state (round trip)", () => {
      const original = buildDefaultState("2.0.0", "binary");
      writeState(original);

      const read = readState("placeholder", "binary");
      expect(read.schemaVersion).toBe(original.schemaVersion);
      expect(read.installKind).toBe(original.installKind);
      expect(read.installHistory).toEqual(original.installHistory);
    });

    it("rejects an unknown future schemaVersion (read-only fail-safe)", () => {
      const { statePath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({
          schemaVersion: 99,
          currentVersion: "9.9.9",
          installKind: "binary",
          installHistory: {
            path: "/x",
            retention: { maxEntries: 100, maxAgeDays: 180 },
          },
        }),
      );

      expect(() => readState("placeholder")).toThrow(StateStoreError);
      try {
        readState("placeholder");
      } catch (err) {
        expect((err as StateStoreError).code).toBe(
          STATE_ERROR_CODES.UNSUPPORTED_FUTURE_SCHEMA,
        );
      }
    });

    it("throws INVALID on malformed JSON", () => {
      const { statePath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck"), { recursive: true });
      writeFileSync(statePath, "{ not valid json");

      expect(() => readState("placeholder")).toThrow(StateStoreError);
      try {
        readState("placeholder");
      } catch (err) {
        expect((err as StateStoreError).code).toBe(STATE_ERROR_CODES.INVALID);
      }
    });
  });

  // --- Locking ---------------------------------------------------------

  describe("isPidAlive", () => {
    it("returns true for the current pid", () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });
    it("returns false for a clearly dead pid", () => {
      // Pick a very high pid unlikely to exist.
      expect(isPidAlive(2_000_000)).toBe(false);
    });
    it("returns false for undefined", () => {
      expect(isPidAlive(undefined)).toBe(false);
    });
  });

  describe("isLockStale", () => {
    it("treats an inactive lock as stale", () => {
      const lock = {
        active: false,
        pid: undefined,
        startedAt: undefined,
        staleAfterSeconds: STALE_AFTER_SECONDS,
      };
      expect(isLockStale(lock)).toBe(true);
    });

    it("treats a lock with a dead pid as stale", () => {
      const lock = {
        active: true,
        pid: 2_000_000,
        startedAt: new Date().toISOString(),
        staleAfterSeconds: STALE_AFTER_SECONDS,
      };
      expect(isLockStale(lock)).toBe(true);
    });

    it("treats a lock older than staleAfterSeconds as stale", () => {
      const old = new Date(Date.now() - (STALE_AFTER_SECONDS + 1) * 1000);
      const lock = {
        active: true,
        pid: process.pid,
        startedAt: old.toISOString(),
        staleAfterSeconds: STALE_AFTER_SECONDS,
      };
      expect(isLockStale(lock)).toBe(true);
    });

    it("treats a fresh, live lock as NOT stale", () => {
      const lock = {
        active: true,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        staleAfterSeconds: STALE_AFTER_SECONDS,
      };
      expect(isLockStale(lock)).toBe(false);
    });
  });

  describe("acquireLock / releaseLock", () => {
    it("acquires a fresh lock when none is held", () => {
      const state = buildDefaultState("1.0.0");
      const acquired = acquireLock(state, "op-1");
      expect(acquired.lock?.active).toBe(true);
      expect(acquired.lock?.pid).toBe(process.pid);
      expect(acquired.lock?.operationId).toBe("op-1");
    });

    it("refuses to acquire a live, fresh lock with LOCK_HELD", () => {
      const state = buildDefaultState("1.0.0");
      const first = acquireLock(state, "op-1");
      expect(() => acquireLock(first, "op-2")).toThrow(StateStoreError);
      try {
        acquireLock(first, "op-2");
      } catch (err) {
        expect((err as StateStoreError).code).toBe(STATE_ERROR_CODES.LOCK_HELD);
      }
    });

    it("takes over a stale lock (owner dead)", () => {
      const state = buildDefaultState("1.0.0");
      const stale: typeof state = {
        ...state,
        lock: {
          active: true,
          pid: 2_000_000, // dead
          operationId: "op-old",
          startedAt: new Date().toISOString(),
          staleAfterSeconds: STALE_AFTER_SECONDS,
        },
      };
      const fresh = acquireLock(stale, "op-new");
      expect(fresh.lock?.operationId).toBe("op-new");
      expect(fresh.lock?.pid).toBe(process.pid);
    });

    it("releaseLock clears the lock", () => {
      const state = buildDefaultState("1.0.0");
      const acquired = acquireLock(state, "op-1");
      const released = releaseLock(acquired);
      expect(released.lock).toBeUndefined();
    });

    it("releaseLock is idempotent (no-op on a non-active lock)", () => {
      const state = buildDefaultState("1.0.0");
      expect(releaseLock(state)).toEqual(state);
    });
  });

  // --- Active operation + history -------------------------------------

  describe("setActiveOperation / clearActiveOperation", () => {
    it("records an active operation", () => {
      const state = buildDefaultState("1.0.0");
      const op = {
        id: "op-1",
        version: "1.2.0",
        phase: "staging" as const,
        startedAt: new Date().toISOString(),
      };
      const next = setActiveOperation(state, op);
      expect(next.activeOperation).toEqual(op);
    });

    it("clears the active operation", () => {
      const state = buildDefaultState("1.0.0");
      const op = {
        id: "op-1",
        version: "1.2.0",
        phase: "verify" as const,
        startedAt: new Date().toISOString(),
      };
      const cleared = clearActiveOperation(setActiveOperation(state, op));
      expect(cleared.activeOperation).toBeUndefined();
    });
  });

  describe("history JSONL", () => {
    it("appends entries and reads them back", () => {
      const state = buildDefaultState("1.0.0");
      appendHistory(state, { operationId: "a", result: "completed" });
      appendHistory(state, { operationId: "b", result: "rolled_back" });
      const entries = readHistory();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.operationId).toBe("a");
      expect(entries[1]?.operationId).toBe("b");
    });

    it("rotates entries that exceed maxEntries or are older than maxAgeDays", () => {
      const state = buildDefaultState("1.0.0");
      // Inject 3 entries; mark first one as very old
      const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const { historyPath } = getStateStorePaths();
      mkdirSync(join(workDir, "state", "deck", "history"), { recursive: true });
      const lines = [
        JSON.stringify({ operationId: "old", writtenAt: old }),
        JSON.stringify({ operationId: "fresh1", writtenAt: new Date().toISOString() }),
        JSON.stringify({ operationId: "fresh2", writtenAt: new Date().toISOString() }),
      ].join("\n") + "\n";
      writeFileSync(historyPath, lines);

      const rotated = rotateHistory(state);
      expect(rotated).toBe(true);
      const after = readHistory();
      const ids = after.map((e) => e.operationId);
      expect(ids).not.toContain("old");
      expect(ids).toContain("fresh1");
      expect(ids).toContain("fresh2");
    });
  });

  // --- Schema ----------------------------------------------------------

  describe("DeckUpdateStateSchema", () => {
    it("accepts a valid default state", () => {
      const state = buildDefaultState("1.0.0");
      const result = DeckUpdateStateSchema.safeParse(state);
      expect(result.success).toBe(true);
    });
  });
});
