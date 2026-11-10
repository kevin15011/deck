import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// The probe never exposes native responses or credentials.
export async function authenticate(command: string, args: readonly string[], env: Record<string, string>, timeoutMs = 10000): Promise<string> {
  const child = spawn(command, [...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let closeResolve!: () => void;
  const closed = new Promise<void>(resolve => { closeResolve = resolve; child.once("close", resolve); });
  let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  let bytes = 0, id = 0;
  const fail = () => { const current = pending; pending = undefined; current?.reject(new Error("bridge-probe-failed")); };
  lines.on("line", line => {
    bytes += Buffer.byteLength(line);
    if (bytes > 1024 * 1024) return fail();
    try {
      const message = JSON.parse(line);
      if (!pending || message.id !== pending.id) return;
      const current = pending; pending = undefined;
      if (message.error || !Object.hasOwn(message, "result")) current.reject(new Error("bridge-probe-failed"));
      else current.resolve(message.result);
    } catch { fail(); }
  });
  child.on("error", fail); child.stdin.on("error", fail); child.on("close", fail);
  const timer = setTimeout(fail, timeoutMs);
  const request = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    pending = { id: ++id, resolve, reject };
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  let outcome = "failed";
  try {
    const init = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "deck-isolation-probe", version: "1" } });
    if (!init || typeof init !== "object") throw new Error("bridge-probe-failed");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const result = await request("tools/call", { name: "deck_status", arguments: {} });
    if (!result || typeof result !== "object") throw new Error("bridge-probe-failed");
    const value = result as { isError?: unknown; content?: unknown };
    outcome = value.isError !== true && Array.isArray(value.content) && value.content.length > 0 && value.content.every(item => item && typeof item === "object" && typeof item.type === "string") ? "verified" : "failed";
  } catch { outcome = "failed"; }
  finally {
    clearTimeout(timer); lines.close(); child.stdin.destroy(); child.kill("SIGKILL");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const didClose = await Promise.race([closed.then(() => true), new Promise<false>(resolve => { cleanupTimer = setTimeout(() => resolve(false), 1000); })]);
    if (!didClose) outcome = "cleanup-failed";
    if (cleanupTimer) clearTimeout(cleanupTimer);
    child.removeListener("close", closeResolve);
  }
  return outcome;
}
