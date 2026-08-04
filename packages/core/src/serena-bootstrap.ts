import { spawn as nodeSpawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Stats } from "node:fs";

/**
 * Runner-neutral Serena prerequisite bootstrap.
 *
 * The operation policy remains runner-neutral and every external boundary is
 * injectable. Production binds those boundaries in one default composition;
 * callers and tests may replace the complete effect object to stay inert.
 */

export const SERENA_CAPABILITY_ID = "serena" as const;
export const SERENA_UV_INSTALLER_URL = "https://astral.sh/uv/install.sh" as const;
export const SERENA_UV_INSTALLER_EXECUTABLE = "/bin/sh" as const;
export const SERENA_UV_INSTALLER_ARGS = [] as const;
export const SERENA_UV_VERSION_ARGS = ["--version"] as const;
export const SERENA_INSTALL_ARGS = ["tool", "install", "-p", "3.13", "serena-agent"] as const;
export const SERENA_HELP_ARGS = ["--help"] as const;
export const SERENA_MCP_ARGS = [
  "start-mcp-server",
  "--context",
  "ide",
  "--project-from-cwd",
] as const;

/** Fixed bounds for remote content and child diagnostics. */
export const SERENA_UV_INSTALLER_MAX_BYTES = 1_048_576;
export const SERENA_UV_INSTALLER_TIMEOUT_MS = 30_000;
export const SERENA_CHILD_TIMEOUT_MS = 120_000;
export const SERENA_TERMINATION_GRACE_MS = 2_000;
const SERENA_UV_INSTALLER_MAX_REDIRECTS = 5;

export type SerenaRunner = "opencode" | "pi";

export type SerenaBootstrapAuthorization = Readonly<{
  kind: "interactive-tui-explicit-selection";
  runner: SerenaRunner;
  operationId: string;
}>;

export type SerenaOperationIdentity = Readonly<{
  runner: SerenaRunner;
  operationId: string;
  explicitlySelected: boolean;
}>;

export type SerenaBootstrapStage =
  | "preparing-uv"
  | "installing-serena"
  | "validating-serena";

export type SerenaReadinessEvidence = Readonly<{
  capabilityId: typeof SERENA_CAPABILITY_ID;
  state: "ready";
  resolvedExecutablePath: string;
  source: "existing-deck-tool" | "installed-deck-tool";
  probe: "serena-help";
  fingerprint: string;
}>;

export type SerenaBootstrapErrorCode =
  | "effects-unavailable"
  | "authorization-invalid"
  | "root-invalid"
  | "path-invalid"
  | "storage-unavailable"
  | "serena-unusable"
  | "serena-indeterminate"
  | "uv-unusable"
  | "uv-indeterminate"
  | "unsupported-bootstrap"
  | "fetch-failed"
  | "redirect-rejected"
  | "response-too-large"
  | "response-timeout"
  | "installer-failed"
  | "uv-not-ready"
  | "serena-install-failed"
  | "serena-not-ready"
  | "fingerprint-drift"
  | "process-failed";

export type SafeDiagnostic = Readonly<{
  code: string;
  message: string;
}>;

export type SerenaBootstrapResult =
  | Readonly<{
      outcome: "reused";
      evidence: SerenaReadinessEvidence;
    }>
  | Readonly<{
      outcome: "installed";
      evidence: SerenaReadinessEvidence;
    }>
  | Readonly<{
      outcome: "failed";
      stage: SerenaBootstrapStage;
      code: SerenaBootstrapErrorCode;
      diagnostic: SafeDiagnostic;
    }>
  | Readonly<{
      outcome: "cancelled";
      stage: SerenaBootstrapStage;
      mutationStarted: boolean;
    }>
  | Readonly<{
      outcome: "partial";
      stage: SerenaBootstrapStage;
      code: "termination-unknown";
    }>;

export type SerenaPathInspection = Readonly<{
  state: "missing" | "ready" | "unusable" | "indeterminate";
  resolvedPath?: string;
  fingerprint?: string;
}>;

export type SerenaProbeRequest = Readonly<{
  executablePath: string;
  ownedRoot: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  shell: false;
  timeoutMs: number;
  signal: AbortSignal;
}>;

export type SerenaProbeResult = Readonly<{
  state: "ready" | "unusable" | "indeterminate";
  resolvedPath?: string;
  fingerprint?: string;
}>;

export type SerenaFetchRequest = Readonly<{
  url: typeof SERENA_UV_INSTALLER_URL;
  method: "GET";
  redirect: "manual";
  credentials: "omit";
  headers: Readonly<Record<string, string>>;
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}>;

export type SerenaFetchResponse = Readonly<{
  status: number;
  redirected?: boolean;
  ok?: boolean;
  timedOut?: boolean;
  body: Uint8Array | string;
}>;

export type SerenaProcessSpec = Readonly<{
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  shell: false;
  stdio: readonly ["pipe", "pipe", "pipe"];
  stdin?: Uint8Array;
  timeoutMs: number;
  signal: AbortSignal;
}>;

export type SerenaProcessResult = Readonly<{
  state: "exited" | "error" | "timeout" | "unknown";
  exitCode?: number;
  termination?: "known" | "unknown";
}>;

export type SerenaProcessHandle = Readonly<{
  wait: () => Promise<SerenaProcessResult>;
  terminate: () => void | Promise<void>;
}>;

export type SerenaBootstrapEffects = Readonly<{
  resolveDeckDataRoot: () => string | Promise<string>;
  canonicalizePath: (path: string) => string | Promise<string>;
  /** Optional because a trusted platform resolver may already enforce this. */
  isUserOwnedPath?: (path: string) => boolean | Promise<boolean>;
  ensureDirectory: (path: string, signal: AbortSignal) => void | Promise<void>;
  inspectPath: (
    path: string,
    signal: AbortSignal,
    ownedRoot?: string,
  ) => SerenaPathInspection | Promise<SerenaPathInspection>;
  fetchInstaller: (request: SerenaFetchRequest) => SerenaFetchResponse | Promise<SerenaFetchResponse>;
  spawn: (spec: SerenaProcessSpec) => SerenaProcessHandle | Promise<SerenaProcessHandle>;
  /** Optional platform gate; false prevents directory, network, and process effects. */
  supportsControlledBootstrap?: () => boolean | Promise<boolean>;
  /** Probe effects are direct, fixed-argument probes; they never use PATH lookup. */
  probeExecutable: (request: SerenaProbeRequest) => SerenaProbeResult | Promise<SerenaProbeResult>;
  /** Optional injected bounded wait used after cancellation. */
  waitForTermination?: (
    handle: SerenaProcessHandle,
    timeoutMs: number,
  ) => SerenaProcessResult | Promise<SerenaProcessResult>;
}>;

export type SerenaBootstrapRequest = Readonly<{
  authorization?: SerenaBootstrapAuthorization | null;
  /** Optional duplicate context used to reject stale or runner-mismatched plans. */
  runner?: SerenaRunner;
  operationId?: string;
  operation?: SerenaOperationIdentity;
  currentOperation?: SerenaOperationIdentity;
  existingSerenaExecutablePath?: string;
  signal?: AbortSignal;
  onStage?: (stage: SerenaBootstrapStage) => void;
  effects?: SerenaBootstrapEffects;
}>;

export type SerenaReadinessValidationResult =
  | Readonly<{ valid: true; evidence: SerenaReadinessEvidence }>
  | Readonly<{
      valid: false;
      code: "invalid-readiness-evidence" | "stale-readiness-evidence";
      diagnostic: SafeDiagnostic;
    }>;

export type SerenaReadinessRevalidator = (
  evidence: SerenaReadinessEvidence,
) => SerenaReadinessValidationResult | Promise<SerenaReadinessValidationResult>;

