import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { SKILL_DISCOVERY_V1_BOUNDS, type SkillDiscoverySourceProviderV1, type SkillDiscoverySourceBindingV1,
  type SkillRegistryRecordV1, type SharedSkillSourceV2, type SharedSkillExposureV2, type SkillRegistryFrontmatterV1 } from "./contracts";
import { createCoreGenericProjectSources, discoverSkills } from "./discovery";
import { canonicalizeSkillRegistry, orderSkillRegistryRecords, renderSkillRegistryBody, renderSkillRegistryMarkdown, type SkillRegistryCanonicalSnapshotV1 } from "./registry";
import { catalogDigest, sharedCatalogFingerprint, sharedSourceFingerprint } from "./shared-format";
const within = (root: string, target: string) => { const child = relative(root, target); return child === "" || child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child); };
export const sourceLocatorBase = (binding: SkillDiscoverySourceBindingV1, owner: string) => binding.declaration.locatorStrategy === "project_relative"
  ? `project:${binding.declaration.safeLocatorBase}` : `runner:${owner}:${binding.declaration.safeLocatorBase}`;

/** Each provider is evaluated under its own identity; executor/roster never chooses catalog scope. */
export async function discoverSharedSkillCatalog(input: {
  projectRoot: string; providers: readonly SkillDiscoverySourceProviderV1[]; generatedAt?: string;
}): Promise<SkillRegistryCanonicalSnapshotV1> {
  const providers = [...input.providers].sort((a, b) => a.runnerId.localeCompare(b.runnerId));
  if (providers.length > 4 || new Set(providers.map(p => p.runnerId)).size !== providers.length
    || providers.some(p => !["claude", "codex", "opencode", "pi"].includes(p.runnerId))) throw new Error("shared-providers-invalid");
  const sources: SharedSkillSourceV2[] = [], exposures: SharedSkillExposureV2[] = [];
  const records = new Map<string, SkillRegistryRecordV1>();
  const diagnostics: SkillRegistryFrontmatterV1["diagnostics"][number][] = [];
  let partial = providers.length !== 4, truncated = false;
  const core: SkillDiscoverySourceProviderV1 = { schema: "skill-discovery-source-provider-v1", runnerId: "core",
    listSources: async () => ({ outcome: "complete", sources: [], diagnostics: [] }), resolveLocator: async () => ({ status: "missing" }) };
  for (const provider of [core, ...providers]) {
    try {
      const sourceSet = await provider.listSources({ projectRoot: input.projectRoot });
      const discovery = await discoverSkills({ projectRoot: input.projectRoot, activeRunnerId: provider.runnerId, sourceSet });
      partial ||= discovery.outcome !== "complete" || provider.runnerId !== "core" && !sourceSet.sources.some(s => s.kind === "opaque_inventory");
      truncated ||= discovery.outcome === "indeterminate" && discovery.reasonCode === "truncated_output";
      const bindings = [...createCoreGenericProjectSources(input.projectRoot), ...sourceSet.sources];
      const canonical = canonicalizeSkillRegistry({ activeRunnerId: provider.runnerId, sourceDeclarations: bindings, discovery });
      diagnostics.push(...canonical.frontmatter.diagnostics.filter(d => d.code !== "truncated_output"));
      for (const declaration of canonical.sourceDeclarations) {
        const binding = bindings.find(b => b.declaration.sourceId === declaration.sourceId);
        if (!binding) continue;
        const owner = declaration.runnerId === "runner-neutral" ? "core" : provider.runnerId;
        const base = sourceLocatorBase(binding, provider.runnerId);
        if (sources.some(s => s.owner === owner && s.source_id === declaration.sourceId)) continue;
        if (sources.length >= 500) { truncated = true; continue; }
        const rows = canonical.frontmatter.records.filter(r => r.locator.startsWith(`${base}/`));
        sources.push({ source_id: declaration.sourceId, owner, category: declaration.sourceCategory, scope: declaration.scope,
          locator_base: base, load_mode: binding.kind === "filesystem" ? "filesystem" : "native",
          completeness: discovery.outcome === "complete" ? "complete" : "partial", fingerprint: catalogDigest([declaration, rows]) });
        for (const row of rows) {
          let identity = `${owner}:${row.locator}`;
          if (binding.kind === "filesystem") {
            try {
              const root = await fs.realpath(binding.absoluteRoot);
              const candidate = await fs.realpath(resolve(root, decodeURIComponent(row.locator.slice(base.length + 1))));
              if (!within(root, candidate) || !(await fs.stat(candidate)).isFile()) { partial = true; continue; }
              identity = candidate;
            } catch { partial = true; continue; }
          }
          if (!records.has(identity) && records.size >= SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords || exposures.length >= 2000) { truncated = true; continue; }
          const record = records.get(identity) ?? row;
          records.set(identity, record);
          exposures.push({ observation_id: record.observation_id, owner, source_id: declaration.sourceId, locator: row.locator,
            load_mode: binding.kind === "filesystem" ? "filesystem" : "native" });
        }
      }
    } catch {
      partial = true;
      diagnostics.push({ code: "source_provider_unavailable", source_id: provider.runnerId, message: "Configured provider inventory is unavailable; other sources remain usable." });
    }
  }
  sources.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  exposures.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const base = canonicalizeSkillRegistry({ activeRunnerId: "claude", diagnostics, generatedAt: input.generatedAt }).frontmatter;
  let frontmatter: SkillRegistryFrontmatterV1 = { ...base, schema: "skill-registry-v2", schema_version: 2,
    sources, exposures, records: orderSkillRegistryRecords([...records.values()]),
    candidate_count: records.size, completeness: truncated ? "truncated" : partial ? "partial" : "complete",
    source_scope_hash: sharedSourceFingerprint(sources) };
  const render = () => { frontmatter = { ...frontmatter, fingerprint: sharedCatalogFingerprint(frontmatter) }; return renderSkillRegistryMarkdown(frontmatter); };
  let document = render();
  while (Buffer.byteLength(document) > SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes && (frontmatter.records.length || frontmatter.sources!.length)) {
    const rows = frontmatter.records.slice(0, -1), ids = new Set(rows.map(r => r.observation_id));
    const retainedSources = rows.length ? frontmatter.sources! : frontmatter.sources!.slice(0, -1);
    frontmatter = { ...frontmatter, records: rows, candidate_count: rows.length, exposures: frontmatter.exposures!.filter(e => ids.has(e.observation_id)),
      sources: retainedSources, source_scope_hash: sharedSourceFingerprint(retainedSources), completeness: "truncated" };
    document = render();
  }
  return { frontmatter, document, body: renderSkillRegistryBody(frontmatter), sourceDeclarations: [] };
}

