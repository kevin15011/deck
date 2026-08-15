#!/usr/bin/env bun

import { createSupermemoryRuntime, type SupermemoryAddPayload, type SupermemoryRuntimeTransport } from "../packages/adapter-supermemory/src/runtime";

type ScenarioName =
  | "temporal-supersession"
  | "stale-contradictory-dominance"
  | "recurring-problems"
  | "changed-decisions"
  | "preferences"
  | "conventions"
  | "root-causes"
  | "rediscovery"
  | "role-budgets"
  | "project-leakage"
  | "secret-exclusion"
  | "latency-context-size"
  | "mcp-primary-vs-runtime";

type ScenarioResult = Readonly<{
  name: ScenarioName;
  passed: boolean;
  score: number;
  precision: number;
  recall: number;
  byteSize: number;
  latencyMs: number;
  diagnostics: readonly string[];
  baselineIds?: readonly string[];
  runtimeIds?: readonly string[];
}>;

type MemoryRecord = Readonly<{
  id: string;
  scope: string;
  content: string;
  terms: readonly string[];
  stale?: boolean;
  supersededBy?: string;
}>;

const SCOPE = "sm_project_v1_kevin15011_deck";
const OTHER_SCOPE = "sm_project_v1_other_repo";
const BYTE_BUDGET = 6_000;
const LATENCY_BUDGET_MS = 75;
const LOCAL_RUNTIME_P95_OVERHEAD_GATE_MS = 20;
const PRECISION_GATE = 0.80;
const RECALL_GATE = 0.75;

const seed: readonly MemoryRecord[] = [
  rec("old-engram", SCOPE, "Deprecated decision: use Engram direct commands for memory.", ["memory", "provider"], { stale: true, supersededBy: "current-runtime" }),
  rec("current-runtime", SCOPE, "Current decision: use Supermemory Deck runtime as primary; MCP is optional recall only.", ["memory", "provider", "runtime"]),
  rec("old-mcp-primary", SCOPE, "Stale claim: Supermemory MCP is the primary automatic capture path.", ["mcp", "primary"], { stale: true, supersededBy: "current-mcp-optional" }),
  rec("current-mcp-optional", SCOPE, "Current claim: automatic capture is Deck runtime only; MCP writes are unmanaged and not advertised.", ["mcp", "primary", "write"]),
  rec("recurring-stdout", SCOPE, "Recurring problem: raw stdout ingestion leaked logs; only trusted bounded final assistant files may be captured.", ["stdout", "logs", "failure"]),
  rec("changed-enabled", SCOPE, "Changed decision: adaptiveMemory.enabled is the product boolean; activeProvider is compatibility projection.", ["enabled", "activeProvider"]),
  rec("pref-fail-open", SCOPE, "Preference: automatic recall/capture fails open, explicit recall or remember is user-visible and blocking.", ["preference", "fail", "explicit"]),
  rec("conv-scope", SCOPE, "Convention: every scoped Supermemory operation passes canonical containerTag and stable customId.", ["containerTag", "customId", "convention"]),
  rec("root-hook", SCOPE, "Root cause: interactive Pi/OpenCode lack trusted final assistant hooks, so they are unsupported for automatic capture.", ["root", "hook", "interactive"]),
  rec("rediscovery-double-write", SCOPE, "Rediscovery: MCP write tools caused double ingestion; explicit remember now routes through Deck runtime.", ["rediscovery", "double", "remember"]),
  rec("quality-budget", SCOPE, "Role budget: quality receives at most 900 advisory tokens; apply-fast skips memory context.", ["quality", "budget", "apply-fast"]),
  rec("foreign", OTHER_SCOPE, "Foreign repository convention that must never appear in Deck context.", ["containerTag", "foreign"]),
];

const scenarios: Readonly<Record<ScenarioName, { query: string; expected: readonly string[]; forbidden?: readonly string[]; role?: Parameters<ReturnType<typeof createSupermemoryRuntime>["search"]>[0]["role"] }>> = {
  "temporal-supersession": { query: "current memory provider", expected: ["current-runtime"], forbidden: ["old-engram"] },
  "stale-contradictory-dominance": { query: "MCP primary automatic capture", expected: ["current-mcp-optional"], forbidden: ["old-mcp-primary"] },
  "recurring-problems": { query: "stdout logs failure", expected: ["recurring-stdout"] },
  "changed-decisions": { query: "enabled activeProvider decision", expected: ["changed-enabled"] },
  preferences: { query: "explicit fail open preference", expected: ["pref-fail-open"] },
  conventions: { query: "containerTag customId convention", expected: ["conv-scope"] },
  "root-causes": { query: "interactive hook root cause", expected: ["root-hook"] },
  rediscovery: { query: "double ingestion explicit remember", expected: ["rediscovery-double-write", "bench-explicit-remember"] },
  "role-budgets": { query: "quality budget apply-fast", expected: ["quality-budget"], role: "quality" },
  "project-leakage": { query: "containerTag convention foreign", expected: ["conv-scope"], forbidden: ["foreign"] },
  "secret-exclusion": { query: "current runtime", expected: ["current-runtime", "current-mcp-optional"] },
  "latency-context-size": { query: "current runtime MCP write stdout enabled", expected: ["current-mcp-optional"] },
  "mcp-primary-vs-runtime": { query: "explicit remember runtime capture", expected: ["bench-explicit-remember"] },
};