export type SerenaMcpWriteStatus = "created" | "updated" | "unchanged";

export type SerenaMcpWriteResult =
  | Readonly<{
      ok: true;
      status: SerenaMcpWriteStatus;
      diagnostics?: readonly SafeDiagnostic[];
    }>
  | Readonly<{
      ok: false;
      code: string;
      diagnostic: SafeDiagnostic;
    }>;

export type SerenaMcpWriterInput = Readonly<{
  authorization: SerenaBootstrapAuthorization;
  operation: SerenaOperationIdentity;
  readiness: SerenaReadinessEvidence;
  command: string;
  args: readonly string[];
  revalidate: SerenaReadinessRevalidator;
}>;

export type SerenaMcpWriter = (
  input: SerenaMcpWriterInput,
) => SerenaMcpWriteResult | Promise<SerenaMcpWriteResult>;

export type SerenaBootstrapService = Readonly<{
  bootstrapSerena: (request: SerenaBootstrapRequest) => Promise<SerenaBootstrapResult>;
}>;

const DIAGNOSTIC_MESSAGES: Readonly<Record<SerenaBootstrapErrorCode, string>> = {
  "effects-unavailable": "Serena setup is unavailable in this execution context.",
  "authorization-invalid": "Serena can run only after explicit selection in the current install operation.",
  "root-invalid": "Deck-owned Serena storage could not be resolved safely.",
  "path-invalid": "A Deck-owned Serena path did not pass the safety boundary.",
  "storage-unavailable": "Deck-owned Serena storage could not be prepared.",
  "serena-unusable": "An existing Serena executable is present but not ready; no replacement was attempted.",
  "serena-indeterminate": "Serena readiness could not be determined; no replacement was attempted.",
  "uv-unusable": "An existing Deck-owned uv executable is present but not ready; no replacement was attempted.",
  "uv-indeterminate": "Deck-owned uv readiness could not be determined.",
  "unsupported-bootstrap": "This environment cannot run the controlled uv bootstrap.",
  "fetch-failed": "The official uv installer could not be acquired.",
  "redirect-rejected": "The official uv installer response was redirected and was rejected.",
  "response-too-large": "The official uv installer response exceeded the bounded limit.",
  "response-timeout": "The official uv installer response exceeded the bounded timeout.",
  "installer-failed": "The controlled uv installer did not complete successfully.",
  "uv-not-ready": "The installed Deck-owned uv executable is not ready.",
  "serena-install-failed": "The controlled Serena installation did not complete successfully.",
  "serena-not-ready": "Serena installation completed without fresh executable readiness.",
  "fingerprint-drift": "Serena executable identity changed during readiness checks.",
  "process-failed": "A controlled Serena process could not be started.",
};

const inFlightByRoot = new Map<string, Promise<SerenaBootstrapResult>>();

const DEFAULT_CHILD_CAPTURE_BYTES = 65_536;
const PROTECTED_SYSTEM_ROOTS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
] as const;

function errorCode(value: unknown): string | undefined {
  return isRecord(value) && typeof value.code === "string" ? value.code : undefined;
}

function isMissingPathError(value: unknown): boolean {
  return errorCode(value) === "ENOENT" || errorCode(value) === "ENOTDIR";
}

function currentUserId(): number | undefined {
  const getuid = (process as unknown as { getuid?: () => number }).getuid;
  return typeof getuid === "function" ? getuid() : undefined;
}

function isProtectedSystemPath(path: string): boolean {
  return PROTECTED_SYSTEM_ROOTS.some((root) => isContained(path, root));
}

function defaultDeckDataRoot(): string {
  const home = homedir();
  const configuredDataHome = process.env.XDG_DATA_HOME;
  const dataHome = configuredDataHome && configuredDataHome.startsWith("/") && !hasUnsafeCharacters(configuredDataHome)
    ? configuredDataHome
    : join(home, ".local", "share");
  return join(dataHome, "deck");
}

/**
 * Canonicalize a path without requiring the final path to exist. Existing
 * ancestors are realpathed so a symlink cannot silently move a later write
 * outside the path that Core validates.
 */
async function defaultCanonicalizePath(pathValue: string): Promise<string> {
  const lexical = normalizedAbsolutePath(pathValue);
  if (!lexical) throw new Error("invalid path");

  const missingParts: string[] = [];
  let cursor = lexical;
  while (true) {
    try {
      const existing = normalizedAbsolutePath(await realpath(cursor));
      if (!existing) throw new Error("invalid canonical path");
      const joined = missingParts.reduce((current, part) => join(current, part), existing);
      const canonical = normalizedAbsolutePath(joined);
      if (!canonical) throw new Error("invalid canonical path");
      return canonical;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missingParts.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function findExistingAncestor(pathValue: string): Promise<{ path: string; stats: Stats } | undefined> {
  let cursor = pathValue;
  while (true) {
    try {
      return { path: cursor, stats: await lstat(cursor) };
    } catch (error) {
      if (!isMissingPathError(error)) return undefined;
      const parent = dirname(cursor);
      if (parent === cursor) return undefined;
      cursor = parent;
    }
  }
}

async function defaultIsUserOwnedPath(pathValue: string): Promise<boolean> {
  let canonical: string;
  try {
    canonical = await defaultCanonicalizePath(pathValue);
  } catch {
    return false;
  }
  if (canonical === "/" || isProtectedSystemPath(canonical)) return false;

  const home = await defaultCanonicalizePath(homedir()).catch(() => undefined);
  const underHome = home !== undefined && isContained(canonical, home);
  const existing = await findExistingAncestor(canonical);
  if (!existing || existing.stats.isSymbolicLink()) return false;

  const uid = currentUserId();
  if (uid === undefined) return underHome;
  return existing.stats.uid === uid && (underHome || !isProtectedSystemPath(canonical));
}

async function defaultEnsureDirectory(pathValue: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("cancelled");
  await mkdir(pathValue, { recursive: true, mode: 0o700 });
  try {
    await chmod(pathValue, 0o700);
  } catch {
    if (process.platform !== "win32") throw new Error("directory permissions unavailable");
  }
  const entry = await lstat(pathValue);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("directory is not owned");
  const canonical = normalizedAbsolutePath(await realpath(pathValue));
  if (canonical !== pathValue) throw new Error("directory escaped");
}

function fileFingerprint(stats: Stats): string {
  return [
    stats.dev,
    stats.ino,
    stats.size,
    Math.trunc(stats.mtimeMs),
    Math.trunc(stats.ctimeMs),
    stats.mode,
  ].join(":");
}

async function defaultInspectPath(
  pathValue: string,
  signal: AbortSignal,
  ownedRoot?: string,
): Promise<SerenaPathInspection> {
  if (signal.aborted) return { state: "indeterminate" };
  try {
    const beforeEntry = await lstat(pathValue);
    const isSymlink = beforeEntry.isSymbolicLink();
    if (!isSymlink && !beforeEntry.isFile()) return { state: "unusable", resolvedPath: pathValue };
    const resolved = normalizedAbsolutePath(await realpath(pathValue));
    const root = ownedRoot === undefined ? undefined : normalizedAbsolutePath(ownedRoot);
    if (
      !resolved
      || isSymlink && (!root || !isContained(resolved, root))
      || !isSymlink && resolved !== pathValue
    ) return { state: "unusable", resolvedPath: pathValue };
    const beforeTarget = isSymlink ? await lstat(resolved) : beforeEntry;
    if (!beforeTarget.isFile() || (beforeTarget.mode & 0o111) === 0) {
      return { state: "unusable", resolvedPath: pathValue };
    }
    await access(pathValue, fsConstants.X_OK);
    const afterEntry = await lstat(pathValue);
    const afterResolved = normalizedAbsolutePath(await realpath(pathValue));
    if (
      afterEntry.isSymbolicLink() !== isSymlink
      || afterResolved !== resolved
      || isSymlink && (!root || !isContained(afterResolved, root))
    ) {
      return { state: "indeterminate", resolvedPath: pathValue };
    }
    const afterTarget = isSymlink ? await lstat(resolved) : afterEntry;
    if (!afterTarget.isFile() || (afterTarget.mode & 0o111) === 0) {
      return { state: "indeterminate", resolvedPath: pathValue };
    }
    const beforeFingerprint = isSymlink
      ? `${fileFingerprint(beforeEntry)}:${fileFingerprint(beforeTarget)}`
      : fileFingerprint(beforeTarget);
    const afterFingerprint = isSymlink
      ? `${fileFingerprint(afterEntry)}:${fileFingerprint(afterTarget)}`
      : fileFingerprint(afterTarget);
    if (beforeFingerprint !== afterFingerprint) return { state: "indeterminate", resolvedPath: pathValue };
    return { state: "ready", resolvedPath: pathValue, fingerprint: afterFingerprint };
  } catch (error) {
    if (isMissingPathError(error)) return { state: "missing" };
    return { state: "indeterminate" };
  }
}

function captureChildOutput(stream: unknown): void {
  if (!isRecord(stream) || typeof stream.on !== "function") return;
  let captured = 0;
  stream.on("data", (chunk: unknown) => {
    if (captured >= DEFAULT_CHILD_CAPTURE_BYTES) return;
    const size = typeof chunk === "string"
      ? new TextEncoder().encode(chunk).byteLength
      : chunk instanceof Uint8Array ? chunk.byteLength : 0;
    captured = Math.min(DEFAULT_CHILD_CAPTURE_BYTES, captured + size);
  });
}

function createDefaultProcessHandle(
  child: ReturnType<typeof nodeSpawn>,
  timeoutMs: number,
): SerenaProcessHandle {
  let terminationRequested = false;
  let waitPromise: Promise<SerenaProcessResult> | undefined;

  const terminate = (): void => {
    terminationRequested = true;
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      // The wait result determines whether termination was known.
    }
  };

  const wait = (): Promise<SerenaProcessResult> => {
    if (waitPromise) return waitPromise;
    waitPromise = new Promise((resolve) => {
      let settled = false;
      let timedOut = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: SerenaProcessResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        child.removeListener("close", onClose);
        child.removeListener("error", onError);
        resolve(result);
      };
      const onClose = (exitCode: number | null): void => {
        finish({
          state: timedOut ? "timeout" : "exited",
          exitCode: exitCode === null ? undefined : exitCode,
          termination: "known",
        });
      };
      const onError = (): void => {
        finish({ state: timedOut ? "timeout" : "error", termination: "known" });
      };

      child.once("close", onClose);
      child.once("error", onError);
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate();
        graceTimer = setTimeout(() => finish({ state: "unknown", termination: "unknown" }), SERENA_TERMINATION_GRACE_MS);
      }, timeoutMs);
      if (terminationRequested) terminate();
    });
    return waitPromise;
  };

  return { wait, terminate };
}

