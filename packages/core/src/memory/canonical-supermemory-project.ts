import { createHash } from "node:crypto";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

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

const CANONICAL_GITHUB_SSH_HOSTS = new Set(["github.com", "ssh.github.com"]);
const CANONICAL_SUPERMEMORY_PROJECT_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SSH_CONFIG_MAX_BYTES = 64 * 1024;
const SSH_CONFIG_MAX_LINE_BYTES = 1024;
const SSH_CONFIG_MAX_HOST_BLOCKS = 256;
const PASSWD_MAX_BYTES = 256 * 1024;
const GIT_FILE_MAX_BYTES = 1024;
const GIT_CONFIG_MAX_BYTES = 256 * 1024;

type SshConfigTrustDeps = Readonly<{
  /** Test-only trusted account home override; production derives this structurally from the OS account database. */
  homeDir?: string;
  passwdPath?: string;
  openSync?: (path: string, flags: number) => number;
  fstatSync?: (fd: number) => Stats;
  readSync?: (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => number;
  closeSync?: (fd: number) => void;
  noFollowFlag?: number;
  effectiveUid?: () => number | undefined;
}>;

export function isCanonicalSupermemoryProjectScope(value: string): value is CanonicalSupermemoryProjectScope {
  return CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(value.trim()) && value.trim() !== "sm_project_default";
}

export function resolveCanonicalSupermemoryProjectScope(input: {
  projectRoot: string;
  remotes: readonly string[];
  sshConfig?: SshConfigTrustDeps;
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

  const originParsed = parseGitRemoteOwnerRepository(canonicalOrigin, input.sshConfig);
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
    const parsed = parseGitRemoteOwnerRepository(remote, input.sshConfig);
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

export function parseGitRemoteOwnerRepository(remote: string, sshConfig?: SshConfigTrustDeps): { owner: string; repository: string } | undefined {
  let value = remote.trim();
  if (!value) return undefined;
  value = value.replace(/[?#].*$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");

  if (isFilesystemLikeRemote(value)) return undefined;

  const scp = value.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp) return parsePathWithOptionalHost(scp[1]!, scp[2]!, { allowSshAlias: true, sshAliasConfig: sshConfig });

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "ssh:") return undefined;
    return parsePathWithOptionalHost(url.hostname, url.pathname.replace(/^\/+/, ""), { allowSshAlias: url.protocol === "ssh:", sshAliasConfig: sshConfig });
  } catch {
    return undefined;
  }
}

export function fingerprintSupermemoryProjectScope(scope: string): `smfp_${string}` {
  return `smfp_${createHash("sha256").update(scope, "utf8").digest("hex").slice(0, 16)}`;
}

function readGitOriginRemote(projectRoot: string): string | undefined {
  const repo = resolveGitRepository(projectRoot);
  if (!repo) return undefined;
  for (const configPath of [join(repo.commonDir, "config"), repo.gitDir === repo.commonDir ? undefined : join(repo.gitDir, "config")]) {
    if (!configPath) continue;
    const origin = readOriginFromGitConfig(configPath);
    if (origin) return origin;
  }
  return undefined;
}

function resolveVerifiedGitTopLevel(projectRoot: string): string | undefined {
  return resolveGitRepository(projectRoot)?.workTree;
}

function resolveGitRepository(projectRoot: string): { workTree: string; gitDir: string; commonDir: string } | undefined {
  let cursor = canonicalDirectory(projectRoot.trim());
  while (cursor) {
    const dotGit = join(cursor, ".git");
    const dotGitStat = lstatSafe(dotGit);
    if (dotGitStat?.isDirectory() && !dotGitStat.isSymbolicLink()) {
      const gitDir = canonicalExistingDirectory(dotGit);
      if (!gitDir) return undefined;
      const commonDir = resolveCommonDir(gitDir);
      if (commonDir === null) return undefined;
      return { workTree: cursor, gitDir, commonDir: commonDir ?? gitDir };
    }
    if (dotGitStat?.isFile() && !dotGitStat.isSymbolicLink()) {
      const gitDir = readGitDirFile(dotGit, cursor);
      if (!gitDir) return undefined;
      const commonDir = resolveCommonDir(gitDir);
      if (commonDir === null) return undefined;
      return { workTree: cursor, gitDir, commonDir: commonDir ?? gitDir };
    }
    if (dotGitStat) return undefined;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

function canonicalDirectory(input: string): string | undefined {
  if (!input || input.includes("\0")) return undefined;
  try {
    const real = realpathSync(input);
    const stat = lstatSync(real);
    return stat.isDirectory() && !stat.isSymbolicLink() ? real : undefined;
  } catch {
    return undefined;
  }
}

function canonicalExistingDirectory(input: string): string | undefined {
  try {
    if (!hasNoSymlinkPath(input)) return undefined;
    const stat = lstatSync(input);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    return realpathSync(input);
  } catch {
    return undefined;
  }
}

function hasNoSymlinkPath(input: string): boolean {
  const absolute = resolve(input);
  const root = absolute.slice(0, absolute.length - normalize(absolute).replace(/^\/+/, "").length);
  let cursor = root || "/";
  for (const part of absolute.slice(cursor.length).split("/").filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = lstatSafe(cursor);
    if (!stat || stat.isSymbolicLink()) return false;
  }
  return true;
}

function lstatSafe(path: string): Stats | undefined {
  try { return lstatSync(path); } catch { return undefined; }
}

function readSmallTextFile(path: string, limit: number): string | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || Number(stat.size) > limit) return undefined;
    const content = readFileSync(path, "utf8");
    if (content.includes("\0") || Buffer.byteLength(content, "utf8") > limit) return undefined;
    return content;
  } catch {
    return undefined;
  }
}

function readGitDirFile(path: string, workTree: string): string | undefined {
  const content = readSmallTextFile(path, GIT_FILE_MAX_BYTES);
  const value = content?.match(/^gitdir:\s*(?<gitdir>.+?)\s*$/i)?.groups?.gitdir;
  if (!value || value.includes("\0")) return undefined;
  const gitDir = isAbsolute(value) ? normalize(value) : resolve(workTree, value);
  return canonicalExistingDirectory(gitDir);
}

function resolveCommonDir(gitDir: string): string | undefined | null {
  const commonDirPath = join(gitDir, "commondir");
  if (!lstatSafe(commonDirPath)) return undefined;
  const content = readSmallTextFile(commonDirPath, GIT_FILE_MAX_BYTES);
  if (content === undefined) return null;
  const value = content.trim();
  if (!value || isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value)) return null;
  const commonDir = canonicalExistingDirectory(resolve(gitDir, value));
  if (!commonDir) return null;
  if (dirname(dirname(gitDir)) !== commonDir || dirname(gitDir).split("/").at(-1) !== "worktrees") return null;
  return commonDir;
}

