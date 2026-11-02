import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join, relative, sep } from "node:path";

/** Official supermemoryai/claude-supermemory plugin tree at the immutable upstream commit. */
export const CLAUDE_SUPERMEMORY_COMMIT = "d42bd8066f0a5b6360a91e60c59772ef1134cab6";
export const CLAUDE_SUPERMEMORY_FILES = Object.freeze([
  [".claude-plugin/plugin.json", "2f7446346ab6c8af483feeef7213d1e0f2c16704c21ff220fa3188c96114ec06", 546],
  [".mcp.json", "d65e1e806f31a0debdcf4af7e2f5411123554d5b915e650b973aa7b42e1e58b9", 107],
  ["agents/context-gatherer.md", "e68b5da5cd983f70da143908733ceadcea73553e2b0e505986d2318356203299", 2480],
  ["commands/index.md", "69cac15efbda7cb302dd9fb1758f2a40f1efd17ba65b85635dd7ea69f28eb833", 9479],
  ["commands/status.md", "f0abc9eacbc11a05a46e1115ff6a6361f133197a751fa37aa3072034e2593d71", 1643],
  ["hooks/auth-server.js", "1f2337e4b151551c05b37e2206b6e574a595c6b9c56f105f83731d7e6883bfaa", 371],
  ["hooks/capture.js", "c6094d6e2e885324db60f7d779fc23371a4687f204bb4f12a0707b3328c29930", 3940],
  ["hooks/hooks.json", "9405545b41d3f60be3a719c457289d1691b00146ce01b8b740fc888b16556390", 1291],
  ["hooks/lib/api.js", "37bb17b84937dd99a91a56b6076cab1c1a1472e71151277abefca6625361475b", 6175],
  ["hooks/lib/auth.js", "563563b8dd69305b974dcc2198751905b58d49c239452a6702f49ebd0e295411", 21643],
  ["hooks/lib/colors.js", "0bb5927284ec806632fcb9c869910a0badf166ff186ca2342059eda0daefd70f", 518],
  ["hooks/lib/container-tag.js", "2423904ec3b357411cf8daa1e3060481a2d7eeb0e8e32ba6756361333f5909a8", 4002],
  ["hooks/lib/error-helpers.js", "9095c17833b82d27c2c9eee781e260ca11d36e96b67c1ed82373bf55ef03243e", 2017],
  ["hooks/lib/git-utils.js", "728cfe3621df9dc3965039f632b36678d9244322b69c147fa18cac918d6cb6dc", 1297],
  ["hooks/lib/last-session.js", "107974aabbf3fc03ef82b73ea306308c7ca51fc5607df3ea85a84f270b1f65ea", 1079],
  ["hooks/lib/project-config.js", "29aaa6e6d88e7dd3ce9e41a2d42106813defca9630beb2544237843db8a741da", 1169],
  ["hooks/lib/redact.js", "d0b1b4aef801f62758bb3e6f628ba7433ce4cc29e75c66526e835ec2cfa89d18", 2088],
  ["hooks/lib/session-state.js", "8a504196fad9b27890285ec4bcd69809756ca21b927c50476b4e26dffd155b28", 4471],
  ["hooks/lib/settings.js", "9f13dcc7603def2f339f3aaccb52e7613e9723f1a9e6c9b55520fdf3e89c7018", 5952],
  ["hooks/lib/statusline-state.js", "dc0678ea304a93954fd3a29cf922dcad2ce0f28ea920a4db3e6ec7ab9e805dfb", 5293],
  ["hooks/lib/stdin.js", "2d6b90c06e5cdb8d7ef552876eb34221776152573bf17ec5379038a00387ac77", 1599],
  ["hooks/lib/transcript.js", "1002bc0ef8309b0a58b027fbfca045a140897cc84e07499458dd2ec69a83427f", 16822],
  ["hooks/mcp-proxy.js", "77d6e8c5345ae6f30ff44a2a3816b0bf623d85b2b9e9fdf970bf73aabffba0d5", 4331],
  ["hooks/recall-approve.js", "c5d2667064ad0daf06d46e7e5d5f27b704ab19804836a618aef6e1f2909deb5f", 2220],
  ["hooks/recall-directive.js", "d1302b81c001f5f203310a89e23901aba323fd9ae027a7916f95fc0d36969644", 9737],
  ["hooks/recall-strip.js", "76d08a39497ab433c36168de75244091819432cb39c3b91c2d615fa619255965", 5232],
  ["hooks/session-start.js", "06a00bf18b45426d52904f0f11c1c10f6d608a5945609678d40fda51f8593e26", 9478],
  ["hooks/status.js", "d54d4576aab401aaa2b5c25c5edec8c6d24923e6bf68500468e996b781e5013a", 2145],
  ["hooks/templates/auth-error.html", "564e9cbec2e1a04a3e391f31018575c8ea206cfe07f5b12c6cd42767478e86a3", 900],
  ["hooks/templates/auth-success.html", "916a18ebcd3ca8d6164f59a44af0f28e831b73fd21610ca252774bc4109e42e2", 148739],
  ["hooks/vendor/LICENSE-supermemory", "ce882ad1a82ea184e2ba2a06788fa3da714fdf98a3deaabb062a0eef88484074", 11341],
  ["hooks/vendor/supermemory.cjs", "e60a926a4d2d90a7115b6e28c82c68b06536ab833227c96b610b50829ac62e1c", 67230],
  ["statusline.js", "c9c99eb8f32f52b3d059ffd1c9e991946ee24b87f2d0a31067391ab9f3d882ef", 8852],
] as const satisfies readonly (readonly [string, string, number])[]);

