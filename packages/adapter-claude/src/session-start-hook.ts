/** The hook reads immutable host context. It never authorizes a repair or probes a capability. */
export function claudeSessionStartHook(nativeContextCommand?: readonly string[]): string {
  return `const nativeContextCommand = ${JSON.stringify(nativeContextCommand ?? null)};\n` + String.raw`"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function read(file, limit, privateFile) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit || privateFile && ((stat.mode & 0o077) || stat.uid !== process.getuid())) throw Error("invalid-context-file");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const n = fs.readSync(fd, bytes, size, bytes.length - size, size); if (!n) break; size += n; }
    if (size > limit) throw Error("context-budget-exceeded");
    return new TextDecoder("utf-8", {fatal:true}).decode(bytes.subarray(0,size));
  } finally { fs.closeSync(fd); }
}
try {
  const root = fs.realpathSync(process.cwd()), reference = process.env.DECK_SESSION_START_CONTEXT;
  let text = "";
  if (reference) {
    const raw = read(reference, 256 * 1024, true);
    if (digest(raw) !== process.env.DECK_SESSION_START_DIGEST) throw Error("context-digest-mismatch");
    const value = JSON.parse(raw);
    if (value.root !== root || value.epoch !== process.env.DECK_SESSION_START_EPOCH || value.generation !== process.env.DECK_SESSION_START_GENERATION || typeof value.text !== "string") throw Error("context-binding-mismatch");
    text = value.text;
  } else {
    if (nativeContextCommand) {
      // Transport starts the existing Deck CLI; the shared evaluator itself never spawns.
      text = require("node:child_process").execFileSync(nativeContextCommand[0], nativeContextCommand.slice(1), {cwd:root,encoding:"utf8",timeout:5000,maxBuffer:256*1024});
    } else {
      try { text = read(path.join(root, "AGENTS.md"), 65536, false); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
      process.stderr.write("deck-preparation: native-snapshot-unavailable\n");
    }
  }
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:text}}));
} catch (e) { process.stderr.write("deck-preparation: session-start-context-unavailable\n"); process.exitCode = 1; }
`;
}
