import { mkdir, open, lstat, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve, relative, dirname, parse, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSupermemoryConversationContent } from "../../packages/adapter-supermemory/src/conversation.ts";
import { evaluateAdaptiveMemoryCaptureEligibility } from "../../packages/core/src/memory/capture-eligibility.ts";
import { redactText } from "../../packages/core/src/session/redaction.ts";

export const BASE_URL = "https://api.supermemory.ai";
export const TARGET_NAMESPACE = "sm_project_v1_kevin15011_deck";
const ENDPOINTS = new Set(["GET /namespaces", "GET /ns", "GET /ns/{namespace}", "POST /ns/{namespace}/list/documents", "POST /ns/{namespace}/list/memories", "GET /ns/{namespace}/document/{id}", "GET /ns/{namespace}/profile/buckets", "POST /ns/{namespace}/profile"]);
const HOME = homedir();
const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
function isSecretName(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
  return ["apikey", "accesskey", "token", "accesstoken", "refreshtoken", "authtoken", "secret", "secretkey", "apisecret", "clientsecret", "awssecretaccesskey", "password", "passwd", "authorization", "proxyauthorization", "credential", "privatekey", "cookie", "sessionid", "dsn"].some((name) => normalized === name || normalized.endsWith(name));
}
const TOKEN_PATTERNS = [
  /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[a-zA-Z]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}|npm_[A-Za-z0-9]{20,}|sm_(?!project_v1_)[A-Za-z0-9_-]{12,})\b/g,
  /\bAuthorization\s*:\s*token\s+[^\s,;}]+/gi,
  /(^|\s)--password\s+[^\s]+/gim,
  /\b(credential|private[_-]?key)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
  /\b(credential|private[_-]?key)\s+([^\s,;]+)/gi,
  /\\+["']?(?:apiKey|api_key|token|secret|password|passwd|authorization|credential|private_key)\\+["']?\s*:\s*\\+["'][^\\"']+\\+["']/gi,
];

export function assertAllowedRequest(method: string, path: string): { template: string; url: URL } {
  let url: URL;
  try { url = new URL(path, BASE_URL); } catch { throw new Error("Request rejected by inventory endpoint allowlist."); }
  if (method !== method.toUpperCase() || !["http:", "https:"].includes(url.protocol) || url.origin !== BASE_URL || url.username || url.password || url.hash || path.includes("#")) throw new Error("Request rejected by inventory endpoint allowlist.");
  const pathname = url.pathname;
  let template = pathname;
  const docMatch = pathname.match(/^\/ns\/([^/]+)\/document\/([^/]+)$/);
  if (docMatch) {
    const namespace = decodeSafe(docMatch[1]); const id = decodeSafe(docMatch[2]);
    if (namespace !== TARGET_NAMESPACE || !/^[A-Za-z0-9_:.-]+$/.test(id) || id.includes("..") || id === "." || id === "..") throw new Error("Request rejected by inventory endpoint allowlist.");
    template = "/ns/{namespace}/document/{id}";
  } else if (pathname === `/ns/${TARGET_NAMESPACE}/`) throw new Error("Request rejected by inventory endpoint allowlist.");
  else if (pathname === `/ns/${TARGET_NAMESPACE}`) template = "/ns/{namespace}";
  else if (pathname.startsWith("/ns/")) {
    const rest = pathname.slice(4).split("/");
    const namespace = decodeSafe(rest[0] ?? "");
    if (namespace !== TARGET_NAMESPACE) throw new Error("Request rejected by inventory endpoint allowlist.");
    template = `/ns/{namespace}${rest.length > 1 ? `/${rest.slice(1).join("/")}` : ""}`;
  }
  if (!ENDPOINTS.has(`${method} ${template}`)) throw new Error("Request rejected by inventory endpoint allowlist.");
  const allowed = template === "/namespaces" || template === "/ns" ? new Set(["page", "limit"])
    : template === "/ns/{namespace}/list/documents" || template === "/ns/{namespace}/list/memories" ? new Set(["page", "limit", "sort", "order"])
    : template === "/ns/{namespace}/document/{id}" ? new Set(["include"]) : new Set<string>();
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error("Request rejected by inventory endpoint allowlist.");
  return { template, url };
}
function decodeSafe(value: string): string { try { return decodeURIComponent(value); } catch { throw new Error("Request rejected by inventory endpoint allowlist."); } }
function isSafeDocumentId(value: unknown): value is string { return typeof value === "string" && value !== "." && /^[A-Za-z0-9_:.-]+$/.test(value) && !value.includes(".."); }

