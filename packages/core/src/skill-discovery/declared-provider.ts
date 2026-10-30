import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RunnerId } from "../runner-adapter";
import { SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, SKILL_DISCOVERY_SOURCE_SCHEMA, SKILL_DISCOVERY_V1_BOUNDS,
  type OpaqueSkillInventoryResultV1, type SkillDiscoverySourceProviderV1,
  type SkillDiscoverySourceBindingV1, type SkillDiscoveryDiagnosticV1, type SkillDiscoveryScopeV1,
  type SkillDiscoverySourceCategoryV1 } from "./contracts";

/** Host-declared exposure, never constructed from skill-authored metadata. */
export interface DeclaredSkillRoot {
  readonly id: string;
  readonly root: string;
  readonly category: SkillDiscoverySourceCategoryV1;
  readonly scope: SkillDiscoveryScopeV1;
}
export interface DeclaredSkillProviderOptions {
  readonly roots: (projectRoot: string) => readonly DeclaredSkillRoot[] | Promise<readonly DeclaredSkillRoot[]>;
  /** Omitted means inventory coverage is unknown, not an empty complete inventory. */
  readonly inventory?: (input: { projectRoot: string }) => Promise<OpaqueSkillInventoryResultV1>;
}

/** Shared root declarations; the V1 provider supplies the current exposure identity. */
export function sharedSkillRoots(home: string, systemRoots: readonly string[] = []): DeclaredSkillRoot[] {
  return [
    { id: "shared-user-skills", root: join(home, ".agents", "skills"), category: "user_runner", scope: "user" },
    ...systemRoots.map((root, index): DeclaredSkillRoot => ({ id: `shared-system-${index}`, root, category: "runner_exposed", scope: "runner" })),
  ];
}
const within = (root: string, candidate: string) => {
  const child = relative(root, candidate);
  return child === "" || child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const diagnostic = (code: string, source_id?: string): SkillDiscoveryDiagnosticV1 => ({ code, ...(source_id ? { source_id } : {}), message: "Declared skill source could not be fully evaluated." });
const token = (value: string) => typeof value === "string" && !value.includes("..") && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value);

