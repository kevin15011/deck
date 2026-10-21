import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { DECK_PI_MEMORY_ENV_BLANKS } from "./pi-mcp-env";
import { isAbsolute } from "node:path";

export const CODEBASE_GUARD_COMMAND = "codebase-mcp-guard-v1";
export type CodebaseGuardInvocation = { command: string; script?: string; executableId: string; scriptId?: string };
export type CodebaseGuardArgs = { agentDir: string; binary: string; executableId: string; scriptId?: string };
const pathOK = (value: string) => isAbsolute(value) && !/[\0\r\n]/.test(value);
const idOK = (value: string) => /^[1-9][0-9]{0,9}:[a-f0-9]{64}$/.test(value) && Number(value.split(":")[0]) <= 1024 ** 3;

/** Exact bounded receipt; guard trust is recorded in the ownership-hashed MCP selection. No new cache. */
export function codebaseGuardFileId(path: string): string {
  if (!pathOK(path) || realpathSync(path) !== path) throw new Error("pi-codebase-guard-invalid");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > 1024n ** 3n) throw new Error("pi-codebase-guard-invalid");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    while (total <= Number(before.size)) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) + 1 - total), null);
      if (!count) break;
      hash.update(buffer.subarray(0, count)); total += count;
    }
    const after = fstatSync(fd, { bigint: true });
    const pathAfter = statSync(path, { bigint: true });
    if (pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) throw new Error("pi-codebase-guard-invalid");
    if (total !== Number(before.size) || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("pi-codebase-guard-invalid");
    return `${before.size}:${hash.digest("hex")}`;
  } finally { closeSync(fd); }
}
export function createCodebaseGuardInvocation(command: string, script?: string): CodebaseGuardInvocation {
  const canonicalCommand = realpathSync(command), canonicalScript = script === undefined ? undefined : realpathSync(script);
  if ((statSync(canonicalCommand).mode & 0o111) === 0) throw new Error("pi-codebase-guard-invalid");
  return { command: canonicalCommand, executableId: codebaseGuardFileId(canonicalCommand), ...(canonicalScript ? { script: canonicalScript, scriptId: codebaseGuardFileId(canonicalScript) } : {}) };
}
export function codebaseGuardCliArgs(input: CodebaseGuardArgs): string[] {
  return ["--agent-dir", input.agentDir, "--binary", input.binary, "--guard-id", input.executableId, ...(input.scriptId ? ["--script-id", input.scriptId] : [])];
}
export function parseCodebaseGuardArgs(args: readonly string[]): CodebaseGuardArgs | undefined {
  if ((args.length !== 6 && args.length !== 8) || args[0] !== "--agent-dir" || args[2] !== "--binary" || args[4] !== "--guard-id" || (args.length === 8 && args[6] !== "--script-id")) return undefined;
  if (!pathOK(args[1]!) || !pathOK(args[3]!) || !idOK(args[5]!) || (args.length === 8 && !idOK(args[7]!))) return undefined;
  return { agentDir: args[1]!, binary: args[3]!, executableId: args[5]!, ...(args[7] ? { scriptId: args[7] } : {}) };
}
export function buildCodebaseGuardEntry(invocation: CodebaseGuardInvocation, agentDir: string, binary: string) {
  return { command: invocation.command, args: [...(invocation.script ? [invocation.script] : []), "internal", CODEBASE_GUARD_COMMAND, ...codebaseGuardCliArgs({ agentDir, binary, executableId: invocation.executableId, scriptId: invocation.scriptId })], env: { ...DECK_PI_MEMORY_ENV_BLANKS }, exposure: "direct" as const };
}
/** Shape-only parser for owned transactional migration; never grants permission to execute. */
export function parseCodebaseGuardEntry(value: unknown, agentDir: string): (CodebaseGuardArgs & { command: string; script?: string }) | undefined {
  if (!value || typeof value !== "object") return undefined;
  const config = value as { command?: unknown; args?: unknown };
  if (!Array.isArray(config.args) || !config.args.includes(CODEBASE_GUARD_COMMAND)) return undefined;
  const args = config.args as unknown[];
  const offset = args[0] === "internal" ? 0 : 1;
  if (args[offset] !== "internal" || args[offset + 1] !== CODEBASE_GUARD_COMMAND || args.some(arg => typeof arg !== "string") || typeof config.command !== "string") throw new Error("pi-codebase-guard-invalid");
  if (Object.keys(config).some(key => !["command", "args", "env", "exposure", "enabled"].includes(key)) || (config as { exposure?: unknown }).exposure !== "direct") throw new Error("pi-codebase-guard-invalid");
  const env = (config as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env) || Object.keys(env).length !== Object.keys(DECK_PI_MEMORY_ENV_BLANKS).length || Object.entries(DECK_PI_MEMORY_ENV_BLANKS).some(([key, value]) => (env as Record<string, unknown>)[key] !== value)) throw new Error("pi-codebase-guard-invalid");
  const parsed = parseCodebaseGuardArgs(args.slice(offset + 2) as string[]);
  const script = offset ? args[0] as string : undefined;
  if (!parsed || parsed.agentDir !== agentDir || Boolean(script) !== Boolean(parsed.scriptId) || parsed.binary === config.command || parsed.binary === script) throw new Error("pi-codebase-guard-invalid");
  return { ...parsed, command: config.command, ...(script ? { script } : {}) };
}
export function inspectCodebaseGuardEntry(value: unknown, agentDir: string) {
  const parsed = parseCodebaseGuardEntry(value, agentDir);
  if (!parsed) return undefined;
  try {
    if ((statSync(parsed.command).mode & 0o111) === 0 || codebaseGuardFileId(parsed.command) !== parsed.executableId || (parsed.script && codebaseGuardFileId(parsed.script) !== parsed.scriptId)) throw new Error("pi-codebase-guard-invalid");
  } catch { throw new Error("pi-codebase-guard-invalid"); }
  return parsed;
}
