import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join, relative, sep } from "node:path";

/** Official supermemoryai/claude-supermemory plugin tree at the immutable upstream commit. */
export const CLAUDE_SUPERMEMORY_COMMIT = "915aba1b8056ddb3630fa833973032ba6b788fdb";
export const CLAUDE_SUPERMEMORY_FILES = Object.freeze([
  [".claude-plugin/plugin.json", "3183a8b64a1c79b50e808cfb66453cfac9f4bd28bcfbc3a0e97a20a038af1c9f", 546],
  [".mcp.json", "d65e1e806f31a0debdcf4af7e2f5411123554d5b915e650b973aa7b42e1e58b9", 107],
  ["agents/context-gatherer.md", "e68b5da5cd983f70da143908733ceadcea73553e2b0e505986d2318356203299", 2480],
  ["commands/index.md", "69cac15efbda7cb302dd9fb1758f2a40f1efd17ba65b85635dd7ea69f28eb833", 9479],
  ["commands/status.md", "4fa32e0b1ce8247854857d4783578125b5952ad019c7975b36bc3a46ac69ef88", 1516],
  ["hooks/capture.js", "3cd1e3f504e1a38f186a0755eb074de9fa06d505622848901a2403b9af58c566", 2967],
  ["hooks/hooks.json", "bffe993fa75b47879e2b5a14f94822e7f9d2a0bff78f2e65572ba66ee298e8ed", 1255],
  ["hooks/lib/api.js", "a4e99eb9a6b58992da1528c799c9fd74917277b5fe2e32c286d99143cacd4673", 2786],
  ["hooks/lib/auth.js", "75e7240e54a03b450de5438f7bc086806e0f9804fba7e1e8cf7f91bc77304be4", 3866],
  ["hooks/lib/colors.js", "bf71b0b97199ca980c80063af1c8e8c7cdfd7a9680e1cb5e50b2c7bcd6b4dbbe", 642],
  ["hooks/lib/container-tag.js", "c6b9f2d1e8d36d2e292a95acb8760db85bfa521a144413b10a8235c92210ecf3", 3894],
  ["hooks/lib/error-helpers.js", "a92ac1a4beea2956f3ca095ef908f463d9c354282f855503574b097417189e67", 2620],
  ["hooks/lib/git-utils.js", "728cfe3621df9dc3965039f632b36678d9244322b69c147fa18cac918d6cb6dc", 1297],
  ["hooks/lib/last-session.js", "107974aabbf3fc03ef82b73ea306308c7ca51fc5607df3ea85a84f270b1f65ea", 1079],
  ["hooks/lib/project-config.js", "29aaa6e6d88e7dd3ce9e41a2d42106813defca9630beb2544237843db8a741da", 1169],
  ["hooks/lib/settings.js", "052921416fde24daaea8e5670d3eeda5c862ee448d0bab9732150bfee40a9415", 4212],
  ["hooks/lib/statusline-state.js", "dc0678ea304a93954fd3a29cf922dcad2ce0f28ea920a4db3e6ec7ab9e805dfb", 5293],
  ["hooks/lib/stdin.js", "2d6b90c06e5cdb8d7ef552876eb34221776152573bf17ec5379038a00387ac77", 1599],
  ["hooks/lib/transcript.js", "59daec5071dc21edba512884ed0837a5b026849f5ffa011f72150de0150dae35", 13441],
  ["hooks/mcp-proxy.js", "ea43d976479acc75e2f64adf86babbf6e1858495df4da2d7746b433102a9a39d", 4117],
  ["hooks/recall-approve.js", "fa194e80da38f3981e958a627fa2f069944dee0d686c00a80b782af9346b4e01", 2220],
  ["hooks/recall-directive.js", "1ae2d53fb96e7998d51fc67b698f936437764912c35c8f5543d7cfaf7f6d11d9", 9415],
  ["hooks/session-start.js", "c6bb4a6953426ff21db367991575bf17527cc2303024ae14de86a3f9dffae4b0", 9388],
  ["hooks/templates/auth-error.html", "1d333704c9346d99ace6ad354bd085780ff7487b1feb496adb9b07353c99b531", 940],
  ["hooks/templates/auth-success.html", "916a18ebcd3ca8d6164f59a44af0f28e831b73fd21610ca252774bc4109e42e2", 148739],
  ["statusline.js", "c9c99eb8f32f52b3d059ffd1c9e991946ee24b87f2d0a31067391ab9f3d882ef", 8852],
] as const satisfies readonly (readonly [string, string, number])[]);

type Entry = readonly [string, string, number];
export type ClaudeSupermemoryArtifactEffects = Readonly<{ fetchFile?: (path: string, maxBytes: number) => Promise<Uint8Array> }>;
const digest = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

function assertSafeEntry(entry: Entry): void {
  const [name, checksum, size] = entry;
  if (!/^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(name) || name.split("/").includes("..") || !/^[a-f0-9]{64}$/.test(checksum) || size < 1 || size > 256 * 1024) throw new Error("Pinned Claude Supermemory entry is invalid.");
}

/** Read-only verification; unknown bytes or extra files fail closed. */
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
      for (const child of readdirSync(directory)) if (!directories.has(join(directory, child)) && !files.has(join(directory, child))) return "conflict";
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
