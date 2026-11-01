import { lstatSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { RunnerLaunchPlan } from "@deck/core";

/** The same provider-supported protocol binding for native and managed launches. */
export function buildClaudeSupermemoryLaunchOverlay(credential: { token: string; canonicalRepoTag?: string }): NonNullable<RunnerLaunchPlan["envOverlay"]> {
  return {
    SUPERMEMORY_CC_API_KEY: { value: credential.token, sensitive: true },
    SUPERMEMORY_API_URL: { value: "https://api.supermemory.ai" },
    SUPERMEMORY_MCP_URL: { value: "https://mcp.supermemory.ai/mcp" },
    SUPERMEMORY_API_VERSION: { value: credential.canonicalRepoTag ? "v5" : "legacy" },
    ...(credential.canonicalRepoTag ? { SUPERMEMORY_REPO_TAG: { value: credential.canonicalRepoTag } } : {}),
  };
}

/** Only reviewed installation writes the supported full-conversation setting. */
export function configureClaudeSupermemoryCapture(home: string): void {
  if (!isAbsolute(home)) throw new Error("Claude HOME must be absolute");
  const directory = join(home, ".supermemory-claude");
  for (let current = directory; ; current = dirname(current)) {
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0) || typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0) throw new Error("Unsafe Claude Supermemory settings directory");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(current) === current) break;
  }
  const path = join(directory, "settings.json");
  let config: Record<string, unknown> = {};
  let original: string | undefined;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024 || (stat.mode & 0o022) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("Unsafe Claude Supermemory settings");
    original = readFileSync(path, "utf8");
    config = JSON.parse(original);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid Claude Supermemory settings");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (config.signalExtraction === false) return;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ ...config, signalExtraction: false }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (original !== undefined && (lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== original)) throw new Error("Claude Supermemory settings changed during installation");
    if (original === undefined) {
      try { lstatSync(path); throw new Error("Claude Supermemory settings appeared during installation"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
