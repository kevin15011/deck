// Stand-in for a native runner CLI (e.g. `claude -p`), driven by argv[2] mode.
import { spawn } from "node:child_process";
import { appendFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] ?? "hold";
const mark = process.env.FAKE_MARK;
const grandchildScript = join(import.meta.dir, "fake-grandchild.ts");
/** Synchronous, complete write: Bun pipe streams can drop queued bytes when the process exits under load. */
function writeAll(fd: number, text: string): void {
  const buf = Buffer.from(text);
  for (let off = 0; off < buf.length;) {
    try { off += writeSync(fd, buf, off); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
  }
}
const note = (line: string) => { if (mark) appendFileSync(mark, `${line}\n`); };
/** Starts a descendant and calls back once its signal handlers are installed. */
const startGrandchild = (stdio: "ignore" | "inherit", announce: (pid: number) => void) => {
  const gc = spawn(process.execPath, ["run", grandchildScript], { stdio: ["ignore", stdio, stdio, "ipc"], env: process.env });
  gc.once("message", () => announce(gc.pid!));
  return gc;
};

switch (mode) {
  case "hold": {
    process.on("SIGINT", () => { note("cli:SIGINT"); console.log("interrupted"); process.exit(0); });
    startGrandchild("ignore", (gc) => console.log(JSON.stringify({ child: process.pid, grandchild: gc })));
    setInterval(() => {}, 1000);
    break;
  }
  case "stubborn": { // ignores INT and TERM: only SIGKILL ends it
    for (const s of ["SIGINT", "SIGTERM"] as const) process.on(s, () => note(`cli:${s}`));
    startGrandchild("ignore", (gc) => console.log(JSON.stringify({ child: process.pid, grandchild: gc })));
    setInterval(() => {}, 1000);
    break;
  }
  case "exit0-orphan": { // exits 0 but a descendant keeps stdout open
    startGrandchild("inherit", (gc) => { console.log(JSON.stringify({ child: process.pid, grandchild: gc })); process.exit(0); });
    break;
  }
  case "echo": {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => process.stdout.write(chunk.toUpperCase()));
    process.stdin.on("end", () => process.exit(0));
    break;
  }
  case "big": {
    const line = "x".repeat(1023) + "\n";
    for (let i = 0; i < 4096; i++) writeAll(1, line);
    writeAll(2, "done-err\n");
    process.exit(3);
    break;
  }
  case "env": {
    console.log(process.env.DECK_ANCHOR_NONCE ?? "absent");
    process.exit(0);
    break;
  }
  case "exit": {
    process.exit(Number(process.argv[3] ?? 0));
    break;
  }
  default:
    process.exit(64);
}
