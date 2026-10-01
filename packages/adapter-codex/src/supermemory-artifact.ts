import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * Official `supermemoryai/codex-supermemory` plugin, pinned to one immutable npm release.
 * Only the two documented lifecycle hooks are materialised (UserPromptSubmit recall and Stop flush);
 * the plugin's own installer, its hosted-MCP proxy and its `~/.codex` mutations are never run.
 */
export const CODEX_SUPERMEMORY_VERSION = "1.0.19";
export const CODEX_SUPERMEMORY_TARBALL_URL = `https://registry.npmjs.org/codex-supermemory/-/codex-supermemory-${CODEX_SUPERMEMORY_VERSION}.tgz`;
export const CODEX_SUPERMEMORY_TARBALL = Object.freeze({
  bytes: 149209,
  sha256: "32c48d598199566b6dceedf0f84cff8db49bf7123fa88ab17c745879fbfb42a4",
  /** npm registry `dist.integrity`; kept as provenance evidence for the registry-published artifact. */
  integrity: "sha512-ZzEPI8Dxo+j50O91ZdQVsIfrR/KhVS7ur9oc/sdgUHy/NcQ1FYZzgGzM7Bpf0lhu3kmvr0B5yY9buIKU1Hohrw==",
});
export type CodexSupermemoryFileEntry = readonly [name: string, tarPath: string, sha256: string, bytes: number];
export const CODEX_SUPERMEMORY_FILES: readonly CodexSupermemoryFileEntry[] = Object.freeze([
  ["recall.js", "package/dist/hooks/recall.js", "62d5c106fd4537accbc6241ed51d79c455821f31cc74ff6fcde44aab66877f1a", 34443],
  ["flush.js", "package/dist/hooks/flush.js", "b146633584cd90d7616cd616d32abadce3c6d9ceb88ef28b19541effe851ef34", 111541],
] as const);
export const CODEX_SUPERMEMORY_ROOT_NAME = `official-supermemory-${CODEX_SUPERMEMORY_VERSION}`;
/** Runtime credential name read by the official plugin (injected only into the launched child process). */
export const CODEX_SUPERMEMORY_ENV_KEY = "SUPERMEMORY_CODEX_API_KEY";

export type CodexSupermemoryTarballPin = Readonly<{ bytes: number; sha256: string }>;
/** `pin` is a hermetic-test seam only; production always uses the pinned npm release. */
export type CodexSupermemoryArtifactEffects = Readonly<{ fetchTarball?: () => Promise<Uint8Array>; pin?: CodexSupermemoryTarballPin }>;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Read-only verification: unknown bytes, extra entries or loose permissions fail closed. */
export function inspectCodexSupermemoryArtifact(root: string, entries: readonly CodexSupermemoryFileEntry[] = CODEX_SUPERMEMORY_FILES): "absent" | "ready" | "conflict" {
  try {
    const directory = lstatSync(root);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || (typeof process.getuid === "function" && directory.uid !== process.getuid())) return "conflict";
    const names = new Set(entries.map((entry) => entry[0]));
    for (const child of readdirSync(root)) if (!names.has(child)) return "conflict";
    for (const [name, , digest, bytes] of entries) {
      const stat = lstatSync(join(root, name));
      if (!stat.isFile() || stat.size !== bytes || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return "conflict";
      if (sha256(readFileSync(join(root, name))) !== digest) return "conflict";
    }
    return "ready";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(root) ? "absent" : "conflict";
  }
}

/** Minimal bounded ustar reader; only requested regular files are returned. */
export function extractCodexSupermemoryFiles(tarball: Uint8Array, entries: readonly CodexSupermemoryFileEntry[] = CODEX_SUPERMEMORY_FILES, pin: CodexSupermemoryTarballPin = CODEX_SUPERMEMORY_TARBALL): Map<string, Buffer> {
  if (tarball.length !== pin.bytes || sha256(tarball) !== pin.sha256) throw new Error("Pinned Codex Supermemory release integrity mismatch.");
  const tar = gunzipSync(tarball, { maxOutputLength: 4 * 1024 * 1024 });
  const wanted = new Map(entries.map((entry) => [entry[1], entry]));
  const found = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const octal = header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
    if (!/^[0-7]+$/.test(octal)) throw new Error("Pinned Codex Supermemory archive length is invalid.");
    const length = Number.parseInt(octal, 8);
    const type = header[156]!;
    const bodyStart = offset + 512;
    if (bodyStart + length > tar.length) throw new Error("Pinned Codex Supermemory archive is truncated.");
    const entry = wanted.get(path);
    if (entry && (type === 0 || type === 48)) {
      const body = Buffer.from(tar.subarray(bodyStart, bodyStart + length));
      if (body.length !== entry[3] || sha256(body) !== entry[2]) throw new Error("Pinned Codex Supermemory file integrity mismatch.");
      found.set(entry[0], body);
    }
    offset = bodyStart + Math.ceil(length / 512) * 512;
  }
  for (const entry of entries) if (!found.has(entry[0])) throw new Error("Pinned Codex Supermemory archive is missing an expected hook.");
  return found;
}

async function fetchTarball(): Promise<Uint8Array> {
  const url = new URL(CODEX_SUPERMEMORY_TARBALL_URL);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") throw new Error("Pinned Codex Supermemory source is untrusted.");
  return new Promise((resolve, reject) => {
    const request = get(url, { timeout: 20_000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Pinned Codex Supermemory release is unavailable.")); return; }
      const parts: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > CODEX_SUPERMEMORY_TARBALL.bytes) { request.destroy(new Error("Pinned Codex Supermemory release exceeded its bound.")); return; }
        parts.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(parts)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Pinned Codex Supermemory release timed out.")));
    request.on("error", reject);
  });
}

/** Parent is already a validated owner-only Deck tools directory; nothing outside `root` is touched. */
export async function installCodexSupermemoryArtifact(root: string, effects: CodexSupermemoryArtifactEffects = {}, entries: readonly CodexSupermemoryFileEntry[] = CODEX_SUPERMEMORY_FILES): Promise<"installed" | "unchanged"> {
  const state = inspectCodexSupermemoryArtifact(root, entries);
  if (state === "ready") return "unchanged";
  if (state !== "absent") throw new Error("Codex Supermemory owned installation conflicts with unknown content.");
  const files = extractCodexSupermemoryFiles(await (effects.fetchTarball?.() ?? fetchTarball()), entries, effects.pin); // all integrity checks precede publication
  if (inspectCodexSupermemoryArtifact(root, entries) !== "absent") throw new Error("Codex Supermemory destination changed during download.");
  await mkdir(root, { mode: 0o700 });
  for (const [name, body] of files) await writeFile(join(root, name), body, { flag: "wx", mode: 0o600 });
  if (inspectCodexSupermemoryArtifact(root, entries) !== "ready") throw new Error("Codex Supermemory publication needs manual inspection; no indeterminate files were removed.");
  return "installed";
}
