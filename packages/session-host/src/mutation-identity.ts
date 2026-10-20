/** Stable identity across all durable session mutation records. */
import { createHash } from "node:crypto";
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
export const decisionFingerprint = (type: string, input: Record<string, unknown>): string => createHash("sha256").update(JSON.stringify([type, canonical(input)])).digest("hex");