export type InventoryOptions = { fetchImpl?: typeof fetch; maxRequests?: number; delayMs?: number; retries?: number; outputRoot?: string; now?: Date; sessions?: string[]; windowStart?: string; windowEnd?: string; dryRun?: boolean; live?: boolean };
type RequestEntry = { method: string; path: string; status: number; latencyMs: number; responseBytes: number; attempt: number };
type Redaction = { value: unknown; count: number };

export function scrub(value: unknown, secrets: readonly string[] = []): string {
  let text = String(value ?? "");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED_CREDENTIAL]");
  return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]").replace(/(?:\/home\/|\/Users\/)[^\s"'<>]+/g, "[REDACTED_PATH]");
}

export function redactDeep(input: unknown, secrets: readonly string[] = []): Redaction {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const adapter = redactSupermemoryConversationContent(v);
      const core = redactText(adapter.content, 256 * 1024);
      let out = core;
      count += adapter.diagnostics.length + (core !== adapter.content ? 1 : 0);
      for (const pattern of TOKEN_PATTERNS) { pattern.lastIndex = 0; out = out.replace(pattern, () => { count++; return "[REDACTED_TOKEN]"; }); }
      if (evaluateAdaptiveMemoryCaptureEligibility({ source: "explicit-remember", content: out }).reason === "secret_detected") {
        const before = out;
        out = out.replace(/((?:password|passphrase|secret|api[_-]?key|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?id|session|cookie|dsn|private[_-]?key|database[_-]?uri|[a-z0-9_]+[_-]uri)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;"'{}\[\]]+)/gi, "$1[REDACTED_SECRET]");
        if (out !== before) count++;
      }
      out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => { count++; return "[REDACTED_EMAIL]"; });
      out = out.replace(/(?:\/home\/|\/Users\/)[^\s"'<>]+/g, () => { count++; return "[REDACTED_PATH]"; });
      for (const secret of secrets) if (secret && out.includes(secret)) { out = out.split(secret).join("[REDACTED_CREDENTIAL]"); count++; }
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), isSecretName(k) ? (count++, "[REDACTED_SECRET]") : walk(x)]));
    return v;
  };
  return { value: walk(input), count };
}

export function classifyNamespace(name: string): string {
  if (/^sm_project_v1_/.test(name)) return "sm_project_v1_*";
  if (/^repo_.+__[0-9a-f]{16}$/i.test(name)) return "repo_*__<16hex>";
  if (/^deck_eval_/.test(name)) return "deck_eval_*";
  for (const prefix of ["user_project_", "claudecode_project_", "codex_project_", "opencode_project_"]) if (name.startsWith(prefix)) return prefix.replace(/_$/, "_*");
  if (/_user_/.test(name)) return "*_user_*";
  return "other";
}

export function classifyId(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return "session UUID";
  if (/^codex_/.test(id)) return "codex_*";
  if (/^opencode:capture:/.test(id)) return "opencode:capture:*";
  if (/^deck_conversation_/.test(id)) return "deck_conversation_*";
  return "other";
}

function sourceOf(r: any): string {
  const m = r?.metadata ?? {};
  const s = m.sm_source ?? m.sm_client ?? m.source ?? m.client;
  if (typeof s === "string" && /claude-code/i.test(s)) return "claude-code";
  if (typeof s === "string" && /codex/i.test(s)) return "codex";
  if (typeof s === "string" && /opencode/i.test(s)) return "opencode";
  if (/^deck_conversation_/.test(String(r?.id ?? r?.customId ?? ""))) return "Deck runtime";
  return "unknown";
}

