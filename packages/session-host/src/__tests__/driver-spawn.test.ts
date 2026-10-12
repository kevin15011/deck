import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createDriverSpawn } from "../driver-spawn";
import { readLease } from "../lease";
import { Supervisor } from "../supervisor";
import { cleanupTempDirs, sleep, tempDir, waitFor } from "./test-helpers";

const FIXTURES = join(import.meta.dir, "fixtures");
const supervisors: Supervisor[] = [];
const makeSupervisor = () => {
  const s = new Supervisor({ anchorCommand: [process.execPath, "run", join(FIXTURES, "anchor-entry.ts")] });
  supervisors.push(s);
  return s;
};
const CHILD = join(FIXTURES, "fake-child.ts");

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((s) => s.shutdown(200)));
  cleanupTempDirs();
});

describe("createDriverSpawn (D-7: drivers spawn only through the anchor)", () => {
  test("adapts a supervised process to the driver contract: UTF-8 text in and out, clean exit", async () => {
    const spawn = createDriverSpawn(makeSupervisor());
    const child = await spawn(process.execPath, ["run", CHILD, "echo"], { env: process.env as Record<string, string> });
    let out = "";
    child.onStdout((chunk) => { out += chunk; });
    await child.ready;
    child.writeStdin("pïng\n");
    await waitFor(() => out.includes("PÏNG"), 5000, "echo");
    child.endStdin();
    expect(await child.exited).toMatchObject({ ok: true, code: 0, drained: true, anchorLost: false });
  });

  test("interrupt() reaches the CLI (clean exit) and terminateGroup() ends a child that ignores it", async () => {
    const spawn = createDriverSpawn(makeSupervisor());
    const polite = await spawn(process.execPath, ["run", CHILD, "hold"], { env: process.env as Record<string, string> });
    let out = "";
    polite.onStdout((c) => { out += c; });
    await waitFor(() => out.includes("grandchild"), 8000, "child info");
    expect(polite.interrupt()).toBe(true);
    expect(await polite.exited).toMatchObject({ ok: true, code: 0 });
    expect(out).toContain("interrupted");

    const stubborn = await spawn(process.execPath, ["run", CHILD, "stubborn"], { env: process.env as Record<string, string> });
    let info = "";
    stubborn.onStdout((c) => { info += c; });
    await waitFor(() => info.includes("grandchild"), 8000, "stubborn info");
    expect(stubborn.interrupt()).toBe(true);
    await stubborn.terminateGroup(200);
    expect((await stubborn.exited).ok).toBe(false);
  });

  test("a lease is recorded for the task when one is bound", async () => {
    const dir = tempDir();
    const file = join(dir, "lease.json");
    const spawn = createDriverSpawn(makeSupervisor(), { lease: { file, taskId: "t1" } });
    const child = await spawn(process.execPath, ["run", CHILD, "echo"], { env: process.env as Record<string, string> });
    await child.ready;
    await sleep(50);
    expect(readLease(file)).toMatchObject({ taskId: "t1", state: "live" });
    child.endStdin();
    await child.exited;
  });
});
