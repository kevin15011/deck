import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { PreparationMember } from "./preparation";

/** Metadata observations only: never starts an executable, contacts MCP or grants tools.
 * Adapters supply their own selected paths; this reader does not discover other runners.
 */
export class PrerequisiteEvidence {
  private files = new Map<string, { fingerprint: string; text: string }>();
  read(path: string): string {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.size > 1024n * 1024n) throw new Error("prerequisite-file-unverified");
    const fingerprint = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":");
    const previous = this.files.get(path);
    if (previous?.fingerprint === fingerprint) return previous.text;
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size !== stat.size || before.ino !== stat.ino || before.dev !== stat.dev) throw new Error("prerequisite-file-changed");
      const bytes = Buffer.alloc(Number(stat.size) + 1), size = readSync(fd, bytes, 0, bytes.length, 0);
      const after = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
      if (BigInt(size) !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs || current.ino !== stat.ino || current.dev !== stat.dev) throw new Error("prerequisite-file-changed");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
      this.files.set(path, { fingerprint, text });
      if (this.files.size > 32) this.files.delete(this.files.keys().next().value!);
      return text;
    } finally { closeSync(fd); }
  }
  executable(command: string | undefined, path = process.env.PATH): string {
    if (!command || /[\0\r\n]/.test(command)) throw new Error("prerequisite-executable-missing");
    const resolved = isAbsolute(command) ? command : Bun.which(command, { PATH: path });
    if (!resolved) throw new Error("prerequisite-executable-missing");
    const target = realpathSync(resolved), stat = statSync(target, { bigint: true });
    if (!stat.isFile() || !(stat.mode & 0o111n)) throw new Error("prerequisite-executable-missing");
    return [target, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":");
  }
  observe(enabled: boolean, collect: () => readonly unknown[]): PreparationMember["capabilities"][string] {
    if (!enabled) return { enabled: false };
    try {
      return { enabled: true, availability: "unverified", prerequisites: "present", inputDigest: createHash("sha256").update(JSON.stringify(collect())).digest("hex") };
    } catch {
      return { enabled: true, availability: "unavailable", prerequisites: "missing", inputDigest: "prerequisites-unavailable" };
    }
  }
}

/** Read a pinned executable literal from Deck's generated hook, without evaluation. */
export function pinnedHookExecutable(source: string): string | undefined {
  const literal = source.match(/^const binary = ("(?:[^"\\]|\\.)*");$/m)?.[1];
  return literal ? JSON.parse(literal) : undefined;
}

/** Decode only the two single-quoted arguments emitted by Deck, never arbitrary shell. */
export function pinnedHookRuntime(command: string, script: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const suffix = ` ${quote(script)}`;
  if (!command.endsWith(suffix)) throw new Error("hook-command-unverified");
  const token = command.slice(0, -suffix.length);
  const runtime = token.slice(1, -1).replaceAll("'\\''", "'");
  if (quote(runtime) !== token) throw new Error("hook-command-unverified");
  return runtime;
}
