// Test entry standing in for `deck internal session-daemon` (compiled build wires the same function).
import { join } from "node:path";
import { runSessionDaemon } from "../../daemon-main";

const code = await runSessionDaemon({
  version: process.env.DECK_TEST_VERSION ?? "1.0.0",
  anchorCommand: [process.execPath, "run", join(import.meta.dir, "anchor-entry.ts")],
});
process.exit(code);
