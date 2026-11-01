import { lstatSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertTrustedAncestors } from "./private-path";

/** Provider-supported settings. Only the reviewed plugin install writes them, never preparation. */
export async function configureCodexSupermemoryCapture(home: string): Promise<void> {
  const directory = join(home, ".codex");
  assertTrustedAncestors(directory, home);
  const path = join(directory, "supermemory.json");
  let config: Record<string, unknown> = {};
  let original: string | undefined;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024 || (stat.mode & 0o022) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("Unsafe Codex Supermemory settings");
    original = readFileSync(path, "utf8");
    try { config = JSON.parse(original); }
    catch { throw new Error("Invalid Codex Supermemory settings"); }
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid Codex Supermemory settings");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (config.signalExtraction === false) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ ...config, signalExtraction: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    // Refuse an intervening edit instead of replacing it with the inspected preimage.
    if (original !== undefined && (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== original)) throw new Error("Codex Supermemory settings changed during installation");
    if (original === undefined) {
      try { lstatSync(path); throw new Error("Codex Supermemory settings appeared during installation"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