export async function runDeckMemoryBench(): Promise<readonly ScenarioResult[]> {
  const transport = new FakeSupermemoryTransport(seed);
  const runtime = createSupermemoryRuntime({ canonicalScope: SCOPE, sessionId: "bench-session", runnerId: "bench", transport, now: deterministicClock() });
  const explicit = await runtime.capture({
    role: "user",
    source: "explicit-remember",
    dependency: "explicit-remember",
    content: "Runtime captured explicit remember prevents MCP double ingestion and is discoverable later.",
    correlationId: "bench-explicit-remember",
  });
  if (!explicit.ok) throw new Error(explicit.diagnostics.join(" "));

  const secretCapture = await runtime.capture({
    role: "user",
    source: "trusted-user-prompt",
    dependency: "automatic",
    content: "sk-supersecretvalue",
    correlationId: "bench-secret-rejection",
  });
  const baseline = runMcpPrimaryBaseline("explicit remember runtime capture");

  const results: ScenarioResult[] = [];
  for (const name of Object.keys(scenarios) as ScenarioName[]) {
    const started = Date.now();
    const scenario = scenarios[name];
    const result = await runtime.search({ role: scenario.role ?? "apply-deep", query: scenario.query, dependency: "explicit-recall" });
    const ids = result.ok ? result.context.items.map((item) => item.id) : [];
    const byteSize = result.ok ? Buffer.byteLength(result.context.items.map((item) => item.content).join("\n"), "utf8") : 0;
    const diagnostics: string[] = [];
    const expectedHits = scenario.expected.filter((id) => ids.includes(id)).length;
    const forbiddenHits = (scenario.forbidden ?? []).filter((id) => ids.includes(id));
    const precision = ids.length === 0 ? 0 : expectedHits / ids.length;
    const recall = scenario.expected.length === 0 ? 1 : expectedHits / scenario.expected.length;
    if (!result.ok) diagnostics.push(`runtime search failed: ${result.diagnostics.join(" ")}`);
    if (precision < PRECISION_GATE) diagnostics.push(`precision ${precision.toFixed(2)} below gate ${PRECISION_GATE}`);
    if (recall < RECALL_GATE) diagnostics.push(`recall ${recall.toFixed(2)} below gate ${RECALL_GATE}`);
    if (forbiddenHits.length) diagnostics.push(`forbidden records returned: ${forbiddenHits.join(",")}`);
    if (recall < RECALL_GATE) diagnostics.push(`missing expected records: ${scenario.expected.filter((id) => !ids.includes(id)).join(",")}`);
    if (byteSize > BYTE_BUDGET) diagnostics.push(`context exceeded byte budget ${BYTE_BUDGET}`);
    if (name === "secret-exclusion" && secretCapture.reason !== "secret_detected") diagnostics.push("secret-only capture was not rejected");
    if (name === "mcp-primary-vs-runtime" && baseline.includes("bench-explicit-remember")) diagnostics.push("MCP-primary baseline unexpectedly captured explicit runtime memory");
    const latencyMs = Date.now() - started;
    if (latencyMs > LATENCY_BUDGET_MS) diagnostics.push(`latency exceeded ${LATENCY_BUDGET_MS}ms`);
    results.push({
      name,
      passed: diagnostics.length === 0,
      score: diagnostics.length === 0 ? 1 : 0,
      precision,
      recall,
      byteSize,
      latencyMs,
      diagnostics,
      ...(name === "mcp-primary-vs-runtime" ? { baselineIds: baseline, runtimeIds: ids } : {}),
    });
  }
  return results;
}

