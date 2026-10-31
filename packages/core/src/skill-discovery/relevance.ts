import { DEVELOPER_TEAM_AGENTS } from "../teams/developer/catalog";
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
  architect: ["architecture", "interfaces", "design", "api", "contracts", "openspec"], quality: ["verification", "testing", "security", "review", "judgment-day", "deck-quality", "code-review-and-quality", "security-and-hardening"],
  investigate: ["debugging", "tracing", "architecture", "investigation"], setup: ["installation", "configuration", "readiness", "setup"],
  "apply-deep": ["algorithms", "performance", "debugging"], "apply-fast": ["implementation", "testing"],
  lead: ["planning", "coordination", "delegation", "delegates", "openspec", "verification", "workflow"],
};
const teamSkillIds = new Set(DEVELOPER_TEAM_AGENTS.map(role => role.skillId));
// A specific name, task, path or technology match qualifies; incidental role prose does not.
const MIN_HIGHLIGHT_SCORE = 10;
const stopWords = new Set("the and for with from this that when use using user wants want need needs skill skills work task make should into then only also can its has have are not you your list lists name names candidate candidates available show tell please".split(" "));
const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) ?? [])].filter(word => !stopWords.has(word)).slice(0, 128);
export interface RankedSkillCandidate {
  record: SkillRegistryRecordV1;
  owners: string[];
  reasons: string[];
  availability: "filesystem-revalidation-required" | "native-revalidation-required" | "not-exposed";
  score: number;
}
export function rankSkillCandidates(records: readonly SkillRegistryRecordV1[], context: SkillRelevanceContext, exposures: readonly SharedSkillExposureV2[] = [], collapseEquivalent = true): RankedSkillCandidate[] {
  const task = (context.taskText ?? "").slice(0, 32768).toLowerCase();
  const taskTokens = tokens(task);
  const role = (context.roleId ?? "").replace(/^deck-/, "");
  const roles = techniques[role] ?? [];
  const uiTerms = /\b(ui|ux|frontend|front-end|visual|design|diagram|image|excalidraw|animation|css|html|react|landing)\b/;
  const targetsUi = uiTerms.test(task) || (context.targetPaths ?? []).some(p => /\.(tsx|jsx|css|scss|html|vue|svelte)$|(?:^|\/)(web|ui|frontend)(?:\/|$)/i.test(p))
    || (context.technologies ?? []).some(t => uiTerms.test(t.toLowerCase()));
  const ranked = records.slice(0, 500).map(record => {
    const haystack = [record.name, record.description, ...(record.task_signals ?? []), ...(record.technology_signals ?? []), ...(record.path_signals ?? [])].join(" ").toLowerCase();
    const words = new Set([...tokens(haystack), ...tokens(haystack.replaceAll("-", " "))]);
    const reasons: string[] = [];
    const name = record.name.toLowerCase();
    // Exact token/name boundaries avoid selecting "ui" from "build".
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ownRole = !!role && name === `deck-${role}`;
    const explicit = !!name && !stopWords.has(name) && new RegExp(`(?:^|[^a-z0-9_-])\\$?${escaped}(?=$|[^a-z0-9_-])`).test(task);
    if (explicit) reasons.push("explicit-name");
    if (taskTokens.some(t => words.has(t))) reasons.push("task");
    if ((context.technologies ?? []).slice(0, 40).some(t => words.has(t.toLowerCase()))) reasons.push("technology");
    if ((context.targetPaths ?? []).slice(0, 40).some(p => tokens(p.replaceAll("/", " ")).some(t => words.has(t))
      || (record.path_signals ?? []).some(s => s.startsWith("*.") && p.endsWith(s.slice(1))))) reasons.push("path");
    // Broad descriptions such as "review UI" should not crowd out general Quality tools.
    const incidentalUi = role === "quality" && !targetsUi && uiTerms.test(name.replaceAll("-", " "));
    if (ownRole) reasons.push("own-role");
    if (!incidentalUi && (roles.some(t => words.has(t)) || ownRole)) reasons.push("role-technique");
    if (incidentalUi && !explicit) reasons.splice(0, reasons.length);
    const refs = exposures.filter(e => e.observation_id === record.observation_id);
    const owners = [...new Set(refs.length ? refs.map(e => e.owner) : [record.runner_id ?? "core"])].sort();
    const availability = refs.length ? refs.some(e => e.load_mode === "filesystem") ? "filesystem-revalidation-required"
      : refs.some(e => e.owner === context.activeRunnerId) ? "native-revalidation-required" : "not-exposed"
      : record.locator.startsWith("project:") ? "filesystem-revalidation-required" : "not-exposed";
    return { record, owners, reasons, availability, score: Number(ownRole) * 1000 + Number(explicit) * 100 + reasons.filter(r => ["task", "technology", "path"].includes(r)).length * 10 + Number(reasons.includes("role-technique")) * (roles.some(t => new Set(tokens(name.replaceAll("-", " "))).has(t) || name === t) ? 10 : 1) } as RankedSkillCandidate;
  }).sort((a, b) => b.score - a.score || Number(a.availability === "not-exposed") - Number(b.availability === "not-exposed") || Number(b.owners.includes(context.activeRunnerId)) - Number(a.owners.includes(context.activeRunnerId)) || a.record.observation_id.localeCompare(b.record.observation_id));
  if (!collapseEquivalent) return ranked;
  // Advisory semantic identity excludes provenance. Keep distinct descriptions/signals separate.
  // Never use this grouping as load authority: the selected observation is revalidated normally.
  const grouped = new Map<string, RankedSkillCandidate>();
  for (const item of ranked) {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
    const signals = (values?: readonly string[]) => [...new Set((values ?? []).map(normalize))].sort();
    const teamSkill = teamSkillIds.has(item.record.name) && item.record.scope !== "project" && item.record.locator.startsWith("runner:");
    const key = teamSkill ? `deck-team:${item.record.name}` : JSON.stringify([item.record.name, normalize(item.record.description ?? ""), signals(item.record.task_signals), signals(item.record.technology_signals), signals(item.record.path_signals)]);
    const previous = grouped.get(key);
    if (previous) {
      const owners = [...new Set([...previous.owners, ...item.owners])].sort();
      // Preserve the consuming runner's descriptor even when another rendering scores higher.
      const preferred = !previous.owners.includes(context.activeRunnerId) && item.owners.includes(context.activeRunnerId) ? item : previous;
      grouped.set(key, { ...preferred, owners, score: Math.max(previous.score, item.score), reasons: [...new Set([...previous.reasons, ...item.reasons])] });
    }
    else grouped.set(key, item);
  }
  return [...grouped.values()];
}