async function defaultSpawn(spec: SerenaProcessSpec): Promise<SerenaProcessHandle> {
  const child = nodeSpawn(spec.executable, [...spec.args], {
    env: { ...spec.env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  captureChildOutput(child.stdout);
  captureChildOutput(child.stderr);
  if (!child.stdin) throw new Error("child stdin unavailable");
  try {
    child.stdin.end(spec.stdin === undefined ? undefined : Buffer.from(spec.stdin));
  } catch (error) {
    try { child.kill("SIGTERM"); } catch { /* ignore cleanup failure */ }
    throw error;
  }

  const handle = createDefaultProcessHandle(child, spec.timeoutMs);
  const onAbort = (): void => {
    void handle.terminate();
  };
  spec.signal.addEventListener("abort", onAbort, { once: true });
  if (spec.signal.aborted) handle.terminate();
  const pendingWait = handle.wait();
  return {
    terminate: handle.terminate,
    wait: async () => {
      try {
        return await pendingWait;
      } finally {
        spec.signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

async function defaultWaitForTermination(
  handle: SerenaProcessHandle,
  timeoutMs: number,
): Promise<SerenaProcessResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SerenaProcessResult>((resolve) => {
    timer = setTimeout(() => resolve({ state: "unknown", termination: "unknown" }), timeoutMs);
  });
  try {
    return await Promise.race([handle.wait(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBoundedResponseBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel();
        return new Uint8Array();
      }
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) return new Uint8Array();
      if (total + chunk.byteLength > maxBytes) {
        await reader.cancel();
        return new Uint8Array(maxBytes + 1);
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

type SerenaFetchTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isSafeSerenaInstallerRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.hostname.length > 0
    && !url.username
    && !url.password
    && !url.port;
}

async function defaultFetchInstaller(
  request: SerenaFetchRequest,
  fetchTransport: SerenaFetchTransport = globalThis.fetch,
): Promise<SerenaFetchResponse> {
  if (
    request.url !== SERENA_UV_INSTALLER_URL
    || request.method !== "GET"
    || request.redirect !== "manual"
    || request.credentials !== "omit"
  ) {
    return { status: 400, body: new Uint8Array() };
  }

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort();
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);
  try {
    let currentUrl: string = SERENA_UV_INSTALLER_URL;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await fetchTransport(currentUrl, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {},
        signal: controller.signal,
      });
      if (timedOut) return { status: response.status, timedOut: true, body: new Uint8Array() };
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        let nextUrl: string | undefined;
        try {
          if (location) nextUrl = new URL(location, currentUrl).href;
        } catch {
          nextUrl = undefined;
        }
        if (
          redirectCount >= SERENA_UV_INSTALLER_MAX_REDIRECTS
          || !nextUrl
          || !isSafeSerenaInstallerRedirect(nextUrl)
        ) {
          return { status: response.status, redirected: true, body: new Uint8Array() };
        }
        currentUrl = nextUrl;
        continue;
      }
      if (response.redirected) {
        return { status: response.status, redirected: true, body: new Uint8Array() };
      }
      const body = await readBoundedResponseBody(response.body, request.maxBytes, controller.signal);
      if (timedOut) return { status: response.status, timedOut: true, body: new Uint8Array() };
      return {
        status: response.status,
        redirected: false,
        ok: response.ok,
        body,
      };
    }
  } catch {
    return { status: 0, timedOut, body: new Uint8Array() };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
}

async function defaultProbeExecutable(request: SerenaProbeRequest): Promise<SerenaProbeResult> {
  if (request.signal.aborted) return { state: "indeterminate" };
  let handle: SerenaProcessHandle;
  try {
    handle = await defaultSpawn({
      executable: request.executablePath,
      args: request.args,
      env: request.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    });
  } catch {
    return request.signal.aborted ? { state: "indeterminate" } : { state: "unusable" };
  }
  const result = await handle.wait();
  if (request.signal.aborted) return { state: "indeterminate" };
  if (!processSucceeded(result)) return { state: result.state === "unknown" ? "indeterminate" : "unusable" };
  const inspection = await defaultInspectPath(request.executablePath, request.signal, request.ownedRoot);
  if (inspection.state === "ready") {
    return {
      state: "ready",
      resolvedPath: inspection.resolvedPath,
      fingerprint: inspection.fingerprint,
    };
  }
  return { state: inspection.state === "unusable" ? "unusable" : "indeterminate" };
}

async function defaultSupportsControlledBootstrap(): Promise<boolean> {
  if (process.platform === "win32") return false;
  try {
    await access(SERENA_UV_INSTALLER_EXECUTABLE, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the production effect composition. The returned object is the only
 * place where Core binds its policy to Node/Bun process, filesystem, home,
 * and fetch primitives; tests continue to pass a complete fake object.
 */
export function createDefaultSerenaBootstrapEffects(
  options: Readonly<{ fetch?: SerenaFetchTransport }> = {},
): SerenaBootstrapEffects {
  return Object.freeze({
    resolveDeckDataRoot: defaultDeckDataRoot,
    canonicalizePath: defaultCanonicalizePath,
    isUserOwnedPath: defaultIsUserOwnedPath,
    ensureDirectory: defaultEnsureDirectory,
    inspectPath: defaultInspectPath,
    fetchInstaller: (request) => defaultFetchInstaller(request, options.fetch),
    spawn: defaultSpawn,
    supportsControlledBootstrap: defaultSupportsControlledBootstrap,
    probeExecutable: defaultProbeExecutable,
    waitForTermination: defaultWaitForTermination,
  });
}

const defaultSerenaBootstrapEffects = createDefaultSerenaBootstrapEffects();

function failed(
  stage: SerenaBootstrapStage,
  code: SerenaBootstrapErrorCode,
): SerenaBootstrapResult {
  return {
    outcome: "failed",
    stage,
    code,
    diagnostic: { code, message: DIAGNOSTIC_MESSAGES[code] },
  };
}

function cancelled(stage: SerenaBootstrapStage, mutationStarted: boolean): SerenaBootstrapResult {
  return { outcome: "cancelled", stage, mutationStarted };
}

function partial(stage: SerenaBootstrapStage): SerenaBootstrapResult {
  return { outcome: "partial", stage, code: "termination-unknown" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeOperationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && !hasUnsafeCharacters(value);
}

function hasUnsafeCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f\u0080-\u009f]/u.test(value);
}

function normalizedAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || hasUnsafeCharacters(value) || value.includes("\0")) {
    return undefined;
  }
  if (!value.startsWith("/")) return undefined;
  const parts = value.split("/");
  if (parts.some((part) => part === "..")) return undefined;
  const normalized = value.replaceAll(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
  return normalized;
}

function isContained(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isSafeFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function joinOwnedPath(root: string, ...parts: readonly string[]): string {
  return [root.replace(/\/$/u, ""), ...parts].join("/");
}

function asBytes(value: Uint8Array | string): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  return undefined;
}

function stageForAuthorization(): SerenaBootstrapStage {
  return "preparing-uv";
}

function safeDiagnostic(code: "invalid-readiness-evidence" | "stale-readiness-evidence"): SafeDiagnostic {
  return {
    code,
    message:
      code === "stale-readiness-evidence"
        ? "Serena readiness changed before configuration."
        : "Serena readiness evidence is invalid for configuration.",
  };
}

/**
 * Validate an authorization as an ephemeral current-operation capability.
 * The function intentionally accepts unknown input at this boundary.
 */
export function validateSerenaOperationAuthorization(
  value: unknown,
  currentOperation?: Partial<SerenaOperationIdentity>,
):
  | Readonly<{ valid: true; authorization: SerenaBootstrapAuthorization }>
  | Readonly<{ valid: false; code: "authorization-invalid" }> {
  if (!isRecord(value)) return { valid: false, code: "authorization-invalid" };
  if (value.kind !== "interactive-tui-explicit-selection") {
    return { valid: false, code: "authorization-invalid" };
  }
  if (value.runner !== "opencode" && value.runner !== "pi") {
    return { valid: false, code: "authorization-invalid" };
  }
  if (!isSafeOperationId(value.operationId)) {
    return { valid: false, code: "authorization-invalid" };
  }

  if (currentOperation) {
    if (
      currentOperation.explicitlySelected !== true ||
      currentOperation.runner !== value.runner ||
      currentOperation.operationId !== value.operationId
    ) {
      return { valid: false, code: "authorization-invalid" };
    }
  }

  return {
    valid: true,
    authorization: {
      kind: "interactive-tui-explicit-selection",
      runner: value.runner,
      operationId: value.operationId,
    },
  };
}

/**
 * Validate only the private evidence shape. Revalidation against current
 * filesystem identity remains a separate contract and cannot be inferred from
 * a serialized result.
 */
export function validateSerenaReadinessEvidence(
  value: unknown,
  ownedRoot?: string,
): SerenaReadinessValidationResult {
  if (!isRecord(value)) {
    return { valid: false, code: "invalid-readiness-evidence", diagnostic: safeDiagnostic("invalid-readiness-evidence") };
  }
  const path = normalizedAbsolutePath(value.resolvedExecutablePath);
  const root = ownedRoot === undefined ? undefined : normalizedAbsolutePath(ownedRoot);
  if (
    value.capabilityId !== SERENA_CAPABILITY_ID ||
    value.state !== "ready" ||
    value.source !== "existing-deck-tool" && value.source !== "installed-deck-tool" ||
    value.probe !== "serena-help" ||
    path === undefined ||
    !isSafeFingerprint(value.fingerprint) ||
    root === undefined && ownedRoot !== undefined ||
    root !== undefined && !isContained(path, root)
  ) {
    return { valid: false, code: "invalid-readiness-evidence", diagnostic: safeDiagnostic("invalid-readiness-evidence") };
  }
  return {
    valid: true,
    evidence: {
      capabilityId: SERENA_CAPABILITY_ID,
      state: "ready",
      resolvedExecutablePath: path,
      source: value.source,
      probe: "serena-help",
      fingerprint: value.fingerprint,
    },
  };
}

export function isSerenaReadinessEvidence(value: unknown, ownedRoot?: string): value is SerenaReadinessEvidence {
  return validateSerenaReadinessEvidence(value, ownedRoot).valid;
}

export function validateSerenaBootstrapResult(
  value: unknown,
  ownedRoot?: string,
):
  | Readonly<{ valid: true; result: Extract<SerenaBootstrapResult, { outcome: "reused" | "installed" }> }>
  | Readonly<{ valid: false; code: "invalid-readiness-evidence" }> {
  if (!isRecord(value) || value.outcome !== "reused" && value.outcome !== "installed") {
    return { valid: false, code: "invalid-readiness-evidence" };
  }
  const evidence = validateSerenaReadinessEvidence(value.evidence, ownedRoot);
  if (!evidence.valid) return { valid: false, code: "invalid-readiness-evidence" };
  const outcome = value.outcome as "reused" | "installed";
  return {
    valid: true,
    result: { outcome, evidence: evidence.evidence },
  };
}

export function isSuccessfulSerenaBootstrapResult(
  value: unknown,
  ownedRoot?: string,
): value is Extract<SerenaBootstrapResult, { outcome: "reused" | "installed" }> {
  return validateSerenaBootstrapResult(value, ownedRoot).valid;
}

/**
 * Revalidate the exact path and fingerprint immediately before a writer call.
 * A revalidator may return a fresh evidence object, but it may not silently
 * substitute a different executable for the one that produced the result.
 */
export async function revalidateSerenaReadiness(
  evidence: unknown,
  revalidator: SerenaReadinessRevalidator,
  ownedRoot?: string,
): Promise<SerenaReadinessValidationResult> {
  const initial = validateSerenaReadinessEvidence(evidence, ownedRoot);
  if (!initial.valid) return initial;

  let refreshed: SerenaReadinessValidationResult;
  try {
    refreshed = await revalidator(initial.evidence);
  } catch {
    return { valid: false, code: "stale-readiness-evidence", diagnostic: safeDiagnostic("stale-readiness-evidence") };
  }
  if (!refreshed.valid) return refreshed;
  const refreshedShape = validateSerenaReadinessEvidence(refreshed.evidence, ownedRoot);
  if (!refreshedShape.valid) return refreshedShape;
  if (
    refreshedShape.evidence.resolvedExecutablePath !== initial.evidence.resolvedExecutablePath ||
    refreshedShape.evidence.fingerprint !== initial.evidence.fingerprint
  ) {
    return { valid: false, code: "stale-readiness-evidence", diagnostic: safeDiagnostic("stale-readiness-evidence") };
  }
  return refreshedShape;
}

export type SerenaMcpWriterValidationResult =
  | Readonly<{ valid: true; input: SerenaMcpWriterInput }>
  | Readonly<{
      valid: false;
      code: "invalid-readiness-evidence" | "stale-readiness-evidence" | "authorization-invalid";
      diagnostic: SafeDiagnostic;
    }>;

export function validateSerenaMcpWriterInput(
  value: unknown,
  ownedRoot?: string,
): SerenaMcpWriterValidationResult {
  if (!isRecord(value)) {
    return { valid: false, code: "invalid-readiness-evidence", diagnostic: safeDiagnostic("invalid-readiness-evidence") };
  }
  const authorization = isRecord(value.operation) && value.operation.explicitlySelected === true
    ? validateSerenaOperationAuthorization(value.authorization, value.operation)
    : { valid: false as const, code: "authorization-invalid" as const };
  if (!authorization.valid) {
    return {
      valid: false,
      code: "authorization-invalid",
      diagnostic: { code: "authorization-invalid", message: DIAGNOSTIC_MESSAGES["authorization-invalid"] },
    };
  }
  const readiness = validateSerenaReadinessEvidence(value.readiness, ownedRoot);
  if (!readiness.valid) return readiness;
  const command = normalizedAbsolutePath(value.command);
  const args = value.args;
  if (
    command !== readiness.evidence.resolvedExecutablePath ||
    !Array.isArray(args) ||
    args.length !== SERENA_MCP_ARGS.length ||
    args.some((arg, index) => arg !== SERENA_MCP_ARGS[index])
  ) {
    return { valid: false, code: "invalid-readiness-evidence", diagnostic: safeDiagnostic("invalid-readiness-evidence") };
  }
  return {
    valid: true,
    input: value as SerenaMcpWriterInput,
  };
}

/** Run an injected writer only after authorization, shape, and revalidation gates. */
export async function runEvidenceGatedSerenaWriter(
  input: SerenaMcpWriterInput,
  writer: SerenaMcpWriter,
  ownedRoot?: string,
): Promise<SerenaMcpWriteResult> {
  const shape = validateSerenaMcpWriterInput(input, ownedRoot);
  if (!shape.valid) return { ok: false, code: shape.code, diagnostic: shape.diagnostic };
  const refreshed = await revalidateSerenaReadiness(input.readiness, input.revalidate, ownedRoot);
  if (!refreshed.valid) return { ok: false, code: refreshed.code, diagnostic: refreshed.diagnostic };
  try {
    const result = await writer({ ...input, readiness: refreshed.evidence });
    if (
      !isRecord(result) ||
      result.ok !== true ||
      result.status !== "created" && result.status !== "updated" && result.status !== "unchanged"
    ) {
      return {
        ok: false,
        code: "writer-result-invalid",
        diagnostic: { code: "writer-result-invalid", message: "Serena configuration result was invalid." },
      };
    }
    return {
      ok: true,
      status: result.status,
      diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : undefined,
    };
  } catch {
    return {
      ok: false,
      code: "writer-failed",
      diagnostic: { code: "writer-failed", message: "Serena configuration was not changed." },
    };
  }
}

/**
 * Bounded diagnostic helper for adapter/UI boundaries. Core results use fixed
 * messages; this helper is available for callers that need to display a
 * bounded effect-provided detail without leaking private data.
 */
export function redactSerenaDiagnostic(
  value: unknown,
  options: Readonly<{
    privateRoots?: readonly string[];
    maxBytes?: number;
    maxLines?: number;
  }> = {},
): string {
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 512, 4096));
  const maxLines = Math.max(1, Math.min(options.maxLines ?? 4, 16));
  let text: string;
  try {
    text = typeof value === "string" ? value : String(value);
  } catch {
    text = "additional diagnostic unavailable";
  }

  text = text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f]/gu, "")
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s]+@/giu, "$1<redacted>@")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/giu, "$1<redacted>")
    .replace(/\b(token|password|secret|authorization|cookie|api[-_]?key)\s*[:=]\s*[^\s,;]+/giu, "$1=<redacted>");

  for (const privateRoot of options.privateRoots ?? []) {
    if (privateRoot.length > 0) text = text.split(privateRoot).join("<deck-root>");
  }

  const lines = text.split("\n").slice(0, maxLines);
  text = lines.join("\n");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  if (maxBytes <= 3) return ".".repeat(maxBytes);
  return `${new TextDecoder().decode(bytes.slice(0, maxBytes - 3))}…`;
}

