import { createHash } from "node:crypto";
import type { SkillDiscoveryDigestV1, SkillRegistryFrontmatterV1, SharedSkillSourceV2 } from "./contracts";
import { isSafeSkillLocator } from "./discovery";
export const catalogDigest = (value: unknown): SkillDiscoveryDigestV1 => `sha256:${createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest("hex")}`;
export const sharedSourceFingerprint = (sources: readonly SharedSkillSourceV2[]) => catalogDigest(["shared-sources-v2", sources]);
export const sharedCatalogFingerprint = (catalog: SkillRegistryFrontmatterV1) => catalogDigest([
  "shared-catalog-v2", catalog.sources, catalog.exposures, catalog.records, catalog.completeness,
]);
const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value);
const digest = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
/** Shape validation grants no exposure. Every load must consult the live source provider. */
export function validateSharedMetadata(catalog: SkillRegistryFrontmatterV1): boolean {
  const { sources, exposures, records } = catalog;
  if (!Array.isArray(sources) || !Array.isArray(exposures) || sources.length > 500 || exposures.length > 2000) return false;
  const sourceKeys = new Set<string>();
  for (const source of sources) {
    if (!source || !token(source.owner) || !token(source.source_id) || !digest(source.fingerprint)
      || !["project_local", "project_runner", "user_runner", "deck_materialized", "runner_exposed"].includes(source.category)
      || !["project", "user", "runner"].includes(source.scope) || !["filesystem", "native"].includes(source.load_mode)
      || !["complete", "partial"].includes(source.completeness)
      || typeof source.locator_base !== "string" || !isSafeSkillLocator(`${source.locator_base}/SKILL.md`)) return false;
    const key = `${source.owner}:${source.source_id}`;
    if (sourceKeys.has(key)) return false;
    sourceKeys.add(key);
  }
  const ids = new Set(records.map(record => record.observation_id));
  const covered = new Set<string>(), seen = new Set<string>();
  for (const exposure of exposures) {
    if (!exposure || !ids.has(exposure.observation_id) || !isSafeSkillLocator(exposure.locator)) return false;
    const source = sources.find(source => source.owner === exposure.owner && source.source_id === exposure.source_id);
    if (!source || exposure.load_mode !== source.load_mode || !exposure.locator.startsWith(`${source.locator_base}/`)) return false;
    const key = JSON.stringify(exposure);
    if (seen.has(key)) return false;
    seen.add(key); covered.add(exposure.observation_id);
  }
  return records.every(record => covered.has(record.observation_id));
}
