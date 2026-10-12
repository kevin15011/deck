// Long-lived descendant that records the signals it receives.
import { appendFileSync } from "node:fs";
const mark = process.env.FAKE_MARK;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { if (mark) appendFileSync(mark, `grandchild:${sig}\n`); });
}
setInterval(() => {}, 1000);
// Handlers are installed: tell the parent (so tests never race process start-up).
process.send?.({ ready: true });
