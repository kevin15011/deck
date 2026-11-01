import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

// Protects release composition and bidirectional context delivery, using the real
// pinned artifacts. Oracle: full short turns in one project reach the other runner;
// provider failure must not advance capture, and no code may access personal HOME.
// Standalone multi-process acceptance exercise (like the other runner acceptance scripts).
// Run explicitly at integration handoff; it is not part of the two-second fast suite.
async function main() {
  const home = mkdtempSync(join(tmpdir(), "deck-native-memory-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const node = Bun.which("node")!;
    child = Bun.spawn([process.execPath, join(import.meta.dir, "__fixtures__/native-memory/exercise.ts")], {
      env: { HOME: home, PATH: `${join(node, "..")}:${join(process.execPath, "..") }:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: "1", NODE_EXECUTABLE: node },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
    const result=JSON.parse(stdout);
    for(const key of ["openCodeOwnedDrain","claudeBidirectional","claudeAsyncIsNotReceipt","codexToOpenCode","openCodeToCodex","rejectedCapturePreserved","globalLegacy","idleCallbackIsNotReceipt"]) assert.equal(result[key],true);
    const evidenceDirectory = process.argv[2];
    if (evidenceDirectory) {
      assert(isAbsolute(evidenceDirectory), "Evidence destination must be absolute and new");
      mkdirSync(evidenceDirectory, { mode: 0o700 });
      for(const file of ["requests.jsonl", "provider.json"]) copyFileSync(join(home,file),join(evidenceDirectory,file));
      writeFileSync(join(evidenceDirectory,"result.json"),stdout,{mode:0o600,flag:"wx"});
    }
    console.log(stdout.trim());
  } finally { if(child && child.exitCode===null) { child.kill(); await child.exited; } rmSync(home, { recursive: true, force: true }); }
}
await main();
