import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export type CanonicalSupermemoryProjectScope = `sm_project_v1_${string}_${string}`;

export type SupermemoryProjectScopeDiagnosticCode =
  | "SUPERMEMORY_PROJECT_IDENTITY_MISSING"
  | "SUPERMEMORY_PROJECT_REMOTE_INVALID";

export type SupermemoryProjectScopeDiagnostic = Readonly<{
  code: SupermemoryProjectScopeDiagnosticCode;
  severity: "warning" | "error";
  message: string;
}>;

export type SupermemoryProjectScopeResult =
  | Readonly<{ ok: true; scope: CanonicalSupermemoryProjectScope; owner: string; repository: string; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>
  | Readonly<{ ok: false; diagnostics: readonly SupermemoryProjectScopeDiagnostic[] }>;

const GITHUB_HOST_ALIASES = new Set(["github.com", "github-p"]);

export function resolveCanonicalSupermemoryProjectScope(input: {
  projectRoot: string;
  remotes: readonly string[];
}): SupermemoryProjectScopeResult {
  const diagnostics: SupermemoryProjectScopeDiagnostic[] = [];
  const remotes = [...input.remotes];
  if (remotes.length === 0) {
    const origin = readGitOriginRemote(input.projectRoot);
    if (origin) remotes.push(origin);
  }
  for (const remote of remotes) {
    const parsed = parseGitRemoteOwnerRepository(remote);
    if (!parsed) {
      diagnostics.push({
        code: "SUPERMEMORY_PROJECT_REMOTE_INVALID",
        severity: "warning",
        message: "A Git remote could not be normalized into a canonical repository identity.",
      });
      continue;
    }
    const owner = normalizeScopeSegment(parsed.owner);
    const repository = normalizeScopeSegment(parsed.repository);
    if (!owner || !repository) continue;
    return {
      ok: true,
      scope: `sm_project_v1_${owner}_${repository}`,
      owner,
      repository,
      diagnostics,
    };
  }

  return {
    ok: false,
    diagnostics: [
      ...diagnostics,
      {
        code: "SUPERMEMORY_PROJECT_IDENTITY_MISSING",
        severity: "error",
        message: "No canonical repository identity was available; Supermemory effects are disabled without a default scope fallback.",
      },
    ],
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
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
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