function validateRoot(path: unknown): string | undefined {
  const normalized = normalizedAbsolutePath(path);
  if (normalized === undefined || normalized === "/") return undefined;
  return normalized;
}

function emitStage(request: SerenaBootstrapRequest, stage: SerenaBootstrapStage): void {
  try {
    request.onStage?.(stage);
  } catch {
    // Progress is advisory and must never change an install outcome.
  }
}

async function callEffect<T>(effect: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await effect();
  } catch {
    return undefined;
  }
}

function checkCancellation(
  signal: AbortSignal,
  stage: SerenaBootstrapStage,
  mutationStarted: boolean,
): SerenaBootstrapResult | undefined {
  return signal.aborted ? cancelled(stage, mutationStarted) : undefined;
}

function normalizedProcessResult(value: SerenaProcessResult | undefined): SerenaProcessResult {
  if (!value || value.state === "unknown" || value.termination === "unknown") {
    return { state: "unknown", termination: "unknown" };
  }
  return value;
}

type ProcessStep =
  | Readonly<{ kind: "outcome"; result: SerenaProcessResult }>
  | Readonly<{ kind: "terminal"; result: SerenaBootstrapResult }>;

async function runControlledProcess(
  effects: SerenaBootstrapEffects,
  spec: SerenaProcessSpec,
  stage: SerenaBootstrapStage,
  mutationStarted: boolean,
): Promise<ProcessStep> {
  if (spec.signal.aborted) return { kind: "terminal", result: cancelled(stage, mutationStarted) };

  let handle: SerenaProcessHandle;
  try {
    handle = await effects.spawn(spec);
  } catch {
    if (spec.signal.aborted) return { kind: "terminal", result: cancelled(stage, mutationStarted) };
    return { kind: "terminal", result: failed(stage, "process-failed") };
  }

  let cancellationRequested: boolean = spec.signal.aborted;
  const terminate = (): void => {
    cancellationRequested = true;
    try {
      void Promise.resolve(handle.terminate()).catch(() => undefined);
    } catch {
      // The wait result below determines whether termination is known.
    }
  };
  const onAbort = (): void => terminate();
  spec.signal.addEventListener("abort", onAbort, { once: true });
  if (cancellationRequested) terminate();

  let processResult: SerenaProcessResult | undefined;
  try {
    processResult = cancellationRequested && effects.waitForTermination
      ? await effects.waitForTermination(handle, SERENA_TERMINATION_GRACE_MS)
      : await handle.wait();
  } catch {
    processResult = { state: "unknown", termination: "unknown" };
  } finally {
    spec.signal.removeEventListener("abort", onAbort);
  }

  const normalized = normalizedProcessResult(processResult);
  if (cancellationRequested || spec.signal.aborted) {
    return normalized.state === "unknown" || normalized.termination === "unknown"
      ? { kind: "terminal", result: partial(stage) }
      : { kind: "terminal", result: cancelled(stage, mutationStarted) };
  }
  return { kind: "outcome", result: normalized };
}

