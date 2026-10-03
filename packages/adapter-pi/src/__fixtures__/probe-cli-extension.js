// Test-only global Pi extension: records tool_call / tool_result events (PROBE_LOG) so contract tests can prove
// what the runtime emitted around Deck's tool_call pipeline.
import fs from "node:fs";

export default function (pi) {
  const log = (entry) => { if (process.env.PROBE_LOG) fs.appendFileSync(process.env.PROBE_LOG, `${JSON.stringify(entry)}\n`); };
  pi.on("tool_call", (event) => { log({ ev: "tool_call", tool: event.toolName, command: event.input?.command, path: event.input?.path }); });
  pi.on("tool_result", (event) => { log({ ev: "tool_result", tool: event.toolName, isError: event.isError, command: event.input?.command }); });
}
