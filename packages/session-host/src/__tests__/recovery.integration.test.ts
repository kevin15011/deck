import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EventLog } from "../event-log";
import { Ledger } from "../ledger";
import { readLease } from "../lease";
import { createNodeProbe } from "../process-probe";
import { recoverSession } from "../recovery";
import { cleanupTempDirs, isAlive, tempDir, waitFor } from "./test-helpers";

const stray: number[] = [];
afterEach(() => {
  for (const pid of stray.splice(0)) if (isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  cleanupTempDirs();
});

/** XR-3 scenario "Daemon crash": real anchor, real lease, real OS probe. */
test("daemon crash: the anchor kills the group, restart recovery marks the task interrupted(daemon-restart)", async () => {
  const dir = tempDir();
  const leaseFile = join(dir, "lease.json");
  const daemon = spawn(process.execPath, ["run", join(import.meta.dir, "fixtures", "fake-daemon.ts")], {
    stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, FAKE_LEASE_FILE: leaseFile },
  });
  let out = "";
  daemon.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
  await waitFor(() => out.includes("\n"), 10000, "daemon report");
  const pids = JSON.parse(out.split("\n")[0]!) as { anchor: number; worker: number; grandchild: number };
  stray.push(pids.anchor, pids.worker, pids.grandchild);
  await waitFor(() => readLease(leaseFile)?.state === "live", 5000, "live lease");

  const log = EventLog.open({ dir: join(dir, "events"), sessionId: "s-1" });
  log.appendMany([
    { kind: "session.created", data: { projectRoot: "/p" } },
    { kind: "session.state", data: { state: "running" } },
    { kind: "task.created", source: { taskId: "t1" }, data: { taskId: "t1", memberId: "lead", runnerId: "claude", modelId: "m" } },
    { kind: "task.state", source: { taskId: "t1" }, data: { taskId: "t1", state: "running" } },
  ]);
  const ledger = Ledger.empty("s-1");
  for (const e of log.readAfter(0)) ledger.apply(e);
  const probe = createNodeProbe();

  // Daemon still alive: containment is live, so recovery must NOT claim the task is settled.
  const early = recoverSession({ log, ledger, probe, leaseFileFor: () => leaseFile });
  expect(early.unsettled).toEqual([{ taskId: "t1", reason: "pid-alive" }]);
  expect(isAlive(pids.worker)).toBe(true);

  process.kill(daemon.pid!, "SIGKILL");
  await waitFor(() => ![pids.anchor, pids.worker, pids.grandchild].some(isAlive), 8000, "group death");

  const after = recoverSession({ log, ledger, probe, leaseFileFor: () => leaseFile });
  expect(after.interrupted).toEqual(["t1"]);
  expect(ledger.latest("t1")).toMatchObject({ state: "interrupted", reason: "daemon-restart" });
  expect(existsSync(leaseFile)).toBe(false);
  log.close();
});
