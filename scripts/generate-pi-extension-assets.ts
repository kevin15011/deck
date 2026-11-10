import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Bundles the Deck Pi extensions (TypeScript sources under `packages/adapter-pi/src/pi-extensions`) into plain
 * Node-loadable ESM assets under `packages/adapter-pi/assets/pi/extensions/`. Pi runs on Node, so the target is
 * `node` (never `bun`: Bun-targeted bundles use `import.meta.require`, which Node lacks).
 *
 * The output is not minified and carries the SHA-256 of every non-test source file. The freshness check
 * compares metadata and bundled code using the release-pinned Bun version. Regenerate with `bun run scripts/generate-pi-extension-assets.ts`.
 */
const root = resolve(import.meta.dir, "..");
const SOURCE_DIR = "packages/adapter-pi/src/pi-extensions";
const OUTPUT_DIR = "packages/adapter-pi/assets/pi/extensions";

export const PI_EXTENSION_BUNDLES = ["deck-subagents", "deck-tool-policy"] as const;
export type PiExtensionBundleName = (typeof PI_EXTENSION_BUNDLES)[number];

export type PiExtensionAssetResult = { name: PiExtensionBundleName; output: string; sourceDigest: string };

function listSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...listSources(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

/** Files outside `pi-extensions/` that the bundles import; included in the digest so the staleness test sees them. */
const EXTERNAL_SOURCES = ["packages/core/package.json", "packages/core/src/installation-use.ts", "packages/adapter-pi/src/installation-trust.ts", "packages/adapter-pi/src/skill-discovery-provider.ts", "packages/adapter-pi/src/agent-dir.ts", "packages/sdd-runtime/src/execution/openspec-repair.ts", "packages/sdd-runtime/src/execution/native-preparation.ts", "packages/core/src/session/start-context.ts", "packages/core/src/session/preparation.ts", "packages/core/src/session/readiness-parity.ts", "packages/sdd-runtime/src/execution/project-preparation.ts", "packages/sdd-runtime/src/execution/retired-testing-policy.ts", "packages/core/src/skill-discovery/contracts.ts", "packages/core/src/skill-discovery/discovery.ts", "packages/core/src/skill-discovery/registry.ts", "packages/core/src/skill-discovery/persistence.ts", "packages/core/src/session/role-tool-policy.ts", "packages/core/src/runner-contributions.ts", "packages/core/src/session/personal-mcp.ts", "packages/adapter-pi/src/pi-mcp-catalog.ts", "packages/core/src/owned-tools/rtk-hook.ts", "packages/core/src/session/mcp.ts", "packages/core/src/owned-tools/codebase-native-artifact.ts", "packages/adapter-pi/src/pi-manifest.ts", "packages/adapter-pi/src/pi-native-codebase-readiness.ts", "packages/adapter-pi/src/pi-codebase-guard-command.ts"] as const;

export function computePiExtensionSourceDigest(projectRoot = root): string {
  const sourceRoot = resolve(projectRoot, SOURCE_DIR);
  const hash = createHash("sha256");
  for (const external of EXTERNAL_SOURCES) {
    hash.update(external);
    hash.update("\0");
    hash.update(readFileSync(resolve(projectRoot, external)));
    hash.update("\0");
  }
  for (const file of listSources(sourceRoot)) {
    hash.update(relative(sourceRoot, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function piExtensionAssetPath(name: PiExtensionBundleName, projectRoot = root): string {
  return resolve(projectRoot, OUTPUT_DIR, `${name}.generated.js`);
}

/** Compare the whole artifact, including metadata and executable code; missing files fail closed. */
export function verifyPiExtensionAsset(output: string, expected: string): void {
  if (readFileSync(output, "utf-8") !== expected) {
    throw new Error(`Stale Pi extension asset: ${output}. Regenerate with bun run scripts/generate-pi-extension-assets.ts`);
  }
}

export async function generatePiExtensionAssets(options: { root?: string; names?: readonly PiExtensionBundleName[]; check?: boolean } = {}): Promise<PiExtensionAssetResult[]> {
  const projectRoot = options.root ?? root;
  const sourceDigest = computePiExtensionSourceDigest(projectRoot);
  const results: PiExtensionAssetResult[] = [];
  for (const name of options.names ?? PI_EXTENSION_BUNDLES) {
    const entry = resolve(projectRoot, SOURCE_DIR, "entries", `${name}.ts`);
    const build = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", external: ["@earendil-works/pi-coding-agent"], minify: false, sourcemap: "none" });
    if (!build.success || build.outputs.length !== 1) {
      throw new Error(`Bundling ${name} failed: ${build.logs.map((log) => log.message).join("; ")}`);
    }
    const bundle = await build.outputs[0]!.text();
    if (bundle.includes("import.meta.require")) throw new Error(`${name} bundle uses the Bun-only import.meta.require; it must load under Node.`);
    const output = piExtensionAssetPath(name, projectRoot);
    const content = `// Generated by scripts/generate-pi-extension-assets.ts; do not edit.\n// source-sha256:${sourceDigest}\n${bundle}`;
    if (options.check) verifyPiExtensionAsset(output, content);
    else writeFileSync(output, content, "utf-8");
    results.push({ name, output, sourceDigest });
  }
  return results;
}

if (import.meta.main) {
  try {
    const check = process.argv.includes("--check");
    for (const result of await generatePiExtensionAssets({ check })) console.log(`${check ? "verified" : "generated"} ${result.output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