function readOriginFromGitConfig(configPath: string): string | undefined {
  const config = readSmallTextFile(configPath, GIT_CONFIG_MAX_BYTES);
  if (!config) return undefined;
  const origin = config.match(/^\[remote\s+"origin"\]\s*$(?<body>(?:\n[ \t]+[^\n]*)*)/m)?.groups?.body;
  const url = origin?.match(/^\s*url\s*=\s*(?<url>.+?)\s*$/m)?.groups?.url.trim();
  return url || undefined;
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

function parsePathWithOptionalHost(host: string, path: string, options: { allowSshAlias?: boolean; sshAliasConfig?: SshConfigTrustDeps } = {}): { owner: string; repository: string } | undefined {
  const normalizedHost = host.toLowerCase();
  if (!CANONICAL_GITHUB_SSH_HOSTS.has(normalizedHost) && !(options.allowSshAlias && isTrustedSshGithubAlias(normalizedHost, options.sshAliasConfig))) return undefined;
  return parseOwnerRepositoryPath(path);
}

function isTrustedSshGithubAlias(alias: string, deps: SshConfigTrustDeps = {}): boolean {
  if (!alias || CANONICAL_GITHUB_SSH_HOSTS.has(alias)) return false;
  if (/[*?!%\s\\/]/.test(alias)) return false;
  const home = resolveTrustedAccountHome(deps);
  if (!home) return false;
  const configPath = join(home, ".ssh", "config");
  const noFollow = "noFollowFlag" in deps ? deps.noFollowFlag : fsConstants.O_NOFOLLOW;
  if (noFollow === undefined) return false;
  let fd: number | undefined;
  try {
    fd = (deps.openSync ?? openSync)(configPath, fsConstants.O_RDONLY | noFollow);
    const stat = (deps.fstatSync ?? fstatSync)(fd);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const uid = deps.effectiveUid?.() ?? (typeof process.geteuid === "function" ? process.geteuid() : undefined);
    if (uid !== undefined && Number(stat.uid) !== uid) return false;
    if ((Number(stat.mode) & 0o022) !== 0) return false;
    if (Number(stat.size) > SSH_CONFIG_MAX_BYTES) return false;
    const buffer = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const read = (deps.readSync ?? readSync)(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    if (offset !== buffer.length) return false;
    const config = buffer.toString("utf8");
    if (config.includes("\0") || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(config)) return false;
    return sshConfigMapsAliasToCanonicalGithub(alias, config);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { (deps.closeSync ?? closeSync)(fd); } catch {}
    }
  }
}

function resolveTrustedAccountHome(deps: SshConfigTrustDeps): string | undefined {
  if (deps.homeDir !== undefined) return canonicalDirectory(deps.homeDir);
  if (process.platform !== "linux") return undefined;
  const uid = deps.effectiveUid?.() ?? (typeof process.geteuid === "function" ? process.geteuid() : undefined);
  if (uid === undefined) return undefined;
  const passwd = readTrustedPasswdFile(deps);
  if (passwd === undefined) return undefined;
  let home: string | undefined;
  let matchingEntries = 0;
  for (const line of passwd.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(":");
    if (fields.length !== 7) return undefined;
    const username = fields[0]!;
    const password = fields[1]!;
    const uidField = fields[2]!;
    const gidField = fields[3]!;
    const gecos = fields[4]!;
    const candidateHome = fields[5]!;
    const shell = fields[6]!;
    if (!isValidPasswdStructuralField(username) || !isValidPasswdStructuralField(password)) return undefined;
    const entryUid = parseCanonicalPasswdDecimal(uidField);
    const entryGid = parseCanonicalPasswdDecimal(gidField);
    if (entryUid === undefined || entryGid === undefined) return undefined;
    if (!isValidPasswdGecosField(gecos) || !isValidPasswdHomeField(candidateHome) || !isValidPasswdStructuralField(shell)) return undefined;
    if (entryUid !== uid) continue;
    matchingEntries += 1;
    if (matchingEntries > 1) return undefined;
    home = candidateHome;
  }
  return matchingEntries === 1 && home !== undefined ? canonicalDirectory(home) : undefined;
}

function isValidPasswdStructuralField(value: string): boolean {
  return value.length > 0 && !/[\s\x00-\x1f\x7f]/.test(value);
}

function isValidPasswdGecosField(value: string): boolean {
  return !/[\x00-\x1f\x7f]/.test(value);
}

function isValidPasswdHomeField(value: string): boolean {
  return value.length > 0 && isAbsolute(value) && !/[\s\x00-\x1f\x7f]/.test(value);
}

function parseCanonicalPasswdDecimal(value: string): number | undefined {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function readTrustedPasswdFile(deps: SshConfigTrustDeps): string | undefined {
  const noFollow = "noFollowFlag" in deps ? deps.noFollowFlag : fsConstants.O_NOFOLLOW;
  if (noFollow === undefined) return undefined;
  const path = deps.passwdPath ?? "/etc/passwd";
  let fd: number | undefined;
  try {
    fd = (deps.openSync ?? openSync)(path, fsConstants.O_RDONLY | noFollow);
    const stat = (deps.fstatSync ?? fstatSync)(fd);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    if (Number(stat.uid) !== 0) return undefined;
    if ((Number(stat.mode) & 0o022) !== 0) return undefined;
    if (Number(stat.size) <= 0 || Number(stat.size) > PASSWD_MAX_BYTES) return undefined;
    const buffer = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const read = (deps.readSync ?? readSync)(fd, buffer, offset, buffer.length - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    if (offset !== buffer.length) return undefined;
    const content = buffer.toString("utf8");
    if (/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/.test(content)) return undefined;
    return content;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { (deps.closeSync ?? closeSync)(fd); } catch {}
    }
  }
}

function sshConfigMapsAliasToCanonicalGithub(alias: string, config: string): boolean {
  const matches: string[] = [];
  let inMatchedHost = false;
  let hostName: string | undefined;
  let hostBlocks = 0;
  const finishBlock = (): boolean => {
    if (!inMatchedHost) return true;
    if (!hostName) return false;
    matches.push(hostName);
    return true;
  };

  for (const rawLine of config.split(/\r?\n/)) {
    if (Buffer.byteLength(rawLine, "utf8") > SSH_CONFIG_MAX_LINE_BYTES) return false;
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (line.startsWith("#")) continue;
    if (!line) continue;
    const directive = parseSshDirective(line);
    if (!directive) return false;
    const { keyword, value } = directive;
    if (keyword === "match") return false;
    if (keyword === "include") return false;
    if (keyword === "host") {
      if (!finishBlock()) return false;
      hostBlocks += 1;
      if (hostBlocks > SSH_CONFIG_MAX_HOST_BLOCKS) return false;
      hostName = undefined;
      const patterns = value.split(/\s+/).map((part) => part.toLowerCase());
      if (patterns.length === 0 || patterns.some((pattern) => pattern.startsWith("!") || /[*?%]/.test(pattern))) return false;
      const exactMatch = patterns.includes(alias);
      inMatchedHost = exactMatch;
      continue;
    }
    if (hostBlocks === 0) {
      if (keyword === "hostname") return false;
      if (!validateAllowedSshAliasDirective(keyword, value)) return false;
      continue;
    }
    if (!inMatchedHost) continue;
    if (keyword !== "hostname") {
      if (!validateAllowedSshAliasDirective(keyword, value)) return false;
      continue;
    }
    const hostValue = value.toLowerCase();
    if (!hostValue || /[%\s=]/.test(hostValue)) return false;
    if (!CANONICAL_GITHUB_SSH_HOSTS.has(hostValue)) return false;
    if (hostName !== undefined) return false;
    hostName = hostValue;
  }
  if (!finishBlock()) return false;
  return matches.length === 1;
}

function validateAllowedSshAliasDirective(keyword: string, value: string): boolean {
  if (!value || Buffer.byteLength(value, "utf8") > SSH_CONFIG_MAX_LINE_BYTES || /[\x00-\x1f\x7f]/.test(value)) return false;
  switch (keyword) {
    case "user":
    case "identityfile":
      return true;
    case "identitiesonly":
      return /^(?:yes|no)$/i.test(value);
    case "port":
      return /^(?:[1-9][0-9]{0,4})$/.test(value) && Number(value) <= 65535;
    default:
      return false;
  }
}

function parseSshDirective(line: string): { keyword: string; value: string } | undefined {
  const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.+)$/);
  if (!match) return undefined;
  const keyword = match[1]!.toLowerCase();
  const value = match[2]!.trim();
  if (!value || value.includes("=")) return undefined;
  return { keyword, value };
}

function parseOwnerRepositoryPath(path: string): { owner: string; repository: string } | undefined {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  return { owner: parts[parts.length - 2]!, repository: parts[parts.length - 1]! };
}

function normalizeScopeSegment(value: string): string {
  return value.toLowerCase().replace(/\.git$/i, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