function processSucceeded(result: SerenaProcessResult): boolean {
  return result.state === "exited" && result.exitCode === 0 && result.termination !== "unknown";
}

type OwnedPaths = Readonly<{
  root: string;
  uvInstallDir: string;
  uvPath: string;
  uvToolsDir: string;
  binDir: string;
  serenaPath: string;
  pythonDir: string;
  pythonBinDir: string;
  cacheDir: string;
}>;

function makeOwnedPaths(root: string): OwnedPaths {
  const uvInstallDir = joinOwnedPath(root, "uv");
  return {
    root,
    uvInstallDir,
    uvPath: joinOwnedPath(uvInstallDir, "uv"),
    uvToolsDir: joinOwnedPath(root, "uv-tools"),
    binDir: joinOwnedPath(root, "bin"),
    serenaPath: joinOwnedPath(root, "bin", "serena"),
    pythonDir: joinOwnedPath(root, "python"),
    pythonBinDir: joinOwnedPath(root, "python-bin"),
    cacheDir: joinOwnedPath(root, "cache"),
  };
}

function installerEnvironment(paths: OwnedPaths): Readonly<Record<string, string>> {
  return Object.freeze({
    PATH: "/usr/bin:/bin",
    LC_ALL: "C",
    UV_UNMANAGED_INSTALL: paths.uvInstallDir,
    UV_NO_MODIFY_PATH: "1",
  });
}