export function matchesSession(r: any, ids: Set<string>, start: number, end: number): boolean {
  const date = Date.parse(r?.system?.createdAt ?? r?.createdAt ?? "");
  return Number.isFinite(date) && Number.isFinite(start) && Number.isFinite(end) && date >= start && date <= end && matchingSessionIds(r, ids).length > 0;
}

export function matchingSessionIds(r: any, ids: Set<string>): string[] {
  return [...new Set(matchingSessionAttributions(r, ids).map((match) => match.sessionId))];
}

export function matchingSessionAttributions(r: any, ids: Set<string>): Array<{ sessionId: string; matchReason: string }> {
  const m = r?.metadata ?? {};
  const result: Array<{ sessionId: string; matchReason: string }> = [];
  const content = String(r?.content ?? r?.memory ?? "");
  for (const sessionId of ids) {
    if ([r?.id, r?.customId].includes(sessionId)) result.push({ sessionId, matchReason: "id/customId" });
    if (m.sessionId === sessionId) result.push({ sessionId, matchReason: "metadata.sessionId" });
    if (content.includes(`[Session ${sessionId}]`)) result.push({ sessionId, matchReason: "content header" });
  }
  return result;
}

export function validateRequestCap(value?: number): number {
  if (value === undefined) return 1500;
  if (!Number.isInteger(value) || value < 1 || value > 1500) throw new Error("--max-requests must be a positive integer no greater than 1500.");
  return value;
}
export { printSafe };

function validTotalPages(value: unknown, current: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 10000) return current;
  return Math.floor(value);
}

function histogram<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce((counts, item) => { const name = key(item); counts[name] = (counts[name] ?? 0) + 1; return counts; }, {} as Record<string, number>);
}

