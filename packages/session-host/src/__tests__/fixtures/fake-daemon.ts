// Stand-in daemon: supervises a `hold` child, reports pids, then idles until the test SIGKILLs it.
import { join } from "node:path";
import { Supervisor } from "../../supervisor";

const dir = import.meta.dir;
const supervisor = new Supervisor({ anchorCommand: [process.execPath, "run", join(dir, "anchor-entry.ts")] });
const leaseFile = process.env.FAKE_LEASE_FILE;
const proc = supervisor.spawn(process.execPath, ["run", join(dir, "fake-child.ts"), "hold"], {
  env: process.env as Record<string, string>,
  ...(leaseFile ? { lease: { file: leaseFile, taskId: "t1" } } : {}),
});
let buffer = "";
proc.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const line = buffer.split("\n")[0];
  if (!line?.startsWith("{")) return;
  const info = JSON.parse(line) as { child: number; grandchild: number };
  console.log(JSON.stringify({ anchor: proc.anchorPid, worker: info.child, grandchild: info.grandchild }));
  buffer = "";
});
proc.stderr.on("data", () => {});
setInterval(() => {}, 1000);