function serenaEnvironment(paths: OwnedPaths): Readonly<Record<string, string>> {
  return Object.freeze({
    PATH: "/usr/bin:/bin",
    LC_ALL: "C",
    UV_TOOL_DIR: paths.uvToolsDir,
    UV_TOOL_BIN_DIR: paths.binDir,
    UV_PYTHON_INSTALL_DIR: paths.pythonDir,
    UV_PYTHON_BIN_DIR: paths.pythonBinDir,
    UV_CACHE_DIR: paths.cacheDir,
  });
}

function pathInspectionIsUsable(path: string, inspection: SerenaPathInspection): boolean {
  const resolved = normalizedAbsolutePath(inspection.resolvedPath ?? path);
  return (
    inspection.state === "ready" &&
    resolved === path &&
    isSafeFingerprint(inspection.fingerprint)
  );
}

async function inspect(
  effects: SerenaBootstrapEffects,
  path: string,
  ownedRoot: string,
  signal: AbortSignal,
  stage: SerenaBootstrapStage,
  mutationStarted = false,
): Promise<SerenaPathInspection | SerenaBootstrapResult> {
  const before = checkCancellation(signal, stage, mutationStarted);
  if (before) return before;
  const result = await callEffect(() => effects.inspectPath(path, signal, ownedRoot));
  const after = checkCancellation(signal, stage, mutationStarted);
  if (after) return after;
  return result ?? { state: "indeterminate" };
}

async function probe(
  effects: SerenaBootstrapEffects,
  path: string,
  ownedRoot: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  signal: AbortSignal,
  stage: SerenaBootstrapStage,
  mutationStarted = false,
): Promise<SerenaProbeResult | SerenaBootstrapResult> {
  const before = checkCancellation(signal, stage, mutationStarted);
  if (before) return before;
  const result = await callEffect(() =>
    effects.probeExecutable({
      executablePath: path,
      ownedRoot,
      args,
      env,
      shell: false,
      timeoutMs: SERENA_CHILD_TIMEOUT_MS,
      signal,
    }),
  );
  const after = checkCancellation(signal, stage, mutationStarted);
  if (after) return after;
  return result ?? { state: "indeterminate" };
}

type ReadinessStep =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "ready"; evidence: SerenaReadinessEvidence }>
  | Readonly<{ kind: "terminal"; result: SerenaBootstrapResult }>;

async function readSerenaReadiness(
  effects: SerenaBootstrapEffects,
  paths: OwnedPaths,
  candidatePath: string,
  signal: AbortSignal,
  request: SerenaBootstrapRequest,
  source: SerenaReadinessEvidence["source"],
  mutationStarted = false,
): Promise<ReadinessStep> {
  emitStage(request, "validating-serena");
  const inspectionResult = await inspect(effects, candidatePath, paths.root, signal, "validating-serena", mutationStarted);
  if (!isRecord(inspectionResult) || "outcome" in inspectionResult) {
    return { kind: "terminal", result: inspectionResult as SerenaBootstrapResult };
  }
  if (inspectionResult.state === "missing") return { kind: "missing" };
  if (inspectionResult.state === "indeterminate") {
    return { kind: "terminal", result: failed("validating-serena", "serena-indeterminate") };
  }
  if (!pathInspectionIsUsable(candidatePath, inspectionResult)) {
    return { kind: "terminal", result: failed("validating-serena", "serena-unusable") };
  }

  const probeResult = await probe(
    effects,
    candidatePath,
    paths.root,
    SERENA_HELP_ARGS,
    serenaEnvironment(paths),
    signal,
    "validating-serena",
    mutationStarted,
  );
  if (!isRecord(probeResult) || "outcome" in probeResult) {
    return { kind: "terminal", result: probeResult as SerenaBootstrapResult };
  }
  if (probeResult.state === "indeterminate") {
    return { kind: "terminal", result: failed("validating-serena", "serena-indeterminate") };
  }
  if (probeResult.state !== "ready") {
    return { kind: "terminal", result: failed("validating-serena", "serena-unusable") };
  }
  const resolvedPath = normalizedAbsolutePath(probeResult.resolvedPath ?? candidatePath);
  if (
    resolvedPath !== candidatePath ||
    probeResult.fingerprint !== undefined && probeResult.fingerprint !== inspectionResult.fingerprint
  ) {
    return { kind: "terminal", result: failed("validating-serena", "fingerprint-drift") };
  }
  const fingerprint = probeResult.fingerprint ?? inspectionResult.fingerprint;
  if (!isSafeFingerprint(fingerprint)) {
    return { kind: "terminal", result: failed("validating-serena", "serena-not-ready") };
  }

  return {
    kind: "ready",
    evidence: {
      capabilityId: SERENA_CAPABILITY_ID,
      state: "ready",
      resolvedExecutablePath: candidatePath,
      source,
      probe: "serena-help",
      fingerprint,
    },
  };
}

async function readUvReadiness(
  effects: SerenaBootstrapEffects,
  paths: OwnedPaths,
  signal: AbortSignal,
  stage: SerenaBootstrapStage,
  mutationStarted = false,
): Promise<"missing" | "ready" | SerenaBootstrapResult> {
  const inspectionResult = await inspect(effects, paths.uvPath, paths.root, signal, stage, mutationStarted);
  if (!isRecord(inspectionResult) || "outcome" in inspectionResult) {
    return inspectionResult as SerenaBootstrapResult;
  }
  if (inspectionResult.state === "missing") return "missing";
  if (inspectionResult.state === "indeterminate") return failed(stage, "uv-indeterminate");
  if (!pathInspectionIsUsable(paths.uvPath, inspectionResult)) return failed(stage, "uv-unusable");

  const probeResult = await probe(
    effects,
    paths.uvPath,
    paths.root,
    SERENA_UV_VERSION_ARGS,
    serenaEnvironment(paths),
    signal,
    stage,
    mutationStarted,
  );
  if (!isRecord(probeResult) || "outcome" in probeResult) return probeResult as SerenaBootstrapResult;
  if (probeResult.state === "indeterminate") return failed(stage, "uv-indeterminate");
  if (probeResult.state !== "ready") return failed(stage, "uv-not-ready");
  if (
    normalizedAbsolutePath(probeResult.resolvedPath ?? paths.uvPath) !== paths.uvPath ||
    probeResult.fingerprint !== undefined && probeResult.fingerprint !== inspectionResult.fingerprint
  ) {
    return failed(stage, "fingerprint-drift");
  }
  return "ready";
}

