import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";

type PreparedRecord = { text: string; root: string; epoch: string; generation: string; preparation?: import("./preparation").PreparationSnapshot; refresh?: { endpoint: string; token: string } };

/** Consume host-prepared evidence only. A snapshot reference never grants repair authority. */
function readPreparedRecord(projectRoot: string, environment: Readonly<Record<string, string | undefined>>): PreparedRecord | undefined {
  const reference = environment.DECK_SESSION_START_CONTEXT;
  if (!reference) return undefined;
  const fd = openSync(reference, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 256 * 1024 || before.mode & 0o077 || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("session-start-context-untrusted");
    const bytes = Buffer.alloc(256 * 1024 + 1), size = readSync(fd, bytes, 0, bytes.length, 0);
    const after = fstatSync(fd);
    if (size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("session-start-context-changed");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    if (createHash("sha256").update(raw).digest("hex") !== environment.DECK_SESSION_START_DIGEST) throw new Error("session-start-context-digest-mismatch");
    const value = JSON.parse(raw);
    if (value.root !== realpathSync(projectRoot) || value.epoch !== environment.DECK_SESSION_START_EPOCH || value.generation !== environment.DECK_SESSION_START_GENERATION || typeof value.text !== "string") throw new Error("session-start-context-binding-mismatch");
    return value;
  } finally { closeSync(fd); }
}

export function readPreparedSessionStartContext(projectRoot: string, environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  return readPreparedRecord(projectRoot, environment)?.text;
}

/** Lifecycle-only refresh from the owning native launch. Never accepts scope or repair requests. */
export async function loadPreparedSessionStartRecord(projectRoot: string, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<PreparedRecord | undefined> {
  const record = readPreparedRecord(projectRoot, environment);
  if (!record?.refresh) return record;
  const endpoint = new URL(record.refresh.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/readiness" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("session-start-endpoint-untrusted");
  const response = await fetch(endpoint, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${record.refresh.token}` }, signal: AbortSignal.timeout(2000) });
  if (!response.ok || !response.body) throw new Error("session-start-refresh-unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 256 * 1024) throw new Error("session-start-refresh-too-large");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value.root !== record.root || value.epoch !== record.epoch || value.generation !== record.generation || typeof value.text !== "string") throw new Error("session-start-context-binding-mismatch");
  return { ...value, refresh: record.refresh };
}

export async function loadPreparedSessionStartContext(projectRoot: string, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<string | undefined> {
  return (await loadPreparedSessionStartRecord(projectRoot, environment))?.text;
}
