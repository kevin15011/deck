import {
  OPENCODE_SUPERMEMORY_PACKAGE_SPEC,
  OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
  inspectOpenCodeSupermemoryRegistrations,
  inspectOwnedOpenCodeSupermemory,
} from "@deck/adapter-opencode";
import { resolveVerifiedGitSharedProjectBase, type RunnerLaunchPlan } from "@deck/core";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const OPENCODE_SUPERMEMORY_PLUGIN_VERSION = OPENCODE_SUPERMEMORY_PACKAGE_VERSION;
export const OPENCODE_SUPERMEMORY_PLUGIN_SPEC = OPENCODE_SUPERMEMORY_PACKAGE_SPEC;
export const OPENCODE_SUPERMEMORY_API_URL = "https://api.supermemory.ai";

export type OpenCodeSupermemoryLaunchEffects = {
  inspectOwned?: typeof inspectOwnedOpenCodeSupermemory;
  inspectRegistrations?: typeof inspectOpenCodeSupermemoryRegistrations;
};

const SUPERMEMORY_CREDENTIAL_ENV_KEY = "SUPERMEMORY_API_KEY";
const MAX_PROJECT_TAG_CONFIG_BYTES = 64 * 1024;

type ProjectRepoTagOverrideInspection =
  | { status: "absent" }
  | { status: "present"; tag: string }
  | { status: "unsafe" };

function inspectProjectRepoTagOverride(projectRoot: string): ProjectRepoTagOverrideInspection {
  const claudeDirectory = join(projectRoot, ".claude");
  const supermemoryDirectory = join(claudeDirectory, ".supermemory-claude");
  const configPath = join(supermemoryDirectory, "config.json");
  try {
    for (const directory of [claudeDirectory, supermemoryDirectory]) {
      const stat = lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return { status: "unsafe" };
    }
    const pathStat = lstatSync(configPath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.size > MAX_PROJECT_TAG_CONFIG_BYTES) return { status: "unsafe" };
    const fd = openSync(configPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const openedStat = fstatSync(fd);
      if (!openedStat.isFile() || openedStat.size > MAX_PROJECT_TAG_CONFIG_BYTES || openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) return { status: "unsafe" };
      const parsed: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "absent" };
      const tag = (parsed as Record<string, unknown>).repoContainerTag;
      if (!tag) return { status: "absent" };
      return typeof tag === "string" ? { status: "present", tag } : { status: "unsafe" };
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") return { status: "absent" };
    // The official plugin ignores malformed JSON, so malformed content cannot
    // outrank the process tag. Other failures remain indeterminate and block.
    if (error instanceof SyntaxError) return { status: "absent" };
    return { status: "unsafe" };
  }
}

export function buildOpenCodeSupermemoryLaunchOverlay(input: {
  token: string;
  projectRoot: string;
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  canonicalRepoTag?: string;
}, effects: OpenCodeSupermemoryLaunchEffects = {}): NonNullable<RunnerLaunchPlan["envOverlay"]> {
  const owned = (effects.inspectOwned ?? inspectOwnedOpenCodeSupermemory)({
    environment: input.environment,
    homeDirectory: input.homeDirectory,
  });
  if (!owned.ready) throw new Error(`OpenCode Supermemory launch blocked: ${owned.diagnostic}`);

  const registrations = (effects.inspectRegistrations ?? inspectOpenCodeSupermemoryRegistrations)({
    projectRoot: input.projectRoot,
    workspaceRoot: input.projectRoot,
    environment: input.environment,
    homeDirectory: input.homeDirectory,
    loaderLocator: owned.paths.loaderLocator,
  });
  if (!registrations.ok) {
    throw new Error("OpenCode Supermemory launch blocked by a conflicting external Supermemory plugin registration; preserve it and remove the conflict explicitly before retrying.");
  }

  const token = input.token.trim();
  if (!token) throw new Error("OpenCode Supermemory launch requires an explicitly selected credential.");
  const canonicalRepoTag = input.canonicalRepoTag?.trim();
  if (canonicalRepoTag) {
    const projectBase = resolveVerifiedGitSharedProjectBase(input.projectRoot);
    if (!projectBase) {
      throw new Error("OpenCode Supermemory launch blocked because the verified Git project base could not be resolved for canonical repository tagging.");
    }
    const override = inspectProjectRepoTagOverride(projectBase);
    if (override.status === "unsafe") {
      throw new Error("OpenCode Supermemory launch blocked because the higher-priority project repoContainerTag override could not be inspected safely.");
    }
    if (override.status === "present" && override.tag !== canonicalRepoTag) {
      throw new Error("OpenCode Supermemory launch blocked because the official plugin's higher-priority project repoContainerTag conflicts with Deck's canonical repository tag.");
    }
  }
  return Object.freeze({
    OPENCODE_CONFIG_CONTENT: Object.freeze({
      value: JSON.stringify({ plugin: [owned.paths.loaderLocator] }),
    }),
    SUPERMEMORY_API_KEY: Object.freeze({ value: token, sensitive: true }),
    SUPERMEMORY_API_URL: Object.freeze({ value: OPENCODE_SUPERMEMORY_API_URL }),
    ...(canonicalRepoTag ? { SUPERMEMORY_REPO_TAG: Object.freeze({ value: canonicalRepoTag }) } : {}),
  });
}

/** Bind a verified loader overlay to the only launch plan allowed to carry its credential. */
export function authorizeOpenCodeSupermemoryLaunch(
  plan: RunnerLaunchPlan,
  input: Parameters<typeof buildOpenCodeSupermemoryLaunchOverlay>[0],
  effects: OpenCodeSupermemoryLaunchEffects = {},
): RunnerLaunchPlan {
  const overlay = buildOpenCodeSupermemoryLaunchOverlay(input, effects);
  return {
    ...plan,
    envOverlay: { ...(plan.envOverlay ?? {}), ...overlay },
    sensitiveEnvAuthorization: {
      binding: "verified-opencode-supermemory-loader-v1",
      keys: [SUPERMEMORY_CREDENTIAL_ENV_KEY],
    },
  };
}