async function ensureOwnedDirectories(
  effects: SerenaBootstrapEffects,
  paths: OwnedPaths,
  signal: AbortSignal,
  stage: SerenaBootstrapStage,
): Promise<SerenaBootstrapResult | undefined> {
  const directories = [
    paths.root,
    paths.uvInstallDir,
    paths.uvToolsDir,
    paths.binDir,
    paths.pythonDir,
    paths.pythonBinDir,
    paths.cacheDir,
  ] as const;
  let mutationStarted = false;
  for (const directory of directories) {
    const before = checkCancellation(signal, stage, mutationStarted);
    if (before) return before;
    try {
      mutationStarted = true;
      await effects.ensureDirectory(directory, signal);
    } catch {
      return failed(stage, "storage-unavailable");
    }
    const after = checkCancellation(signal, stage, mutationStarted);
    if (after) return after;
  }
  return undefined;
}

async function fetchInstaller(
  effects: SerenaBootstrapEffects,
  signal: AbortSignal,
  mutationStarted = false,
): Promise<Uint8Array | SerenaBootstrapResult> {
  const before = checkCancellation(signal, "preparing-uv", mutationStarted);
  if (before) return before;
  const response = await callEffect(() =>
    effects.fetchInstaller({
      url: SERENA_UV_INSTALLER_URL,
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: Object.freeze({}),
      maxBytes: SERENA_UV_INSTALLER_MAX_BYTES,
      timeoutMs: SERENA_UV_INSTALLER_TIMEOUT_MS,
      signal,
    }),
  );
  const after = checkCancellation(signal, "preparing-uv", mutationStarted);
  if (after) return after;
  if (!response) return failed("preparing-uv", "fetch-failed");
  if (response.timedOut) return failed("preparing-uv", "response-timeout");
  if (response.redirected || response.status >= 300 && response.status < 400) {
    return failed("preparing-uv", "redirect-rejected");
  }
  if (response.status < 200 || response.status >= 300 || response.ok === false) {
    return failed("preparing-uv", "fetch-failed");
  }
  const bytes = asBytes(response.body);
  if (!bytes) return failed("preparing-uv", "fetch-failed");
  if (bytes.byteLength > SERENA_UV_INSTALLER_MAX_BYTES) {
    return failed("preparing-uv", "response-too-large");
  }
  if (bytes.byteLength === 0) return failed("preparing-uv", "fetch-failed");
  return bytes;
}

async function runBootstrapAfterRoot(
  request: SerenaBootstrapRequest,
  effects: SerenaBootstrapEffects,
  paths: OwnedPaths,
  signal: AbortSignal,
  candidatePath: string,
): Promise<SerenaBootstrapResult> {
  const initialReadiness = await readSerenaReadiness(
    effects,
    paths,
    candidatePath,
    signal,
    request,
    "existing-deck-tool",
  );
  if (initialReadiness.kind === "terminal") return initialReadiness.result;
  if (initialReadiness.kind === "ready") return { outcome: "reused", evidence: initialReadiness.evidence };

  const preparingCancellation = checkCancellation(signal, "preparing-uv", false);
  if (preparingCancellation) return preparingCancellation;
  emitStage(request, "preparing-uv");
  const uvReadiness = await readUvReadiness(effects, paths, signal, "preparing-uv");
  if (typeof uvReadiness !== "string") return uvReadiness;

  if (uvReadiness === "missing") {
    if (effects.supportsControlledBootstrap) {
      const beforeSupportCheck = checkCancellation(signal, "preparing-uv", false);
      if (beforeSupportCheck) return beforeSupportCheck;
      const supported = await callEffect(() => effects.supportsControlledBootstrap!());
      const afterSupportCheck = checkCancellation(signal, "preparing-uv", false);
      if (afterSupportCheck) return afterSupportCheck;
      if (supported !== true) return failed("preparing-uv", "unsupported-bootstrap");
    }
    const directoryResult = await ensureOwnedDirectories(effects, paths, signal, "preparing-uv");
    if (directoryResult) return directoryResult;

    const installerBytes = await fetchInstaller(effects, signal, true);
    if (!(installerBytes instanceof Uint8Array)) return installerBytes;

    const processStep = await runControlledProcess(
      effects,
      {
        executable: SERENA_UV_INSTALLER_EXECUTABLE,
        args: SERENA_UV_INSTALLER_ARGS,
        env: installerEnvironment(paths),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        stdin: installerBytes,
        timeoutMs: SERENA_UV_INSTALLER_TIMEOUT_MS,
        signal,
      },
      "preparing-uv",
      true,
    );
    if (processStep.kind === "terminal") return processStep.result;
    if (!processSucceeded(processStep.result)) return failed("preparing-uv", "installer-failed");

    const installedUv = await readUvReadiness(effects, paths, signal, "preparing-uv", true);
    if (typeof installedUv !== "string" || installedUv !== "ready") {
      return typeof installedUv === "string" ? failed("preparing-uv", "uv-not-ready") : installedUv;
    }
  }

  const installCancellation = checkCancellation(signal, "installing-serena", true);
  if (installCancellation) return installCancellation;
  emitStage(request, "installing-serena");
  const installStep = await runControlledProcess(
    effects,
    {
      executable: paths.uvPath,
      args: SERENA_INSTALL_ARGS,
      env: serenaEnvironment(paths),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      timeoutMs: SERENA_CHILD_TIMEOUT_MS,
      signal,
    },
    "installing-serena",
    true,
  );
  if (installStep.kind === "terminal") return installStep.result;
  if (!processSucceeded(installStep.result)) return failed("installing-serena", "serena-install-failed");

  const readiness = await readSerenaReadiness(
    effects,
    paths,
    paths.serenaPath,
    signal,
    request,
    "installed-deck-tool",
    true,
  );
  if (readiness.kind === "terminal") return readiness.result;
  if (readiness.kind === "missing") return failed("validating-serena", "serena-not-ready");
  return { outcome: "installed", evidence: readiness.evidence };
}

function waitForSharedResult(
  promise: Promise<SerenaBootstrapResult>,
  signal: AbortSignal,
): Promise<SerenaBootstrapResult> {
  if (signal.aborted) return Promise.resolve(cancelled("preparing-uv", false));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SerenaBootstrapResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish(cancelled("preparing-uv", false));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(finish, () => finish(failed("preparing-uv", "process-failed")));
  });
}

type SerenaOwnedRootResolution =
  | Readonly<{ ok: true; ownedRoot: string }>
  | Readonly<{ ok: false; result: SerenaBootstrapResult }>;

