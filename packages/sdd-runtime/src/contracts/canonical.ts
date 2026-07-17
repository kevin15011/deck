import { createHash } from "node:crypto";

export type Sha256Digest = `sha256:${string}`;
export interface RepositoryPathContextV1 { repositoryRoot: string; pathStyle?: "posix" | "windows" }
const MAX_ARRAY = 4096, MAX_TEXT = 4096;
export const invalidEvidence = (field: string): never => { throw new Error(`invalid-evidence: ${field}`); };
function invalidCanonical(reason: string): never { throw new Error(`invalid-canonical-value: ${reason}`); }

export function assertPlainRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalidEvidence(field);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || descriptor.get || descriptor.set) invalidEvidence(field);
  }
}
export function assertExactKeys(value: unknown, allowed: readonly string[], field: string): asserts value is Record<string, unknown> {
  assertPlainRecord(value, field);
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalidEvidence(field);
}
export function stringValue(value: unknown, field: string, maximumBytes = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximumBytes) invalidEvidence(field);
  return (value as string).trim();
}
export function codeValue(value: unknown, field: string): string {
  const code = stringValue(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(code)) invalidEvidence(field);
  return code;
}
export function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T { if (!values.includes(value as T)) invalidEvidence(field); return value as T; }
export function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") invalidEvidence(field); return value as boolean; }
export function integerValue(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalidEvidence(field); return value as number; }
export function numberValue(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) invalidEvidence(field); return value as number; }
export function timestampValue(value: unknown, field: string): string { const text = stringValue(value, field, 64); const date = new Date(text); if (!/Z$/.test(text) || Number.isNaN(date.valueOf())) invalidEvidence(field); return date.toISOString(); }
export function denseArray(value: unknown, field: string, maximum = MAX_ARRAY): unknown[] { if (!Array.isArray(value) || value.length > maximum) invalidEvidence(field); const array=value as unknown[]; for (let i=0;i<array.length;i++) if (!(i in array)) invalidEvidence(field); return array; }
export function stringArray(value: unknown, field: string, set = false): string[] { const values=denseArray(value,field).map((v,i)=>codeValue(v,`${field}[${i}]`)); if (set && new Set(values).size !== values.length) invalidEvidence(field); return set ? [...values].sort() : values; }
export function optionalString(value: unknown, field: string): string | undefined { return value === undefined ? undefined : stringValue(value, field); }
export function assertDigest(value: unknown, field: string): asserts value is Sha256Digest { if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) invalidEvidence(field); }
export function assertId(value: unknown, prefix: string, field: string): asserts value is string { if (typeof value !== "string" || !new RegExp(`^${prefix.replace(/:/g,"\\:")}[a-f0-9]{32}$`).test(value)) invalidEvidence(field); }

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : invalidCanonical("non-finite number");
  if (typeof value !== "object") return invalidCanonical(typeof value);
  if (seen.has(value)) return invalidCanonical("cyclic input"); seen.add(value);
  try { if (Array.isArray(value)) { for(let i=0;i<value.length;i++)if(!(i in value))invalidCanonical("sparse array"); return value.map(v=>normalize(v,seen)); } if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)invalidCanonical("non-plain object"); assertPlainRecord(value,"canonical object"); return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalize((value as Record<string,unknown>)[k],seen)])); }
  finally { seen.delete(value); }
}
export function canonicalJson(value: unknown): string { return JSON.stringify(normalize(value,new Set())); }
export function sha256Digest(value: unknown): Sha256Digest { return `sha256:${createHash("sha256").update(canonicalJson(value),"utf8").digest("hex")}`; }
export function cloneCanonical<T>(value: T): T { return JSON.parse(canonicalJson(value)) as T; }
export function deepFreeze<T>(value: T): Readonly<T> { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string,unknown>)) deepFreeze(child); Object.freeze(value); } return value as Readonly<T>; }
export function normalizeSet(values: readonly string[], field: string): string[] { return [...new Set(stringArray(values,field).map(v=>v.replaceAll("\\","/")))].sort(); }

