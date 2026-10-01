import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, openSync, readSync, closeSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, open, realpath, rm, link } from "node:fs/promises";
import { get } from "node:https";
import { join, dirname } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export const CLAUDE_CODEBASE_VERSION = "0.11.0";
export type CodebaseNativeRelease = Readonly<{ asset: string; archiveBytes: number; archiveSha256: string; binaryBytes: number; binarySha256: string }>;
export const CLAUDE_CODEBASE_RELEASES = Object.freeze({
  "linux-x64": { asset: "codebase-memory-mcp-linux-amd64-portable.tar.gz", archiveBytes: 40607189, archiveSha256: "1f9e8293eb2bc5c05cfa27a7e8fc033da6d729ffad525ccfcdaa3fd606306683", binaryBytes: 299891744, binarySha256: "ce11c141431aeadd788506c3a7e6942db8fd438dec369d0707a39ec9fd8c6510" },
  "linux-arm64": { asset: "codebase-memory-mcp-linux-arm64-portable.tar.gz", archiveBytes: 39780389, archiveSha256: "d62eeb224d5ee3eba3070938ec62cf1033f10b041ec1c4b2fb67f7aef390cc7b", binaryBytes: 299227216, binarySha256: "403d0fab6204e712916701936a3229dd472bad05080c757ea5177318a80fdbfe" },
  "darwin-x64": { asset: "codebase-memory-mcp-darwin-amd64.tar.gz", archiveBytes: 41662649, archiveSha256: "dbf1c73bfcbde64e7dde4cd1320da7afc02e2c972ee1789ae039521411f5132e", binaryBytes: 301399520, binarySha256: "69ca71b4b62fe233677851bdf54953e2a6660cf5d687b4d64226b2591b14ed39" },
  "darwin-arm64": { asset: "codebase-memory-mcp-darwin-arm64.tar.gz", archiveBytes: 41117691, archiveSha256: "4dee7f38b63740e6751d7a7ed7eb10291c1f2a3ea2415f599dc68370ca0a2d18", binaryBytes: 302755632, binarySha256: "a67b7ccead5d2ca852051f8619458ab96af41393257b56fb36e523a110265d48" },
} satisfies Readonly<Record<string, CodebaseNativeRelease>>);

const sha = (buffer: Uint8Array) => createHash("sha256").update(buffer).digest("hex");
export const pinnedClaudeCodebaseRelease = (platform = process.platform, arch = process.arch): CodebaseNativeRelease | undefined => CLAUDE_CODEBASE_RELEASES[`${platform}-${arch}` as keyof typeof CLAUDE_CODEBASE_RELEASES];

function hashFileBounded(path: string, size: number): string | undefined {
  const fd = openSync(path, "r");
  try {
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, size + 1 - total), null);
      if (count === 0) break;
      total += count;
      if (total > size) return undefined;
      digest.update(buffer.subarray(0, count));
    }
    return total === size ? digest.digest("hex") : undefined;
  } finally { closeSync(fd); }
}

/** Never trust the npm shim: only the pinned, directly verified native executable can be ready. */
export function inspectOwnedClaudeCodebase(root: string, release: CodebaseNativeRelease): "absent" | "ready" | "conflict" {
  try {
    const directory = lstatSync(root);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || typeof process.getuid === "function" && directory.uid !== process.getuid()) return "conflict";
    const members = readdirSync(root);
    if (members.length !== 1 || members[0] !== "codebase-memory-mcp") return "conflict";
    const stat = lstatSync(join(root, members[0]));
    if (!stat.isFile() || stat.size !== release.binaryBytes || (stat.mode & 0o111) === 0 || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) return "conflict";
    return hashFileBounded(join(root, members[0]), release.binaryBytes) === release.binarySha256 ? "ready" : "conflict";
  } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(root) ? "absent" : "conflict"; }
}

async function download(release: CodebaseNativeRelease): Promise<Uint8Array> {
  const start = `https://github.com/DeusData/codebase-memory-mcp/releases/download/v${CLAUDE_CODEBASE_VERSION}/${release.asset}`;
  const hosts = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
  const visit = (address: string, redirects: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const target = new URL(address);
    if (target.protocol !== "https:" || !hosts.has(target.hostname) || redirects > 2) { reject(new Error("Codebase Memory release redirect is untrusted.")); return; }
    const request = get(target, { timeout: 120_000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const next = response.headers.location;
        response.resume();
        if (!next) reject(new Error("Codebase Memory release redirect is missing."));
        else visit(new URL(next, target).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Codebase Memory pinned release is unavailable.")); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => { total += chunk.length; if (total > release.archiveBytes) { request.destroy(new Error("Codebase Memory release exceeded its bound.")); return; } chunks.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Codebase Memory pinned release timed out.")));
    request.on("error", reject);
  });
  return visit(start, 0);
}

