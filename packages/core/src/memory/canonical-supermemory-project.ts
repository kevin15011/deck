import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type CanonicalSupermemoryProjectScope = `sm_project_v1_${string}_${string}`;

export type SupermemoryProjectScopeDiagnosticCode =
  | "SUPERMEMORY_PROJECT_IDENTITY_MISSING"
  | "SUPERMEMORY_PROJECT_REMOTE_INVALID"
  | "SUPERMEMORY_PROJECT_GIT_ROOT_INVALID"
  | "SUPERMEMORY_PROJECT_REMOTE_MISMATCH";

export type SupermemoryProjectScopeDiagnostic = Readonly<{
  code: SupermemoryProjectScopeDiagnosticCode;
  severity: "warning" | "error";
  message: string;
}>;

export type SupermemoryProjectScopeResult =
  | Readonly<{ ok: true; scope: CanonicalSupermemoryProjectScope; owner: string; repository: string; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>
  | Readonly<{ ok: false; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>;

const GITHUB_HOST_ALIASES = new Set(["github.com", "github-p"]);
const CANONICAL_SUPERMEMORY_PROJECT_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isCanonicalSupermemoryProjectScope(value: string): value is CanonicalSupermemoryProjectScope {
  return CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(value.trim()) && value.trim() !== "sm_project_default";
}

export function resolveCanonicalSupermemoryProjectScope(input: {
  projectRoot: string;
  remotes: readonly string[];
}): SupermemoryProjectScopeResult {
  const diagnostics: SupermemoryProjectScopeDiagnostic[] = [];
  const gitTopLevel = resolveVerifiedGitTopLevel(input.projectRoot);
  if (!gitTopLevel) {
    return {
      ok: false,
      diagnostics: [{
        code: "SUPERMEMORY_PROJECT_GIT_ROOT_INVALID",
        severity: "error",
        message: "No verified Git top-level was available for the explicit project; Supermemory effects are disabled.",
      }],
    };
  }

  const canonicalOrigin = readGitOriginRemote(gitTopLevel);
  if (!canonicalOrigin) {
    return {
      ok: false,
      diagnostics: [{
        code: "SUPERMEMORY_PROJECT_IDENTITY_MISSING",
        severity: "error",
        message: "No canonical repository identity was available; Supermemory effects are disabled without a default scope fallback.",
      }],
    };
  }

  const originParsed = parseGitRemoteOwnerRepository(canonicalOrigin);
  if (!originParsed) {
    return {
      ok: false,
      diagnostics: [{
        code: "SUPERMEMORY_PROJECT_REMOTE_INVALID",
        severity: "error",
        message: "The canonical Git origin remote could not be normalized into a repository identity.",
      }],
    };
  }

  for (const remote of input.remotes) {
    const parsed = parseGitRemoteOwnerRepository(remote);
    if (!parsed) {
      diagnostics.push({
        code: "SUPERMEMORY_PROJECT_REMOTE_INVALID",
        severity: "warning",
        message: "A supplied Git remote could not be normalized into a canonical repository identity.",
      });
      continue;
    }
    if (!sameRepositoryIdentity(originParsed, parsed)) {
      return {
        ok: false,
        diagnostics: [{
          code: "SUPERMEMORY_PROJECT_REMOTE_MISMATCH",
          severity: "error",
          message: "Supplied repository identity did not match the verified Git origin; Supermemory effects are disabled.",
        }],
      };
    }
  }

  const owner = normalizeScopeSegment(originParsed.owner);
  const repository = normalizeScopeSegment(originParsed.repository);
  if (!owner || !repository) {
    return {
      ok: false,
      diagnostics: [{
        code: "SUPERMEMORY_PROJECT_IDENTITY_MISSING",
        severity: "error",
        message: "No canonical repository identity was available; Supermemory effects are disabled without a default scope fallback.",
      }],
    };
  }
  return {
    ok: true,
    scope: `sm_project_v1_${owner}_${repository}`,
    owner,
    repository,
    diagnostics,
  };
}

export function parseGitRemoteOwnerRepository(remote: string): { owner: string; repository: string } | undefined {
  let value = remote.trim();
  if (!value) return undefined;
  value = value.replace(/[?#].*$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");

  if (isFilesystemLikeRemote(value)) return undefined;

  const scp = value.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp) return parsePathWithOptionalHost(scp[1]!, scp[2]!);

  try {
    const url = new URL(value);
    return parsePathWithOptionalHost(url.hostname, url.pathname.replace(/^\/+/, ""));
  } catch {
    return undefined;
  }
}

export function fingerprintSupermemoryProjectScope(scope: string): `smfp_${string}` {
  return `smfp_${createHash("sha256").update(scope, "utf8").digest("hex").slice(0, 16)}`;
}

function readGitOriginRemote(projectRoot: string): string | undefined {
  const cwd = projectRoot.trim();
  if (!cwd) return undefined;
  try {
    const config = readFileSync(join(cwd, ".git", "config"), "utf8");
    const origin = config.match(/^\[remote\s+"origin"\]\s*$(?<body>(?:\n[ \t]+[^\n]*)*)/m)?.groups?.body;
    const url = origin?.match(/^\s*url\s*=\s*(?<url>.+?)\s*$/m)?.groups?.url.trim();
    if (url) return url;
  } catch {
    // Fall through to git for worktrees and non-standard git directories.
  }
  try {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      env: sanitizedGitIdentityEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (origin) return origin;
  } catch {
    // No origin could be resolved.
  }
  return undefined;
}

function resolveVerifiedGitTopLevel(projectRoot: string): string | undefined {
  const cwd = projectRoot.trim();
  if (!cwd) return undefined;
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      env: sanitizedGitIdentityEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return topLevel || undefined;
  } catch {
    return undefined;
  }
}

function sanitizedGitIdentityEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  env.GIT_CONFIG_COUNT = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  return env;
}

function sameRepositoryIdentity(
  a: { owner: string; repository: string },
  b: { owner: string; repository: string },
): boolean {
  return normalizeScopeSegment(a.owner) === normalizeScopeSegment(b.owner)
    && normalizeScopeSegment(a.repository) === normalizeScopeSegment(b.repository);
}

function isFilesystemLikeRemote(value: string): boolean {
  if (/^(?:file:|[a-zA-Z]:[\\/]|[./~]|\\\\)/.test(value)) return true;
  if (/\s/.test(value)) return true;
  if (!value.includes("://") && !/^[^@\s]+@[^:\s]+:.+/.test(value)) return true;
  return false;
}

function parsePathWithOptionalHost(host: string, path: string): { owner: string; repository: string } | undefined {
  const normalizedHost = host.toLowerCase();
  if (!GITHUB_HOST_ALIASES.has(normalizedHost) && !normalizedHost.endsWith(".github.com")) return undefined;
  return parseOwnerRepositoryPath(path);
}

function parseOwnerRepositoryPath(path: string): { owner: string; repository: string } | undefined {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  return { owner: parts[parts.length - 2]!, repository: parts[parts.length - 1]! };
}

function normalizeScopeSegment(value: string): string {
  return value.toLowerCase().replace(/\.git$/i, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
