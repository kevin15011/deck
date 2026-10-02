import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

export const OWNED_RTK_VERSION = "0.50.0";
export type RtkReleaseArtifact = Readonly<{ asset: string; archiveSha256: string; archiveBytes: number; binarySha256: string; binaryBytes: number }>;
export const OWNED_RTK_RELEASES = Object.freeze({
  "linux-x64": { asset: "rtk-x86_64-unknown-linux-musl.tar.gz", archiveSha256: "bc2b8902b0d9c796c82ef45f16ae2307e17757afeca5ee156235a3dc7bda5f89", archiveBytes: 4857739, binarySha256: "23433a2a50bdeb12199cadd4b94b639238d6c38529fcba1c30c9295db5fa9517", binaryBytes: 11040640 },
  "linux-arm64": { asset: "rtk-aarch64-unknown-linux-gnu.tar.gz", archiveSha256: "d1cc49dfa2cd443fc32625444b59fe616b6c80478cca210985118347174dd758", archiveBytes: 4462410, binarySha256: "a5dc2c362aa563087388732b227756d1ef008bcd01f6bd84c07aca9ebe085ad7", binaryBytes: 9267808 },
  "darwin-x64": { asset: "rtk-x86_64-apple-darwin.tar.gz", archiveSha256: "ac23e20024ab3c71e7f50069f8b34190aec1b2d8f0c2cc19834039b3dac73373", archiveBytes: 4512079, binarySha256: "a4c3c6e179dcb12518358c834c7e244496161380da3a73727bd781521395f075", binaryBytes: 9860992 },
  "darwin-arm64": { asset: "rtk-aarch64-apple-darwin.tar.gz", archiveSha256: "fe54761a9950266e3a78ddb66a8af5e067251169da306a288e0751de63d836fe", archiveBytes: 4122143, binarySha256: "09aa3e6f79f994235f9ad86bc5c290ce04a663e73c6d018e00deac96475c786e", binaryBytes: 8458000 },
} satisfies Readonly<Record<string, RtkReleaseArtifact>>);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function pinnedOwnedRtkRelease(platform = process.platform, arch = process.arch): RtkReleaseArtifact | undefined {
  return OWNED_RTK_RELEASES[`${platform}-${arch}` as keyof typeof OWNED_RTK_RELEASES];
}

export function inspectOwnedRtk(root: string, release: RtkReleaseArtifact): "absent" | "ready" | "conflict" {
  try {
    const directory = lstatSync(root);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || typeof process.getuid === "function" && directory.uid !== process.getuid()) return "conflict";
    const entries = readdirSync(root);
    if (entries.length !== 1 || entries[0] !== "rtk") return "conflict";
    const binary = join(root, "rtk");
    const stat = lstatSync(binary);
    if (!stat.isFile() || stat.size !== release.binaryBytes || (stat.mode & 0o111) === 0 || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) return "conflict";
    return sha256(readFileSync(binary)) === release.binarySha256 ? "ready" : "conflict";
  } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(root) ? "absent" : "conflict"; }
}

export function extractPinnedRtk(archive: Uint8Array, release: RtkReleaseArtifact): Buffer {
  if (archive.length !== release.archiveBytes || sha256(archive) !== release.archiveSha256) throw new Error("Pinned RTK release integrity mismatch.");
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  if (tar.length < 1024 || tar.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "") !== "rtk" || ![0, 48].includes(tar[156]!)) throw new Error("Pinned RTK archive structure is invalid.");
  const octal = tar.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]+$/.test(octal)) throw new Error("Pinned RTK archive length is invalid.");
  const length = Number.parseInt(octal, 8);
  if (length !== release.binaryBytes || length > 16 * 1024 * 1024) throw new Error("Pinned RTK binary size is invalid.");
  const end = 512 + Math.ceil(length / 512) * 512;
  if (tar.length < end + 1024 || tar.subarray(end).some((byte) => byte !== 0)) throw new Error("Pinned RTK archive contains unexpected content.");
  const binary = tar.subarray(512, 512 + length);
  if (sha256(binary) !== release.binarySha256) throw new Error("Pinned RTK binary integrity mismatch.");
  return Buffer.from(binary);
}

async function fetchReleaseAsset(release: RtkReleaseArtifact): Promise<Uint8Array> {
  const url = `https://github.com/rtk-ai/rtk/releases/download/v${OWNED_RTK_VERSION}/${release.asset}`;
  const allowed = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
  const request = (target: string, redirects: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:" || !allowed.has(parsed.hostname) || redirects > 2) { reject(new Error("RTK release redirect is untrusted.")); return; }
    const child = get(target, { timeout: 15_000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        const next = response.headers.location;
        response.resume();
        if (!next) reject(new Error("Pinned RTK release redirected without a location."));
        else request(new URL(next, target).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Pinned RTK release is unavailable.")); return; }
      const parts: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => { total += chunk.length; if (total > release.archiveBytes) { child.destroy(new Error("Pinned RTK release exceeded its bound.")); return; } parts.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(parts)));
      response.on("error", reject);
    });
    child.on("timeout", () => child.destroy(new Error("Pinned RTK release timed out.")));
    child.on("error", reject);
  });
  return request(url, 0);
}

/** Parent is already a validated owner-only Deck tools directory; never invokes an upstream installer or global init. */
export async function installOwnedRtk(root: string, release: RtkReleaseArtifact, effects: { fetchArchive?: (asset: string) => Promise<Uint8Array> } = {}): Promise<"installed" | "unchanged"> {
  const state = inspectOwnedRtk(root, release);
  if (state === "ready") return "unchanged";
  if (state !== "absent") throw new Error("RTK owned installation conflicts with unknown content.");
  const archive = await (effects.fetchArchive?.(release.asset) ?? fetchReleaseAsset(release));
  const binary = extractPinnedRtk(archive, release); // all integrity checks precede publication
  if (inspectOwnedRtk(root, release) !== "absent") throw new Error("RTK owned destination changed during download.");
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, "rtk"), binary, { flag: "wx", mode: 0o700 });
  if (inspectOwnedRtk(root, release) !== "ready") throw new Error("RTK publication needs manual inspection; no indeterminate files were removed.");
  return "installed";
}
