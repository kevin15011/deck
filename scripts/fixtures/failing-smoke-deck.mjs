// Offline smoke failure fixture: the daemon starts, but the terminal never attaches.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const state = join(process.env.XDG_STATE_HOME, "deck");
if (args[0] === "--version") console.log("deck fixture");
else if (args[1] === "self-test") console.log('{"ok":true}');
else if (args[1] === "status") console.log('{"running":false}');
else if (args[1] === "ack-claude-tos") {
  const config = join(process.env.XDG_CONFIG_HOME, "deck");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.json"), "{}");
} else if (args[0] === "internal" || args[0] === "cross") {
  mkdirSync(state, { recursive: true });
  writeFileSync(join(process.env.TMPDIR, `${args[0]}.pid`), String(process.pid));
  if (args[0] === "internal") { mkdirSync(join(state, "daemon"), { recursive: true }); writeFileSync(join(state, "daemon", "daemon.json"), "{}"); }
  setInterval(() => {}, 1000);
}
