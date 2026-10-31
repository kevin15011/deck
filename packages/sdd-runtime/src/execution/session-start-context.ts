import { readEphemeralSkillCatalog } from "../../../core/src/skill-discovery/shared";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

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

import { readinessContext } from "@deck/core/session/readiness-parity";
import type { PreparationSnapshot } from "@deck/core/session/preparation";
export function composeSessionStartContextV1(snapshot: PreparationSnapshot, runnerId = "claude"): string {
  return readinessContext(snapshot, runnerId === "claude" ? readSessionProjectInstructions(snapshot.scope.projectRoot) : undefined);
}

import { parseSkillRegistryDocument } from "../../../core/src/skill-discovery/registry";
import { rankSkillCandidates, renderSkillCandidates, type SkillRelevanceContext } from "../../../core/src/skill-discovery/relevance";

/** Bounded advisory files only; never follows a descriptor or writes a registry. */
function advisoryFile(file: string, maximum: number): string | undefined {
  let fd: number | undefined;
  try {
    if (realpathSync(dirname(file)) !== dirname(file)) return;
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maximum) return;
    const bytes = Buffer.alloc(maximum + 1);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    const after = fstatSync(fd);
    if (size !== before.size || size > maximum || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } catch { return; } finally { if (fd !== undefined) closeSync(fd); }
}
export function projectSkillCandidates(projectRoot: string, context: SkillRelevanceContext): string {
  let technologies: string[] = [];
  try {
    const manifest = JSON.parse(advisoryFile(join(projectRoot, "package.json"), 64 * 1024) ?? "{}");
    technologies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).slice(0, 40);
  } catch { /* Optional project hints never prevent startup. */ }
  const parsed = parseSkillRegistryDocument(advisoryFile(join(projectRoot, ".atl/skill-registry.md"), 512 * 1024) ?? "");
  const catalog = readEphemeralSkillCatalog(projectRoot) ?? (parsed.ok ? parsed.frontmatter : undefined);
  const ranked = rankSkillCandidates(catalog?.records ?? [], { ...context, technologies: context.technologies ?? technologies }, catalog?.exposures);
  return renderSkillCandidates(ranked, { partialSources: catalog?.sources?.filter(s => s.completeness === "partial").length, completeness: catalog?.completeness === "complete" ? "indeterminate" : catalog?.completeness ?? "indeterminate" });
}

/** Discovery metadata is separate from the protected readiness projection. */
export function composeSkillSessionStartContext(snapshot: PreparationSnapshot, runnerId = "claude", context?: { roleId?: string; taskText?: string; targetPaths?: readonly string[] }): string {
  const registry = snapshot.observations.find(o => o.component === "skill-registry");
  const discovery = { registry_path: ".atl/skill-registry.md", status: registry?.status === "ready" ? "ready" : "indeterminate",
    reason_code: registry?.reason ?? "missing_runtime_context", guidance: "Search shared candidates; revalidate before explicit loading", active_runner_id: runnerId, authority_reminder_version: "v1" };
  return [composeSessionStartContextV1(snapshot, runnerId), "## Skill Discovery Context\n" + JSON.stringify(discovery),
    projectSkillCandidates(snapshot.scope.projectRoot, { activeRunnerId: runnerId, ...context })].join("\n\n");
}