export function repositoryPath(path: unknown, context: RepositoryPathContextV1, field: string): string {
  const raw = stringValue(path, field, 1024).normalize("NFC");
  const root = stringValue(context.repositoryRoot, "repositoryRoot", 1024).normalize("NFC");
  if (raw.includes("\0") || root.includes("\0")) invalidEvidence(field);
  const slash = (value: string) => value.replaceAll("\\", "/");
  const normalizedRaw = slash(raw);
  const normalizedRoot = slash(root).replace(/\/$/, "");
  if (/^[A-Za-z]:[^/]/.test(normalizedRaw) || normalizedRaw.startsWith("//") || normalizedRaw.includes("//")) invalidEvidence(field);
  const windows = /^[A-Za-z]:\//.test(normalizedRoot);
  const compareRaw = windows ? normalizedRaw.toLowerCase() : normalizedRaw;
  const compareRoot = windows ? normalizedRoot.toLowerCase() : normalizedRoot;
  let relative = normalizedRaw;
  if (compareRaw === compareRoot) relative = ".";
  else if (compareRaw.startsWith(`${compareRoot}/`)) relative = normalizedRaw.slice(normalizedRoot.length + 1);
  else if (/^(?:[A-Za-z]:\/|\/)/.test(normalizedRaw)) invalidEvidence(field);
  if (/^[A-Za-z]:/.test(relative)) invalidEvidence(field);
  const segments = relative.replace(/^\.\//, "").split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "..")) invalidEvidence(field);
  const canonical = segments.filter((segment) => segment !== ".").join("/");
  if (!canonical) invalidEvidence(field);
  return canonical;
}
export function normalizeSafePath(path: string, projectRoot?: string): string { const raw=path.replaceAll("\\","/"),root=projectRoot?.replaceAll("\\","/").replace(/\/$/,"");if(root&&raw.startsWith(`${root}/`))return raw.slice(root.length+1);if(!raw.startsWith("/")&&!/(^|\/)\.\.(\/|$)/.test(raw))return raw.replace(/^\.\//,"");return `[external-path]:${sha256Digest(raw).slice(7,19)}`; }

const SECRET_KEY=/(?:^|[_-])(token|password|secret|api[_-]?key|authorization|auth[_-]?header|cookie|set[_-]?cookie|private[_-]?key|client[_-]?secret|access[_-]?key|session[_-]?key|credential|transcript)(?:$|[_-])/i;
const SECRET_VALUE=/(-----BEGIN (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----|-----END (?:ENCRYPTED |RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:bearer|basic)\s+[A-Za-z0-9+/_=.-]+|\b(?:cookie|set-cookie)\s*:|\beyJ[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}|(?:password|api[_-]?key|client[_-]?secret|access[_-]?key)\s*[:=])/i;
const INLINE=/\b(token|password|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi;
export function redactBoundedText(value: string, maximumBytes=256): string { let safe=stringValue(value,"diagnostic",maximumBytes*4).replace(INLINE,"$1=[redacted-secret]"); if (SECRET_VALUE.test(safe)) throw new Error("unsafe-diagnostic-content: failure finding"); safe=Buffer.from(safe).subarray(0,maximumBytes).toString("utf8"); if (SECRET_VALUE.test(safe)) throw new Error("unsafe-diagnostic-content: failure finding"); return safe; }
export function assertSafeDiagnosticString(value: unknown, field: string, maximumBytes=256): asserts value is string { const text=stringValue(value,field,maximumBytes); if (SECRET_VALUE.test(text)) throw new Error(`unsafe-diagnostic-content: ${field}`); }
export function assertNoUnsafeDiagnosticContent(value: unknown, field: string): void { if (typeof value==="string") { if (SECRET_VALUE.test(value)) throw new Error(`unsafe-diagnostic-content: ${field}`); return; } if (Array.isArray(value)) { denseArray(value,field).forEach(v=>assertNoUnsafeDiagnosticContent(v,field)); return; } if (value && typeof value==="object") { assertPlainRecord(value,field); for (const [k,v] of Object.entries(value)) { if (SECRET_KEY.test(k)) throw new Error(`unsafe-diagnostic-content: ${field}`); assertNoUnsafeDiagnosticContent(v,field); } } }
