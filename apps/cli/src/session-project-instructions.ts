import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

const MAX_PROJECT_INSTRUCTION_BYTES = 64 * 1024;
const unavailable = (reason: string): Error => new Error(`project-instructions-unavailable: Project-root AGENTS.md ${reason}.`);

/** Claude does not load AGENTS.md natively. Read only the validated session root's file,
 * without following links, traversing ancestors, or silently truncating project rules.
 */
export function readSessionProjectInstructions(projectRoot: string): string | undefined {
  const path = join(projectRoot, "AGENTS.md");
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw unavailable("could not be inspected");
  }
  if (!stat.isFile()) throw unavailable("must be a regular file without a symbolic link");
  if (stat.size > MAX_PROJECT_INSTRUCTION_BYTES) throw unavailable("exceeds the 64 KiB limit");
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw unavailable("changed during inspection");
    const buffer = Buffer.alloc(MAX_PROJECT_INSTRUCTION_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > MAX_PROJECT_INSTRUCTION_BYTES) throw unavailable("exceeds the 64 KiB limit");
    const after = fstatSync(fd);
    const current = lstatSync(path);
    if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino || after.size !== offset || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw unavailable("changed during inspection");
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)); }
    catch { throw unavailable("must contain valid UTF-8 text"); }
    if (content.includes("\0")) throw unavailable("must contain text without NUL bytes");
    return content;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("project-instructions-unavailable:")) throw error;
    throw unavailable("could not be safely read");
  } finally { if (fd !== undefined) closeSync(fd); }
}
