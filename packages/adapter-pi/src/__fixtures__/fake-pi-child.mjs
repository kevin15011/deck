#!/usr/bin/env node
// Test-only stand-in for the `pi` binary used by the Deck subagent tool. It records how it was spawned and prints
// Pi-JSON-mode JSONL. Behavior is selected by the task text: FAIL (exit 1), SLEEP (wait), IGNORE_TERM (ignore SIGTERM).
import fs from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const task = argv[argv.length - 1] ?? "";
const promptFile = flag("--append-system-prompt");
let stdinTarget = "unknown";
try { stdinTarget = fs.readlinkSync("/proc/self/fd/0"); } catch { /* non-linux */ }
const record = {
  argv,
  stdinTarget,
  promptFileExists: promptFile ? fs.existsSync(promptFile) : false,
  promptText: promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8") : undefined,
  env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("DECK_") || key === "PI_CODING_AGENT_DIR")),
  cwd: process.cwd(),
  pid: process.pid,
};
record.startedAt = Date.now();
const log = (entry) => { if (process.env.FAKE_PI_LOG) fs.appendFileSync(process.env.FAKE_PI_LOG, `${JSON.stringify(entry)}\n`); };
log(record);

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const assistant = (text, extra = {}) => ({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], model: flag("--model") ?? "default-model", stopReason: "stop", usage: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8, cost: { total: 0.001 } }, ...extra } });

if (task.includes("IGNORE_TERM")) process.on("SIGTERM", () => { /* ignore */ });
if (task.includes("FAIL")) {
  process.stderr.write("fake pi failure: model not found\n");
  process.exit(1);
}
if (task.includes("HOLD")) {
  emit({ type: "agent_start" });
  setTimeout(() => {
    emit(assistant(`HELD: ${task.replace(/^Task: /, "")}`));
    log({ pid: process.pid, endedAt: Date.now() });
    process.exit(0);
  }, 250);
} else if (task.includes("SLEEP") || task.includes("IGNORE_TERM")) {
  emit({ type: "agent_start" });
  setInterval(() => {}, 1000);
} else {
  emit({ type: "agent_start" });
  emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: task }] } });
  emit(assistant(`ECHO(${flag("--model") ?? "inherit"}|${flag("--thinking") ?? "-"}|${flag("--tools") ?? "all"}): ${task.replace(/^Task: /, "")}`));
  emit({ type: "agent_end", messages: [] });
}