async function resolveSerenaOwnedRootForOperation(
  effects: SerenaBootstrapEffects,
  signal: AbortSignal,
): Promise<SerenaOwnedRootResolution> {
  const beforeEffects = checkCancellation(signal, "preparing-uv", false);
  if (beforeEffects) return { ok: false, result: beforeEffects };

  const dataRootRaw = await callEffect(() => effects.resolveDeckDataRoot());
  const afterDataRoot = checkCancellation(signal, "preparing-uv", false);
  if (afterDataRoot) return { ok: false, result: afterDataRoot };
  if (dataRootRaw === undefined) return { ok: false, result: failed("preparing-uv", "root-invalid") };

  const beforeDataRootCanonicalize = checkCancellation(signal, "preparing-uv", false);
  if (beforeDataRootCanonicalize) return { ok: false, result: beforeDataRootCanonicalize };
  const dataRootCanonicalRaw = await callEffect(() => effects.canonicalizePath(dataRootRaw));
  const afterDataRootCanonicalize = checkCancellation(signal, "preparing-uv", false);
  if (afterDataRootCanonicalize) return { ok: false, result: afterDataRootCanonicalize };
  const dataRoot = validateRoot(dataRootCanonicalRaw);
  if (!dataRoot) return { ok: false, result: failed("preparing-uv", "root-invalid") };

  const beforeOwnedRootCanonicalize = checkCancellation(signal, "preparing-uv", false);
  if (beforeOwnedRootCanonicalize) return { ok: false, result: beforeOwnedRootCanonicalize };
  const ownedRootRaw = await callEffect(() => effects.canonicalizePath(joinOwnedPath(dataRoot, "tools", "serena")));
  const afterOwnedRootCanonicalize = checkCancellation(signal, "preparing-uv", false);
  if (afterOwnedRootCanonicalize) return { ok: false, result: afterOwnedRootCanonicalize };
  const ownedRoot = normalizedAbsolutePath(ownedRootRaw);
  if (!ownedRoot || !isContained(ownedRoot, dataRoot)) {
    return { ok: false, result: failed("preparing-uv", "root-invalid") };
  }

  if (effects.isUserOwnedPath) {
    const beforeOwnedDataRootCheck = checkCancellation(signal, "preparing-uv", false);
    if (beforeOwnedDataRootCheck) return { ok: false, result: beforeOwnedDataRootCheck };
    const owned = await callEffect(() => effects.isUserOwnedPath!(dataRoot));
    const afterOwnedDataRootCheck = checkCancellation(signal, "preparing-uv", false);
    if (afterOwnedDataRootCheck) return { ok: false, result: afterOwnedDataRootCheck };

    const beforeOwnedSerenaRootCheck = checkCancellation(signal, "preparing-uv", false);
    if (beforeOwnedSerenaRootCheck) return { ok: false, result: beforeOwnedSerenaRootCheck };
    const serenaOwned = await callEffect(() => effects.isUserOwnedPath!(ownedRoot));
    const afterOwnedSerenaRootCheck = checkCancellation(signal, "preparing-uv", false);
    if (afterOwnedSerenaRootCheck) return { ok: false, result: afterOwnedSerenaRootCheck };
    if (owned !== true || serenaOwned !== true) {
      return { ok: false, result: failed("preparing-uv", "root-invalid") };
    }
  }

  return { ok: true, ownedRoot };
}

/** Resolve the exact Deck-owned Serena root without creating directories or starting processes. */
export async function resolveSerenaOwnedRoot(
  effects: SerenaBootstrapEffects = defaultSerenaBootstrapEffects,
  signal: AbortSignal = new AbortController().signal,
): Promise<string | undefined> {
  const resolution = await resolveSerenaOwnedRootForOperation(effects, signal);
  return resolution.ok ? resolution.ownedRoot : undefined;
}

/** Build the immediate same-path/fingerprint verifier used before an MCP writer. */
export function createSerenaReadinessRevalidator(
  ownedRoot: string,
  effects: SerenaBootstrapEffects = defaultSerenaBootstrapEffects,
): SerenaReadinessRevalidator {
  return async (evidence) => {
    const initial = validateSerenaReadinessEvidence(evidence, ownedRoot);
    if (!initial.valid) return initial;
    const root = normalizedAbsolutePath(ownedRoot);
    if (!root) return initial;

    const stale = (): SerenaReadinessValidationResult => ({
      valid: false,
      code: "stale-readiness-evidence",
      diagnostic: safeDiagnostic("stale-readiness-evidence"),
    });
    const signal = new AbortController().signal;
    const executablePath = initial.evidence.resolvedExecutablePath;
    const paths = makeOwnedPaths(root);

    const inspection = await callEffect(() => effects.inspectPath(executablePath, signal, root));
    if (
      !inspection
      || !pathInspectionIsUsable(executablePath, inspection)
      || inspection.fingerprint !== initial.evidence.fingerprint
    ) return stale();

    const probeResult = await callEffect(() => effects.probeExecutable({
      executablePath,
      ownedRoot: root,
      args: SERENA_HELP_ARGS,
      env: serenaEnvironment(paths),
      shell: false,
      timeoutMs: SERENA_CHILD_TIMEOUT_MS,
      signal,
    }));
    if (
      !probeResult
      || probeResult.state !== "ready"
      || normalizedAbsolutePath(probeResult.resolvedPath ?? executablePath) !== executablePath
      || probeResult.fingerprint !== undefined && probeResult.fingerprint !== initial.evidence.fingerprint
    ) return stale();

    const confirmation = await callEffect(() => effects.inspectPath(executablePath, signal, root));
    if (
      !confirmation
      || !pathInspectionIsUsable(executablePath, confirmation)
      || confirmation.fingerprint !== initial.evidence.fingerprint
    ) return stale();

    return initial;
  };
}

/**
 * Execute the current operation's shared Serena flow using only injected
 * effects. No writer is called here; adapters consume the typed evidence and
 * perform their own immediate revalidation before configuration.
 */
export async function bootstrapSerena(
  request: SerenaBootstrapRequest,
  suppliedEffects?: SerenaBootstrapEffects,
): Promise<SerenaBootstrapResult> {
  const currentOperation: Partial<SerenaOperationIdentity> | undefined = request.currentOperation ?? request.operation ??
    (request.runner !== undefined || request.operationId !== undefined
      ? {
          runner: request.runner,
          operationId: request.operationId,
          explicitlySelected: true,
        }
      : undefined);
  const authorization = validateSerenaOperationAuthorization(request.authorization, currentOperation);
  if (!authorization.valid) return failed(stageForAuthorization(), "authorization-invalid");

  const effects = suppliedEffects ?? request.effects ?? defaultSerenaBootstrapEffects;
  const signal = request.signal ?? new AbortController().signal;
  const rootResolution = await resolveSerenaOwnedRootForOperation(effects, signal);
  if (!rootResolution.ok) return rootResolution.result;
  const ownedRoot = rootResolution.ownedRoot;

  const paths = makeOwnedPaths(ownedRoot);
  let candidatePath = paths.serenaPath;
  if (request.existingSerenaExecutablePath !== undefined) {
    if (!normalizedAbsolutePath(request.existingSerenaExecutablePath)) {
      return failed("preparing-uv", "path-invalid");
    }
    const beforeCandidateCanonicalize = checkCancellation(signal, "preparing-uv", false);
    if (beforeCandidateCanonicalize) return beforeCandidateCanonicalize;
    const candidateCanonicalRaw = await callEffect(() =>
      effects.canonicalizePath(request.existingSerenaExecutablePath!),
    );
    const afterCandidateCanonicalize = checkCancellation(signal, "preparing-uv", false);
    if (afterCandidateCanonicalize) return afterCandidateCanonicalize;
    const candidateCanonical = normalizedAbsolutePath(candidateCanonicalRaw);
    if (!candidateCanonical || !isContained(candidateCanonical, ownedRoot)) {
      return failed("preparing-uv", "path-invalid");
    }
    candidatePath = candidateCanonical;
  }

  const shared = inFlightByRoot.get(ownedRoot);
  if (shared) return waitForSharedResult(shared, signal);

  const operation = runBootstrapAfterRoot(request, effects, paths, signal, candidatePath);
  inFlightByRoot.set(ownedRoot, operation);
  try {
    return await operation;
  } finally {
    if (inFlightByRoot.get(ownedRoot) === operation) inFlightByRoot.delete(ownedRoot);
  }
}

export function createSerenaBootstrapService(
  effects: SerenaBootstrapEffects = defaultSerenaBootstrapEffects,
): SerenaBootstrapService {
  return Object.freeze({
    bootstrapSerena: (request: SerenaBootstrapRequest) => bootstrapSerena(request, effects),
  });
}
