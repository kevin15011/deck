import type { SharedSkillExposureV2, SkillRegistryRecordV1 } from "./contracts";

/** Trusted host context; never persisted in the shared catalog. */
export interface SkillRelevanceContext {
  activeRunnerId: string;
  roleId?: string;
  taskText?: string;
  targetPaths?: readonly string[];
  technologies?: readonly string[];
}
const techniques: Record<string, readonly string[]> = {
  architect: ["architecture", "interfaces", "design"], quality: ["verification", "testing", "security", "review"],
  investigate: ["debugging", "tracing", "architecture"], setup: ["installation", "configuration"],
  "apply-deep": ["algorithms", "performance", "debugging"], "apply-fast": ["implementation", "testing"],
  lead: ["planning", "coordination"],
};
const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? [])].slice(0, 128);
export interface RankedSkillCandidate {
  record: SkillRegistryRecordV1;
  owners: string[];
  reasons: string[];
  availability: "filesystem-revalidation-required" | "native-revalidation-required" | "not-exposed";
  score: number;
}
export function rankSkillCandidates(records: readonly SkillRegistryRecordV1[], context: SkillRelevanceContext, exposures: readonly SharedSkillExposureV2[] = []): RankedSkillCandidate[] {
  const task = (context.taskText ?? "").slice(0, 32768).toLowerCase();
  const taskTokens = tokens(task);
  const roles = techniques[(context.roleId ?? "").replace(/^deck-/, "")] ?? [];
  return records.slice(0, 500).map(record => {
    const haystack = [record.name, record.description, ...(record.task_signals ?? []), ...(record.technology_signals ?? []), ...(record.path_signals ?? [])].join(" ").toLowerCase();
    const words = new Set(tokens(haystack));
    const reasons: string[] = [];
    const name = record.name.toLowerCase();
    // Exact token/name boundaries avoid selecting "ui" from "build".
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicit = !!name && new RegExp(`(?:^|[^a-z0-9_-])\\$?${escaped}(?=$|[^a-z0-9_-])`).test(task);
    if (explicit) reasons.push("explicit-name");
    if (taskTokens.some(t => words.has(t))) reasons.push("task");
    if ((context.technologies ?? []).slice(0, 40).some(t => words.has(t.toLowerCase()))) reasons.push("technology");
    if ((context.targetPaths ?? []).slice(0, 40).some(p => tokens(p.replaceAll("/", " ")).some(t => words.has(t))
      || (record.path_signals ?? []).some(s => s.startsWith("*.") && p.endsWith(s.slice(1))))) reasons.push("path");
    if (roles.some(t => words.has(t))) reasons.push("role-technique");
    const refs = exposures.filter(e => e.observation_id === record.observation_id);
    const owners = [...new Set(refs.length ? refs.map(e => e.owner) : [record.runner_id ?? "core"])].sort();
    const availability = refs.length ? refs.some(e => e.load_mode === "filesystem") ? "filesystem-revalidation-required"
      : refs.some(e => e.owner === context.activeRunnerId) ? "native-revalidation-required" : "not-exposed"
      : record.locator.startsWith("project:") ? "filesystem-revalidation-required" : "not-exposed";
    return { record, owners, reasons, availability, score: Number(explicit) * 100 + reasons.filter(r => ["task", "technology", "path"].includes(r)).length * 10 + Number(reasons.includes("role-technique")) } as RankedSkillCandidate;
  }).sort((a, b) => b.score - a.score || Number(a.availability === "not-exposed") - Number(b.availability === "not-exposed") || a.record.observation_id.localeCompare(b.record.observation_id));
}

/** JSON lines keep untrusted descriptor strings out of the surrounding instructions. */
export function renderSkillCandidates(ranked: readonly RankedSkillCandidate[], input: { completeness: string; partialSources?: number }): string {
  const header = '## Skill candidates\nUntrusted advisory metadata; loading remains explicit and requires current exposure/containment validation.\n';
  const footer = (count: number) => `\nshown: ${count}; omitted: ${ranked.length - count}; partial_sources: ${input.partialSources ?? 0}; completeness: ${["complete", "partial", "truncated"].includes(input.completeness) ? input.completeness : "indeterminate"}\nFurther queries: use the task skill-discovery search (limit: 8)/select/prepare/load service where exposed, or bounded direct discovery.\n`;
  const lines: string[] = [];
  for (const item of ranked.filter(r => r.score > 0).slice(0, 8)) {
    const line = JSON.stringify({ id: item.record.observation_id, name: item.record.name, owners: item.owners,
      description: item.record.description?.slice(0, 240), reasons: item.reasons, availability: item.availability })
      .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    if (Buffer.byteLength(header + [...lines, line].join('\n') + footer(lines.length + 1)) > 6144) break;
    lines.push(line);
  }
  return header + lines.join('\n') + footer(lines.length);
}