/** Read-only filesystem exposure and bounded host inventory; no process or network effects. */
export function createDeclaredSkillProvider(runnerId: RunnerId, options: DeclaredSkillProviderOptions): SkillDiscoverySourceProviderV1 {
  const inventoryId = `${runnerId}-inventory`;
  const inventory = async (projectRoot: string): Promise<OpaqueSkillInventoryResultV1> => {
    try {
      if (options.inventory) {
        const result = await options.inventory({ projectRoot });
        if ((result.outcome === "complete" || result.outcome === "indeterminate") && Array.isArray(result.diagnostics)
          && result.diagnostics.length <= SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics
          && result.observations.length <= SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords
          && result.observations.every(row => token(row.opaqueId))) {
          return { ...result, diagnostics: result.diagnostics.map(() => diagnostic("inventory_warning", inventoryId)) };
        }
      }
    } catch { /* Diagnostics must never expose private paths or exception text. */ }
    return { outcome: "indeterminate", reasonCode: "partial_source_evaluation", observations: [], diagnostics: [diagnostic("inventory_unavailable", inventoryId)] };
  };
  const roots = async (projectRoot: string) => {
    const values = await options.roots(projectRoot);
    if (values.length > SKILL_DISCOVERY_V1_BOUNDS.maxCandidateRecords || values.some(value => !token(value.id) || !isAbsolute(value.root)) || new Set(values.map(value => value.id)).size !== values.length) throw new Error("invalid-source-declarations");
    return values;
  };
  return {
    schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, runnerId,
    async listSources({ projectRoot }) {
      const sources: SkillDiscoverySourceBindingV1[] = [];
      const diagnostics: SkillDiscoveryDiagnosticV1[] = [];
      try {
        for (const source of await roots(projectRoot)) {
          try {
            if (!(await fs.stat(source.root)).isDirectory()) throw new Error("not-directory");
            await fs.access(source.root, fs.constants.R_OK | fs.constants.X_OK);
          } catch (error) {
            if (absent(error)) continue;
            diagnostics.push(diagnostic("source_unreadable", source.id));
            continue;
          }
          const binding: SkillDiscoverySourceBindingV1 = { kind: "filesystem", descriptorBasename: "SKILL.md", absoluteRoot: source.root,
            declaration: { schema: SKILL_DISCOVERY_SOURCE_SCHEMA, sourceId: source.id, sourceCategory: source.category, scope: source.scope,
              runnerId, locatorStrategy: source.category === "project_runner" ? "project_relative" : "runner_relative", expectedContent: "skill_md",
              safeLocatorBase: source.category === "project_runner" ? relative(projectRoot, source.root).split(sep).join("/") : source.id } };
          Object.defineProperty(binding, "absoluteRoot", { enumerable: false, value: source.root });
          sources.push(binding);
        }
      } catch { diagnostics.push(diagnostic("source_declarations_unavailable")); }
      const snapshot = await inventory(projectRoot);
      diagnostics.push(...snapshot.diagnostics);
      sources.push({ kind: "opaque_inventory", declaration: { schema: SKILL_DISCOVERY_SOURCE_SCHEMA, sourceId: inventoryId,
        sourceCategory: "runner_exposed", scope: "runner", runnerId, locatorStrategy: "runner_opaque", expectedContent: "opaque_inventory_v1", safeLocatorBase: inventoryId }, readInventory: async () => snapshot });
      const bounded = diagnostics.slice(0, SKILL_DISCOVERY_V1_BOUNDS.maxDiagnostics);
      return diagnostics.length || snapshot.outcome === "indeterminate"
        ? { outcome: "indeterminate", reasonCode: "partial_source_evaluation", sources, diagnostics: bounded }
        : { outcome: "complete", sources, diagnostics: bounded };
    },
    async resolveLocator({ projectRoot, locator }) {
      const reject = () => ({ status: "rejected" as const, diagnostic: diagnostic("locator_rejected") });
      const prefix = `runner:${runnerId}:`;
      let normalized = locator;
      if (locator.startsWith("project:")) {
        try {
          const source = (await roots(projectRoot)).find(root => root.category === "project_runner" && locator.startsWith(`project:${relative(projectRoot, root.root).split(sep).join("/")}/`));
          if (!source) return reject();
          normalized = `${prefix}${source.id}/${locator.slice(`project:${relative(projectRoot, source.root).split(sep).join("/")}/`.length)}`;
        } catch { return reject(); }
      }
      if (!normalized.startsWith(prefix)) return reject();
      const [id, ...parts] = normalized.slice(prefix.length).split("/");
      let value: string;
      try { value = decodeURIComponent(parts.join("/")); } catch { return reject(); }
      if (id === inventoryId) {
        if (!token(value)) return reject();
        const current = await inventory(projectRoot);
        if (current.outcome !== "complete") return reject();
        return current.observations.some(row => row.opaqueId === value) ? { status: "available", loadReference: value } : { status: "missing" };
      }
      if (!value || /[\\\0:%~]/.test(value) || value.split("/").some(part => !part || part === "." || part === "..") || !(value === "SKILL.md" || value.endsWith("/SKILL.md"))) return reject();
      try {
        const source = (await roots(projectRoot)).find(root => root.id === id);
        if (!source) return reject();
        const root = await fs.realpath(source.root);
        const target = await fs.realpath(resolve(root, value));
        if (!within(root, target) || !(await fs.stat(target)).isFile()) return reject();
        await fs.access(target, fs.constants.R_OK);
        return { status: "available", loadReference: target };
      } catch (error) { return absent(error) ? { status: "missing" } : reject(); }
    },
  };
}