/** Stream exactly the pinned tar members; never extract install.sh or run npm's self-downloading shim. */
async function extractBinary(archive: Uint8Array, target: string, release: CodebaseNativeRelease): Promise<void> {
  const expected = new Set(["codebase-memory-mcp", "LICENSE", "install.sh", "THIRD_PARTY_NOTICES.md"]);
  const seen = new Set<string>();
  const hash = createHash("sha256");
  const output = await open(target, "wx", 0o700);
  let pending = Buffer.alloc(0);
  let remaining = 0;
  let padding = 0;
  let name = "";
  let footer = false;
  let total = 0;
  let binaryBytes = 0;
  try {
    for await (const raw of Readable.from([archive]).pipe(createGunzip())) {
      const chunk = Buffer.from(raw);
      total += chunk.length;
      if (total > 320 * 1024 * 1024) throw new Error("Codebase Memory archive expanded beyond its bound.");
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length > 0) {
        if (footer) {
          if (pending.some((byte) => byte !== 0)) throw new Error("Codebase Memory archive has unexpected trailing data.");
          pending = Buffer.alloc(0);
          break;
        }
        if (remaining === 0 && padding > 0) {
          const skip = Math.min(padding, pending.length);
          pending = pending.subarray(skip);
          padding -= skip;
          if (padding > 0) break;
          continue;
        }
        if (remaining === 0) {
          if (pending.length < 512) break;
          const header = pending.subarray(0, 512);
          pending = pending.subarray(512);
          if (header.every((byte) => byte === 0)) { footer = true; continue; }
          const end = header.indexOf(0);
          name = header.subarray(0, end < 0 ? 100 : end).toString("utf8");
          const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
          if (!expected.has(name) || seen.has(name) || ![0, 48].includes(header[156]!) || !/^[0-7]+$/.test(sizeText)) throw new Error("Codebase Memory archive member is untrusted.");
          seen.add(name);
          remaining = Number.parseInt(sizeText, 8);
          if (remaining > 305 * 1024 * 1024 || name === "codebase-memory-mcp" && remaining !== release.binaryBytes) throw new Error("Codebase Memory archive member size is untrusted.");
          padding = (512 - remaining % 512) % 512;
          if (remaining === 0) continue;
        }
        const take = Math.min(remaining, pending.length);
        if (take === 0) break;
        if (name === "codebase-memory-mcp") {
          let offset = 0;
          while (offset < take) {
            const written = (await output.write(pending.subarray(offset, take))).bytesWritten;
            if (!written) throw new Error("Codebase Memory native binary write failed.");
            offset += written;
          }
          hash.update(pending.subarray(0, take));
          binaryBytes += take;
        }
        pending = pending.subarray(take);
        remaining -= take;
      }
    }
    if (!footer || pending.length || remaining || padding || seen.size !== expected.size || binaryBytes !== release.binaryBytes || hash.digest("hex") !== release.binarySha256) throw new Error("Codebase Memory pinned native binary integrity mismatch.");
    await output.sync();
  } finally { await output.close(); }
}

/** Reviewed, Deck-owned native acquisition; the next session performs no download. */
export async function installOwnedClaudeCodebase(root: string, release: CodebaseNativeRelease, effects: { fetchArchive?: (asset: string) => Promise<Uint8Array> } = {}): Promise<"installed" | "unchanged"> {
  const before = inspectOwnedClaudeCodebase(root, release);
  if (before === "ready") return "unchanged";
  if (before !== "absent") throw new Error("Codebase Memory native destination conflicts with unknown content.");
  const archive = await (effects.fetchArchive?.(release.asset) ?? download(release));
  if (archive.length !== release.archiveBytes || sha(archive) !== release.archiveSha256) throw new Error("Codebase Memory release archive integrity mismatch.");
  const parent = dirname(root);
  const stage = await mkdtemp(join(parent, ".codebase-native-stage-"));
  try {
    await extractBinary(archive, join(stage, "codebase-memory-mcp"), release);
    if (inspectOwnedClaudeCodebase(stage, release) !== "ready" || inspectOwnedClaudeCodebase(root, release) !== "absent") throw new Error("Codebase Memory native publication is unsafe.");
    await mkdir(root, { mode: 0o700 });
    await link(join(stage, "codebase-memory-mcp"), join(root, "codebase-memory-mcp"));
  } finally { if (await realpath(stage).catch(() => undefined) === stage) await rm(stage, { recursive: true, force: true }); }
  if (inspectOwnedClaudeCodebase(root, release) !== "ready") throw new Error("Codebase Memory native publication is indeterminate; manual recovery required.");
  return "installed";
}