function residualCategories(text: string, secrets: readonly string[]): string[] {
  const categories = new Set<string>();
  if (secrets.some((secret) => Boolean(secret) && text.includes(secret))) categories.add("credential_value");
  const patterns: Array<[string, RegExp]> = [
    ["token_prefix", /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[a-zA-Z]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}|npm_[A-Za-z0-9]{20,}|sm_(?!project_v1_)[A-Za-z0-9_-]{12,})\b/g],
    ["authorization", /\b(?:Bearer|Basic)\s+(?!\[REDACTED)[^\s",;}]+/gi],
    ["secret_assignment", /\b(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|authorization|credential|private[_-]?key)\s*[:=]\s*(?!\[REDACTED)["']?[^\s,"';}]+/gi],
    ["private_key_material", /\bMIIE[A-Za-z0-9+/=]{30,}/g],
  ];
  for (const [category, pattern] of patterns) { pattern.lastIndex = 0; if (pattern.test(text)) categories.add(category); }
  return [...categories];
}

function residualCount(text: string, secrets: readonly string[]): number {
  return residualCategories(text, secrets).length;
}

function hashId(id: unknown): string {
  return createHash("sha256").update(String(id ?? ""), "utf8").digest("hex");
}

function safeRecord(record: any, secrets: readonly string[], extraSuspicion: string[] = []) {
  const safe = redactDeep(record, secrets);
  const serialized = JSON.stringify(safe.value);
  const suspicion = [...new Set([...extraSuspicion, ...residualCategories(serialized, secrets)])];
  if (!suspicion.length) return { value: safe.value, redactions: safe.count, quarantined: false as const };
  const bytes = new TextEncoder().encode(JSON.stringify(record)).length;
  return {
    value: { idHash: hashId(record?.id ?? record?.customId), counts: { fields: record && typeof record === "object" ? Object.keys(record).length : 0, records: 1 }, sizeBytes: bytes, suspicionFlag: suspicion },
    redactions: safe.count,
    quarantined: true as const,
    suspicion,
  };
}

function internalDocumentLinks(record: any): string[] {
  const m = record?.metadata ?? {};
  return [record?.documentId, record?.parentDocumentId, record?.document?.id, record?.parentDocument?.id, m.documentId, m.parentDocumentId]
    .filter((value): value is string => typeof value === "string");
}

function exposureEntry(record: any, hit: { sessionId: string; matchReason: string }, recordKind: string, date: number, start: number, end: number, safeById: Map<string, any>, secrets: readonly string[]) {
  const safe = safeById.get(String(record?.id ?? record?.customId ?? ""));
  const quarantined = Boolean(safe?.suspicionFlag);
  return {
    id: quarantined ? safe.idHash : redactDeep(record?.id ?? record?.customId ?? null, secrets).value,
    matchedSession: redactDeep(hit.sessionId, secrets).value,
    matchReason: hit.matchReason,
    source: sourceOf(record),
    createdAt: redactDeep(record?.system?.createdAt ?? record?.createdAt ?? null, secrets).value,
    size: new TextEncoder().encode(String(record?.content ?? record?.memory ?? "")).length,
    inWindow: Number.isFinite(date) && Number.isFinite(start) && Number.isFinite(end) && date >= start && date <= end,
    recordKind,
  };
}

function sanitizeProfile(raw: any, secrets: readonly string[], categories: Record<string, number>) {
  let quarantined = 0; let redactions = 0;
  const sanitizeItems = (items: any[]) => (items ?? []).map((item) => {
    const record = safeRecord(item, secrets);
    redactions += record.redactions;
    if (record.quarantined) { quarantined++; for (const c of record.suspicion) categories[c] = (categories[c] ?? 0) + 1; }
    return record.value;
  });
  const profile = raw?.profile ?? {};
  const buckets: Record<string, any[]> = {};
  for (const [name, items] of Object.entries(profile.buckets ?? {})) buckets[String(redactDeep(name, secrets).value)] = sanitizeItems(items as any[]);
  return { value: { profile: { static: sanitizeItems(profile.static), dynamic: sanitizeItems(profile.dynamic), buckets } }, quarantined, redactions };
}

function sanitizeBuckets(raw: any, secrets: readonly string[], categories: Record<string, number>) {
  let quarantined = 0; let redactions = 0;
  const buckets: Record<string, any> = {};
  for (const [name, description] of Object.entries(raw?.buckets ?? {})) {
    const record = safeRecord({ id: name, description }, secrets);
    redactions += record.redactions;
    if (record.quarantined) { quarantined++; for (const c of record.suspicion) categories[c] = (categories[c] ?? 0) + 1; }
    buckets[String(redactDeep(name, secrets).value)] = record.value;
  }
  return { value: { buckets }, quarantined, redactions };
}

function serializeSafe(value: unknown, secrets: readonly string[]): string {
  const sanitized = redactDeep(value, secrets).value;
  const serialized = JSON.stringify(sanitized, null, 2);
  const residuals = residualCount(serialized, secrets);
  if (residuals) throw new Error(`Output refused: residual secret patterns detected (count=${residuals}).`);
  return serialized;
}

function printSafe(value: unknown, secrets: readonly string[]) {
  try { console.log(serializeSafe(value, secrets)); }
  catch (error) { if (error instanceof Error && /residual secret patterns/.test(error.message)) throw error; throw new Error("Output refused: residual secret patterns detected (count=1)."); }
}

export async function readKey(filePath = process.env.SUPERMEMORY_INVENTORY_API_KEY_FILE): Promise<string> {
  if (!filePath) throw new Error("SUPERMEMORY_INVENTORY_API_KEY_FILE must name a protected credential file.");
  const path = resolve(filePath);
  let info;
  try { info = await lstat(path); } catch { throw new Error("Credential file is unavailable."); }
  if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error("Credential file must be a regular, non-symlink file with mode 0600.");
  let parent;
  try { parent = await lstat(dirname(path)); } catch { throw new Error("Credential parent directory is unavailable."); }
  if (parent.isSymbolicLink() || !parent.isDirectory() || (parent.mode & 0o777) !== 0o700) throw new Error("Credential parent directory must be a non-symlink directory with mode 0700.");
  let handle;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const key = (await handle.readFile("utf8")).trim(); if (!key) throw new Error("empty"); return key; }
  catch { throw new Error("Credential file could not be read or is empty."); }
  finally { await handle?.close(); }
}

export async function runInventory(options: InventoryOptions = {}) {
  const key = await readKey();
  const secrets = [key];
  const cap = validateRequestCap(options.maxRequests);
  const realHome = await realpath(HOME);
  const canonicalInventory = resolve(realHome, ".deck-eval/inventory");
  const outputRoot = resolve(options.outputRoot ?? canonicalInventory);
  await verifyOutputRoot(outputRoot);
  if (options.dryRun) {
    const report = { mode: "offline preflight", outputRoot: "~/.deck-eval/inventory", requestCap: cap, allowlist: [...ENDPOINTS] };
    printSafe(report, secrets);
    return { preflight: true, report };
  }
  if (!options.live) throw new Error("Use --dry-run for offline preflight or --live to permit read-only API calls.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = Math.max(100, options.delayMs ?? 350);
  const retries = Math.max(0, Math.min(3, options.retries ?? 2));
  const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputDir = resolve(outputRoot, stamp);
  await secureOutput(outputRoot, outputDir);
  const log: RequestEntry[] = [];
  let operations = 0;
  const namespaces: any[] = [];
  const documents: any[] = [];
  const memories: any[] = [];
  const documentDetails: any[] = [];
  const invalidDocumentRecords: any[] = [];
  let invalidDocumentIds = 0;
  let failureReported = false;
  const reportFailure = async (error: unknown) => {
    if (failureReported) return;
    failureReported = true;
    const report = { failure: scrub(error instanceof Error ? error.message : "inventory failed", secrets), operations: log.length, endpoints: histogram(log, (e) => `${e.method} ${e.path}`), statuses: histogram(log, (e) => String(e.status)), partialCounts: { namespaces: namespaces.length, documents: documents.length, memories: memories.length, documentDetails: documentDetails.length } };
    await writeJson(resolve(outputDir, "partial-summary.json"), report, secrets);
    await writeJson(resolve(outputDir, "request-log.partial.json"), log, secrets);
    printSafe(report, secrets);
  };
  const request = async (method: string, path: string, query = "", body?: unknown): Promise<any> => {
    const { template, url } = assertAllowedRequest(method, `${path}${query}`);
    if (operations >= cap) { const error = new Error("Inventory request cap reached."); await reportFailure(error); throw error; }
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (operations >= cap) { const error = new Error("Inventory request cap reached."); await reportFailure(error); throw error; }
      operations++;
      if (attempt > 1 || log.length > 0) await new Promise((r) => setTimeout(r, delayMs));
      const started = Date.now();
      let responseLogged = false;
      try {
        const response = await fetchImpl(url, { method, redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text();
        log.push({ method, path: template, status: response.status, latencyMs: Date.now() - started, responseBytes: new TextEncoder().encode(text).length, attempt });
        responseLogged = true;
        if ((response.status === 429 || response.status >= 500) && attempt <= retries) {
          const retry = Number(response.headers.get("retry-after"));
          await new Promise((r) => setTimeout(r, Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 5000) : delayMs)); continue;
        }
        if (!response.ok) throw new Error(`Inventory request failed with status ${response.status}.`);
        try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`non-JSON response (${new TextEncoder().encode(text).length} bytes)`); }
      } catch (e) { lastError = e; if (!responseLogged) log.push({ method, path: template, status: 0, latencyMs: Date.now() - started, responseBytes: 0, attempt }); if (e instanceof Error && (/status \d+/.test(e.message) || /^non-JSON response/.test(e.message))) { await reportFailure(e); throw e; } if (attempt > retries) break; }
    }
    const error = new Error(`Inventory request failed: ${scrub(lastError, secrets)}`); await reportFailure(error); throw error;
  };

  let p = 1;
  while (true) { const result = await request("GET", "/namespaces", `?page=${p}&limit=100`); const page = result.namespaces ?? []; if (page.length === 0) break; namespaces.push(...page); if (p >= validTotalPages(result.pagination?.totalPages, p)) break; p++; }
  const targetCount = namespaces.find((n) => n.namespace === TARGET_NAMESPACE)?.documentCount;
  printSafe({ expectedRequests: `approximately ${Number.isFinite(targetCount) ? targetCount : "unknown"} document GETs + fixed overhead`, documentCount: Number.isFinite(targetCount) ? targetCount : "unknown" }, secrets);
  for (const type of ["documents", "memories"] as const) {
    const collection = type === "documents" ? documents : memories;
    p = 1;
    while (true) { const result = await request("POST", `/ns/${TARGET_NAMESPACE}/list/${type}`, `?page=${p}&limit=100&sort=createdAt&order=asc`, { include: { forgotten: true, memoryCount: true } }); const page = result[type] ?? []; if (page.length === 0) break; collection.push(...page); if (p >= validTotalPages(result.pagination?.totalPages, p)) break; p++; }
  }
  for (const d of documents) {
    if (!isSafeDocumentId(d.id)) {
      invalidDocumentIds++;
      invalidDocumentRecords.push({ idHash: hashId(d.id), counts: { documents: 1, fields: d && typeof d === "object" ? Object.keys(d).length : 0 }, sizeBytes: new TextEncoder().encode(JSON.stringify(d)).length, suspicionFlag: ["invalid_document_id"] });
      continue;
    }
    try {
      const detail = await request("GET", `/ns/${TARGET_NAMESPACE}/document/${encodeURIComponent(d.id)}`, "?include=memories");
      documentDetails.push({ ...detail, id: detail.id ?? d.id, customId: detail.customId ?? d.customId, metadata: { ...(d.metadata ?? {}), ...(detail.metadata ?? {}) }, type: detail.type ?? d.type, system: { ...(d.system ?? {}), ...(detail.system ?? {}) } });
    } catch (error) {
      if (error instanceof Error && /allowlist/.test(error.message)) {
        invalidDocumentIds++;
        invalidDocumentRecords.push({ idHash: hashId(d.id), counts: { documents: 1, fields: Object.keys(d).length }, sizeBytes: new TextEncoder().encode(JSON.stringify(d)).length, suspicionFlag: ["request_guard_rejected"] });
        await reportFailure(error);
        continue;
      }
      throw error;
    }
  }
  const buckets = await request("GET", `/ns/${TARGET_NAMESPACE}/profile/buckets`);
  const profile = await request("POST", `/ns/${TARGET_NAMESPACE}/profile`, "", {});
  const start = Date.parse(options.windowStart ?? "2026-10-21T00:00:00Z");
  const end = Date.parse(options.windowEnd ?? (options.now ?? new Date()).toISOString());
  const ids = new Set(options.sessions ?? ["78139695-03a1-4ce3-816d-d522df8dd928", "01a15ee3-9102-7983-b153-b630205c3086", "01a15ee2-8e87-7101-8795-b783e01276a3", "01a15ee2-3e9e-7143-be56-3ca98bffa5b2", "01a15ee2-cce7-7c13-a997-b749d73250ff"]);
  const sources: Record<string, number> = {}; const types: Record<string, number> = {}; const captureModes: Record<string, number> = {}; const days: Record<string, number> = {}; const idFormats: Record<string, number> = {};
  const quarantinePatterns: Record<string, number> = {};
  let quarantinedRecords = invalidDocumentRecords.length; let redactions = 0; let secretLike = 0;
  if (invalidDocumentRecords.length) quarantinePatterns.invalid_document_id = invalidDocumentRecords.length;
  const persistRecords: Record<string, any>[] = [...invalidDocumentRecords];
  const safeRecordById = new Map<string, any>();
  for (const r of [...documentDetails, ...memories]) {
    const isMemory = memories.includes(r);
    const plain = JSON.stringify(r);
    if (!isMemory && evaluateAdaptiveMemoryCaptureEligibility({ source: "explicit-remember", content: plain }).reason === "secret_detected") secretLike++;
    const safe = safeRecord(r, secrets, []);
    redactions += safe.redactions;
    if (safe.quarantined) {
      quarantinedRecords++;
      for (const pattern of safe.suspicion) quarantinePatterns[pattern] = (quarantinePatterns[pattern] ?? 0) + 1;
      persistRecords.push(safe.value);
      safeRecordById.set(String(r.id ?? r.customId ?? ""), safe.value);
      continue;
    }
    const kind = isMemory ? "memory" : "document";
    persistRecords.push({ kind, record: safe.value });
    safeRecordById.set(String(r.id ?? r.customId ?? ""), safe.value);
    const source = sourceOf(r); sources[source] = (sources[source] ?? 0) + 1;
    const type = String(r.type ?? r.taskType ?? "unknown"); types[type] = (types[type] ?? 0) + 1;
    const captureMode = String(r.metadata?.sm_capture_mode ?? r.metadata?.captureMode ?? "unknown"); captureModes[captureMode] = (captureModes[captureMode] ?? 0) + 1;
    const created = r.system?.createdAt ?? r.createdAt;
    if (typeof created === "string" && Number.isFinite(Date.parse(created))) { const day = created.slice(0, 10); days[day] = (days[day] ?? 0) + 1; }
    const idClass = classifyId(String(r.id ?? r.customId ?? "")); idFormats[idClass] = (idFormats[idClass] ?? 0) + 1;
  }
  const exposure: any[] = [];
  let unusableDates = 0;
  const matchedDocuments = new Map<string, Array<{ sessionId: string; matchReason: string }>>();
  for (const record of documentDetails) {
    const created = record.system?.createdAt ?? record.createdAt;
    const date = Date.parse(created ?? "");
    if (!Number.isFinite(date)) unusableDates++;
    const hits = matchingSessionAttributions(record, ids);
    if (hits.length && typeof record.id === "string") matchedDocuments.set(record.id, hits);
    for (const hit of hits) exposure.push(exposureEntry(record, hit, "document", date, start, end, safeRecordById, secrets));
  }
  for (const record of memories) {
    const created = record.system?.createdAt ?? record.createdAt;
    const date = Date.parse(created ?? "");
    if (!Number.isFinite(date)) unusableDates++;
    for (const hit of matchingSessionAttributions(record, ids)) exposure.push(exposureEntry(record, hit, "memory", date, start, end, safeRecordById, secrets));
    for (const link of internalDocumentLinks(record)) {
      for (const parentHit of matchedDocuments.get(link) ?? []) exposure.push(exposureEntry(record, { ...parentHit, matchReason: "internal link" }, "memory", date, start, end, safeRecordById, secrets));
    }
  }
  const safeNamespaces = namespaces.map((n) => safeRecord({ id: n.namespace, documentCount: n.documentCount, memoryCount: n.memoryCount, class: classifyNamespace(n.namespace) }, secrets));
  const namespaceOutput = safeNamespaces.map((r) => {
    redactions += r.redactions;
    if (r.quarantined) { quarantinedRecords++; for (const c of r.suspicion) quarantinePatterns[c] = (quarantinePatterns[c] ?? 0) + 1; return r.value; }
    return r.value;
  });
  const safeBuckets = sanitizeBuckets(buckets, secrets, quarantinePatterns); quarantinedRecords += safeBuckets.quarantined; redactions += safeBuckets.redactions;
  const safeProfile = sanitizeProfile(profile, secrets, quarantinePatterns); quarantinedRecords += safeProfile.quarantined; redactions += safeProfile.redactions;
  const documentOutput = persistRecords.filter((r) => r.kind === "document" || r.suspicionFlag?.includes("invalid_document_id") || r.suspicionFlag?.includes("request_guard_rejected"));
  const summary = { namespace: TARGET_NAMESPACE, counts: { namespaces: namespaces.length, documents: documents.length, memories: memories.length }, invalidDocumentIds, quarantinedRecords, quarantinePatterns, classification: { source: sources, type: types, captureMode: captureModes, createdByDay: days, idFormat: idFormats, accountNamespaceClass: namespaceOutput.reduce((a: any, n: any) => { const key = n.class ?? "quarantined"; return { ...a, [key]: (a[key] ?? 0) + 1 }; }, {}) }, recordsWithUnusableDates: unusableDates, redactionsApplied: redactions, documentsFlaggedSecretLike: secretLike, exposedSessions: exposure, billing: "unknown — not readable with this key" };
  const safeSummary = redactDeep(summary, secrets).value;
  const terminal = { outputDir, operations: log.length, endpoints: histogram(log, (e) => `${e.method} ${e.path}`), statuses: histogram(log, (e) => String(e.status)), summary: safeSummary };
  try {
    await writeJsonl(resolve(outputDir, "documents-memories.jsonl"), persistRecords, secrets);
    await writeJson(resolve(outputDir, "namespaces.json"), namespaceOutput, secrets);
    await writeJson(resolve(outputDir, "profile-buckets.json"), safeBuckets.value, secrets);
    await writeJson(resolve(outputDir, "document-details.json"), documentOutput, secrets);
    await writeJson(resolve(outputDir, "profile.json"), safeProfile.value, secrets);
    await writeJson(resolve(outputDir, "request-log.json"), log, secrets);
    await writeJson(resolve(outputDir, "summary.json"), safeSummary, secrets);
  } catch (error) { await reportFailure(error); throw error; }
  try { printSafe(terminal, secrets); } catch (error) { await reportFailure(error); throw error; }
  return { summary: safeSummary, log, outputDir };
}

async function secureOutput(root: string, dir: string) {
  await verifyOutputRoot(root);
  const repo = await realpath(REPO_ROOT);
  const target = resolve(dir);
  if (target === repo || target.startsWith(`${repo}/`)) throw new Error("Output directory must be outside the repository.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || (rootInfo.mode & 0o777) !== 0o700) throw new Error("Output root must be a non-symlink directory with mode 0700.");
  await mkdir(dir, { mode: 0o700 });
  const info = await lstat(dir); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe output directory.");
}
async function writeJson(path: string, data: unknown, secrets: readonly string[]) { await writeSecure(path, serializeSafe(data, secrets) + "\n", secrets); }
async function writeJsonl(path: string, rows: unknown[], secrets: readonly string[]) { await writeSecure(path, rows.map((r) => serializeSafe(r, secrets)).join("\n") + (rows.length ? "\n" : ""), secrets); }
async function writeSecure(path: string, data: string, secrets: readonly string[]) { const residuals = residualCount(data, secrets); if (residuals) throw new Error(`Output refused: residual secret patterns detected (count=${residuals}).`); const f = await open(path, "wx", 0o600); try { await f.writeFile(data, "utf8"); } finally { await f.close(); } }

async function verifyOutputRoot(root: string) {
  const canonicalDefault = resolve(await realpath(HOME), ".deck-eval/inventory");
  if (root === resolve(`${HOME}/.deck-eval/inventory`) && root !== canonicalDefault) throw new Error("Output root must use the real home directory path.");
  const repo = await realpath(REPO_ROOT);
  const abs = resolve(root);
  if (abs === repo || abs.startsWith(`${repo}/`)) throw new Error("Output directory must be outside the repository.");
  let current = parse(abs).root;
  for (const part of abs.slice(current.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    try { const info = await lstat(current); if (info.isSymbolicLink()) throw new Error("Output path components must not be symlinks."); }
    catch (e) { if (e instanceof Error && /symlinks/.test(e.message)) throw e; break; }
  }
  try { const info = await lstat(abs); if (info.isDirectory() && (info.mode & 0o777) !== 0o700) throw new Error("Output root must have mode 0700."); }
  catch (e) { if (e instanceof Error && /mode 0700/.test(e.message)) throw e; }
  try { const actual = await realpath(abs); if (actual !== abs) throw new Error("Output root must resolve to its canonical path."); }
  catch (e) { if (e instanceof Error && /canonical/.test(e.message)) throw e; }
}