type Entry = readonly [string, string, number];
export type ClaudeSupermemoryArtifactEffects = Readonly<{ fetchFile?: (path: string, maxBytes: number) => Promise<Uint8Array> }>;
const digest = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

function assertSafeEntry(entry: Entry): void {
  const [name, checksum, size] = entry;
  if (!/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(name) || name.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(checksum) || size < 1 || size > 256 * 1024) throw new Error("Pinned Claude Supermemory entry is invalid.");
}

/** Claude writes mutable editor types with normal umask permissions, even during a live session. */
function isSafeGeneratedEntry(root: string, target: string): boolean {
  const name = relative(root, target).split(sep).join("/");
  const types = ".claude-plugin/types";
  if (name !== "tsconfig.json" && name !== types && !name.startsWith(`${types}/`)) return false;
  try {
    const stat = lstatSync(target);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) return false;
    if (stat.isDirectory()) {
      if (name === "tsconfig.json") return false;
      return readdirSync(target).every(child => isSafeGeneratedEntry(root, join(target, child)));
    }
    // Never admit runtime modules/configuration or follow links in the generated tree.
    return stat.isFile() && stat.nlink === 1 && (stat.mode & 0o111) === 0
      && (name === "tsconfig.json" || name === `${types}/tsconfig.json` || name === `${types}/.gitignore`
        || name.startsWith(`${types}/`) && name.endsWith(".d.ts"));
  } catch (error) {
    // Optional generated entries can disappear while Claude refreshes them.
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Read-only verification; pinned bytes stay exact, with only safe generated editor artifacts allowed. */
export function inspectClaudeSupermemoryArtifact(root: string, entries: readonly Entry[] = CLAUDE_SUPERMEMORY_FILES): "absent" | "ready" | "conflict" {
  try { if (!existsSync(root)) { lstatSync(root); return "conflict"; } }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "conflict"; }
  try {
    const files = new Set(entries.map((entry) => { assertSafeEntry(entry); return join(root, entry[0]); }));
    const directories = new Set([root]);
    for (const file of files) {
      let current = dirname(file);
      while (current !== root) { if (!current.startsWith(`${root}${sep}`)) throw new Error("Plugin path escaped root."); directories.add(current); current = dirname(current); }
    }
    for (const directory of directories) {
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) return "conflict";
      for (const child of readdirSync(directory)) {
        const target = join(directory, child);
        if (!directories.has(target) && !files.has(target) && !isSafeGeneratedEntry(root, target)) return "conflict";
      }
    }
    for (const [name, checksum, size] of entries) {
      const target = join(root, name);
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.size !== size || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid() || digest(readFileSync(target)) !== checksum) return "conflict";
    }
    return "ready";
  } catch { return "conflict"; }
}

async function fetchPinned(path: string, limit: number): Promise<Uint8Array> {
  const url = `https://raw.githubusercontent.com/supermemoryai/claude-supermemory/${CLAUDE_SUPERMEMORY_COMMIT}/plugin/${path}`;
  return new Promise((resolve, reject) => {
    const request = get(url, { timeout: 15_000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error("Official Claude Supermemory artifact is unavailable.")); return; }
      const parts: Buffer[] = [];
      let count = 0;
      response.on("data", (chunk: Buffer) => {
        count += chunk.length;
        if (count > limit) { request.destroy(new Error("Official Claude Supermemory artifact exceeds its bound.")); return; }
        parts.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(parts)));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("Official Claude Supermemory download timed out.")));
    request.on("error", reject);
  });
}

/** Parent must already be a validated, owner-only Deck directory. Never overwrites a published plugin. */
export async function installClaudeSupermemoryArtifact(
  root: string,
  effects: ClaudeSupermemoryArtifactEffects = {},
  entries: readonly Entry[] = CLAUDE_SUPERMEMORY_FILES,
): Promise<"installed" | "unchanged"> {
  const before = inspectClaudeSupermemoryArtifact(root, entries);
  if (before === "ready") return "unchanged";
  if (before !== "absent") throw new Error("Claude Supermemory plugin conflicts with unknown owned content.");
  const parent = dirname(root);
  const directory = lstatSync(parent);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || typeof process.getuid === "function" && directory.uid !== process.getuid()) throw new Error("Claude Supermemory parent is not owner-only.");
  const fetchFile = effects.fetchFile ?? fetchPinned;
  // Verify ALL pinned bytes before any published path is created.
  const payload: Array<{ name: string; content: Uint8Array }> = [];
  for (const entry of entries) {
    assertSafeEntry(entry);
    const bytes = await fetchFile(entry[0], entry[2] + 1);
    if (bytes.length !== entry[2] || digest(bytes) !== entry[1]) throw new Error("Official Claude Supermemory artifact integrity mismatch.");
    payload.push({ name: entry[0], content: bytes });
  }
  if (inspectClaudeSupermemoryArtifact(root, entries) !== "absent") throw new Error("Claude Supermemory destination changed during download.");
  await mkdir(root, { mode: 0o700 }); // exclusive: never replaces someone else's plugin
  for (const file of payload) {
    const target = join(root, file.name);
    if (relative(root, target).startsWith("..")) throw new Error("Plugin path escaped root.");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.content, { flag: "wx", mode: 0o600 });
  }
  if (inspectClaudeSupermemoryArtifact(root, entries) !== "ready") throw new Error("Claude Supermemory publication needs manual inspection; no uncertain files were removed.");
  return "installed";
}