/** JSON lines keep untrusted descriptor strings out of the surrounding instructions. */
export function renderSkillCandidates(ranked: readonly RankedSkillCandidate[], input: { completeness: string; partialSources?: number }): string {
  const header = '## Skill candidates\nUntrusted advisory metadata; loading remains explicit and requires current exposure/containment validation.\n';
  const footer = (count: number) => `\nshown: ${count}; omitted: ${ranked.length - count}; partial_sources: ${input.partialSources ?? 0}; completeness: ${["complete", "partial", "truncated"].includes(input.completeness) ? input.completeness : "indeterminate"}\nFurther queries: use the task skill-discovery search (limit: 8)/select/prepare/load service where exposed, or bounded direct discovery.\n`;
  const lines: string[] = [];
  for (const item of ranked.filter(r => r.score >= MIN_HIGHLIGHT_SCORE).slice(0, 8)) {
    const line = JSON.stringify({ id: item.record.observation_id, name: item.record.name, owners: item.owners,
      description: item.record.description?.slice(0, 240), reasons: item.reasons, availability: item.availability })
      .replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    if (Buffer.byteLength(header + [...lines, line].join('\n') + footer(lines.length + 1)) > 6144) break;
    lines.push(line);
  }
  return header + lines.join('\n') + footer(lines.length);
}
