import { existsSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { hashContent } from "./pi-manifest";
import type { PiDesiredFile, PiFileIO, PiGlobalPlan } from "./pi-global-install";

const OWNERSHIP = "Deck project skill exclusions";
function skillName(text: string | undefined): string | undefined {
  if (!text || text.length > 1024 * 1024) return undefined;
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  try { const name = header && parse(header[1]!).name; return typeof name === "string" ? name : undefined; }
  catch { return undefined; }
}
function assertSafeTarget(path: string): void {
  if ((existsSync(dirname(path)) && lstatSync(dirname(path)).isSymbolicLink()) || (existsSync(path) && lstatSync(path).isSymbolicLink())) throw new Error("Refusing to modify symlinked Pi project settings");
}
/** Recheck destinations before the shared transaction starts, not after global writes commit. */
export function assertPiProjectSkillExclusionTargets(plan: PiGlobalPlan): void {
  for (const entry of plan.mutationPreview) if (entry.ownership === OWNERSHIP) assertSafeTarget(entry.path);
}

/** Pure preflight: join narrow project exclusions to the existing approval, snapshot and rollback transaction. */
export function planPiProjectSkillExclusions(plan: PiGlobalPlan, projectRoot: string, files: readonly PiDesiredFile[], io: PiFileIO): void {
  const installed = files.flatMap(file => {
    const match = /^deck\/package\/skills\/([^/]+)\/SKILL\.md$/.exec(file.relPath);
    const name = match && skillName(file.content);
    return match && name ? [{ id: match[1]!, name }] : [];
  });
  const roots = [join(resolve(projectRoot), ".pi/skills")];
  let dir = resolve(projectRoot);
  while (true) {
    roots.push(join(dir, ".agents/skills"));
    const parent = dirname(dir);
    if (parent === dir || existsSync(join(dir, ".git"))) break;
    dir = parent;
  }
  const exclusions = roots.flatMap(root => installed.flatMap(({ id, name }) => {
    const path = join(root, id, "SKILL.md");
    return skillName(io.readText(path)) === name ? [`-${path}`] : [];
  }));
  if (!exclusions.length) return;
  const path = join(resolve(projectRoot), ".pi/settings.json");
  assertSafeTarget(path);
  const before = io.readText(path);
  const settings = before === undefined ? {} : JSON.parse(before);
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || (settings.skills !== undefined && (!Array.isArray(settings.skills) || settings.skills.some((s: unknown) => typeof s !== "string")))) throw new Error("Pi project settings are malformed; no skill exclusions were planned");
  const existing: string[] = settings.skills ?? [];
  const additions = [...new Set(exclusions)].filter(entry => !existing.includes(entry));
  if (!additions.length) return;
  const add = (target: string, content: string, preimage: string | undefined, kind: "settings" | "backup") => {
    assertSafeTarget(target);
    const change = { kind, action: preimage === undefined ? "create" as const : "update" as const, relPath: target, path: target,
      preimage: preimage === undefined ? "absent" : hashContent(preimage), postimage: hashContent(content) };
    plan.changes.push(change);
    plan.mutationPreview.push({ ...change, ownership: OWNERSHIP });
    plan.writes.push({ path: target, content, mode: 0o600, expectedPre: change.preimage });
  };
  if (before !== undefined && io.readText(path + ".deck-backup") === undefined) add(path + ".deck-backup", before, undefined, "backup");
  add(path, JSON.stringify({ ...settings, skills: [...existing, ...additions] }, null, 2) + "\n", before, "settings");
}