/** Resolve catalog metadata only against live host declarations. Native exposure is not portable. */
export async function resolveSharedSkillExposure(input: {
  projectRoot: string; activeRunnerId: string; exposure: SharedSkillExposureV2; providers: readonly SkillDiscoverySourceProviderV1[];
}): Promise<{ outcome: "available"; loadReference: string } | { outcome: "not_exposed" | "rejected" }> {
  const { exposure } = input;
  try {
    if (exposure.load_mode === "native" && exposure.owner !== input.activeRunnerId) return { outcome: "not_exposed" };
    const provider = input.providers.find(p => p.runnerId === exposure.owner);
    const bindings = exposure.owner === "core" ? createCoreGenericProjectSources(input.projectRoot)
      : provider ? (await provider.listSources({ projectRoot: input.projectRoot })).sources : [];
    const binding = bindings.find(b => b.declaration.sourceId === exposure.source_id);
    if (!binding || binding.declaration.runnerId !== "runner-neutral" && binding.declaration.runnerId !== exposure.owner) return { outcome: "not_exposed" };
    const base = sourceLocatorBase(binding, exposure.owner);
    if (!exposure.locator.startsWith(`${base}/`)) return { outcome: "rejected" };
    if (binding.kind === "opaque_inventory") {
      if (exposure.load_mode !== "native" || !provider) return { outcome: "rejected" };
      const result = await provider.resolveLocator({ projectRoot: input.projectRoot, locator: exposure.locator });
      return result.status === "available" ? { outcome: "available", loadReference: result.loadReference } : { outcome: "not_exposed" };
    }
    if (exposure.load_mode !== "filesystem") return { outcome: "rejected" };
    const child = decodeURIComponent(exposure.locator.slice(base.length + 1));
    if (child.split("/").some(p => !p || p === "." || p === "..") || /[\\\0:%~]/.test(child) || !child.endsWith("SKILL.md")) return { outcome: "rejected" };
    const root = await fs.realpath(binding.absoluteRoot), target = await fs.realpath(resolve(root, child));
    if (!within(root, target) || !(await fs.stat(target)).isFile()) return { outcome: "rejected" };
    await fs.access(target, fs.constants.R_OK);
    return { outcome: "available", loadReference: target };
  } catch { return { outcome: "not_exposed" }; }
}
