/** A live process-group anchor: cleanup never signals a persisted or reaped leader PID. */
export const CHILD_SUPERVISOR_SOURCE = String.raw`
import { spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const nonce = process.env.DECK_PI_SUPERVISOR_NONCE;
let worker, terminal = false;
const keepAlive = setInterval(() => {}, 1000);
const endGroup = () => { process.kill(-process.pid, "SIGKILL"); };
// Group TERM reaches the worker; keep the anchor alive until terminal cleanup/KILL.
process.on("SIGTERM", () => {});
process.on("disconnect", endGroup);
if (!process.connected) endGroup();
process.on("message", message => {
  if (message?.type === "deck_cleanup" && message.nonce === nonce && terminal) return endGroup();
  if (!terminal && worker?.connected) worker.send(message, () => {});
});
const finish = (code, signal, error) => {
  if (terminal) return;
  terminal = true;
  if (!process.connected) return endGroup();
  process.send({ type: "deck_child_exit", nonce, code, signal, error }, () => {});
  // Parent must relinquish signal ownership before allowing anchor cleanup.
  // A dead parent closes IPC and triggers endGroup; never exit/reap this anchor early.
};
try {
  const env = { ...process.env, DECK_PI_GROUP_PID: String(process.pid) };
  delete env.DECK_PI_SUPERVISOR_NONCE;
  worker = spawn(command, args, { detached: false, shell: false, stdio: ["ignore", "pipe", "pipe", "ipc"], env });
  const outputDone = Promise.all([worker.stdout, worker.stderr].map(stream => new Promise(resolve => {
    stream.once("end", () => resolve(true));
    stream.once("error", () => resolve(false));
    stream.once("close", () => resolve(stream.readableEnded));
  })));
  worker.stdout.pipe(process.stdout, { end: false });
  worker.stderr.pipe(process.stderr, { end: false });
  worker.on("message", message => {
    if (!process.connected) return;
    if (message?.type === "deck_child_exit" || message?.type === "deck_cleanup") return;
    if (message?.version === 1 && message.nonce === process.env.DECK_PI_CONTAINMENT) {
      if (message.pid !== worker.pid) return;
      message = { ...message, pid: process.pid };
    }
    process.send(message, () => {});
  });
  worker.once("exit", async (code, signal) => {
    // Exit is not EOF: descendants can still own pipes. Never promote partial output to success.
    let timer;
    const drained = await Promise.race([outputDone.then(done => done.every(Boolean)),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000); })]);
    clearTimeout(timer);
    if (!drained) return finish(1, signal, "Delegated output streams did not reach EOF before cleanup");
    process.stdout.write("", () => process.stderr.write("", () => finish(code, signal)));
  });
  worker.once("error", () => finish(1, null, "Unable to spawn delegated Pi executable"));
} catch { finish(1, null, "Unable to spawn delegated Pi executable"); }
`;