class FakeSupermemoryTransport implements SupermemoryRuntimeTransport {
  #records: MemoryRecord[];
  constructor(records: readonly MemoryRecord[]) { this.#records = [...records]; }
  async health() { return { ok: true }; }
  async add(payload: SupermemoryAddPayload) {
    if (/\[REDACTED/.test(payload.content) && payload.content.replace(/\[REDACTED[^\]]*\]/g, " ").trim().length === 0) return { skipped: true };
    this.#records.push(rec(payload.metadata?.correlationId as string || payload.customId, payload.containerTag, payload.content, tokenize(payload.content)));
    return { ok: true };
  }
  async profile(payload: { containerTag: string }) {
    const profile = this.#records.filter((record) => record.scope === payload.containerTag && !record.stale && !record.supersededBy).slice(0, 3).map((record) => record.content);
    return { profile: { static: profile, dynamic: [] } };
  }
  async search(payload: { q: string; containerTag: string; limit: number }) {
    const terms = tokenize(payload.q);
    const activeIds = new Set(this.#records.filter((record) => record.supersededBy).map((record) => record.supersededBy));
    const ranked = this.#records
      .filter((record) => record.scope === payload.containerTag && !record.stale && (!record.supersededBy || activeIds.has(record.id)))
      .map((record) => ({ record, score: terms.filter((term) => record.terms.includes(term) || record.content.toLowerCase().includes(term)).length }))
      .filter((ranked) => ranked.score >= Math.max(1, Math.ceil(terms.length * 0.5)))
      .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
    const maxScore = ranked[0]?.score ?? 0;
    const results = ranked
      .filter((entry) => entry.score === maxScore)
      .slice(0, payload.limit)
      .map(({ record }) => ({ id: record.id, memory: record.content }));
    return { results };
  }
}

function runMcpPrimaryBaseline(query: string): readonly string[] {
  const terms = tokenize(query);
  return seed.filter((record) => record.scope === SCOPE && terms.some((term) => record.terms.includes(term))).map((record) => record.id);
}

function rec(id: string, scope: string, content: string, terms: readonly string[], extra: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id, scope, content, terms: [...new Set([...terms, ...tokenize(content)])], ...extra };
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

function deterministicClock(): () => number {
  let now = 0;
  return () => ++now;
}

if (import.meta.main) {
  const results = await runDeckMemoryBench();
  const localRuntimeOverheadP95Ms = await measureLocalRuntimeOverheadP95Ms();
  const precision = results.reduce((sum, result) => sum + result.precision, 0) / results.length;
  const recall = results.reduce((sum, result) => sum + result.recall, 0) / results.length;
  const total = results.reduce((sum, result) => sum + result.score, 0);
  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({
    benchmark: "DeckMemoryBench",
    kind: "deterministic-runtime-contract",
    note: "Fake transport proves Deck runtime contract, scoping, leakage, and budget behavior only; it does not prove live Supermemory ranking quality.",
    optionalLiveCanary: "Set SUPERMEMORY_API_KEY and run a separate live canary outside CI if provider-ranking quality needs validation; CI never requires provider secrets.",
    gates: { precision: `${PRECISION_GATE} per scenario`, recall: `${RECALL_GATE} per scenario`, zeroSecretTransport: "hard", projectLeakage: "hard", roleContextBounds: "hard", baselineVsRuntimeComparative: "hard" },
    aggregate: { precision, recall },
    localRuntimeOverhead: { p95Ms: localRuntimeOverheadP95Ms, gateMs: LOCAL_RUNTIME_P95_OVERHEAD_GATE_MS, kind: "local deterministic runtime overhead; excludes live provider latency" },
    compiledParity: "separate release hard gate: bun run verify:supermemory-compiled",
    byteBudget: BYTE_BUDGET,
    latencyBudgetMs: LATENCY_BUDGET_MS,
    total,
    max: results.length,
    failed: failed.length,
    results,
  }, null, 2));
  if (failed.length > 0 || localRuntimeOverheadP95Ms >= LOCAL_RUNTIME_P95_OVERHEAD_GATE_MS) process.exit(1);
}

async function measureLocalRuntimeOverheadP95Ms(): Promise<number> {
  const transport = new FakeSupermemoryTransport(seed);
  const runtime = createSupermemoryRuntime({ canonicalScope: SCOPE, sessionId: "bench-overhead", runnerId: "bench", transport });
  const samples: number[] = [];
  for (let index = 0; index < 80; index += 1) {
    const started = performance.now();
    const result = await runtime.search({ role: "quality", query: "quality budget apply-fast", dependency: "explicit-recall" });
    if (!result.ok) throw new Error(result.diagnostics.join(" "));
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return Number(samples[Math.ceil(samples.length * 0.95) - 1]!.toFixed(3));
}
