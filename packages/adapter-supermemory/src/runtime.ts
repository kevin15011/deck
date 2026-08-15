import { evaluateAdaptiveMemoryCaptureEligibility, fingerprintSupermemoryProjectScope, isCanonicalSupermemoryProjectScope } from "@deck/core";

import {
  buildSupermemoryConversationIngest,
  boundSupermemoryRetrievalItems,
  redactSupermemoryConversationContent,
  type SupermemoryConversationRole,
} from "./conversation";

export const DEFAULT_SUPERMEMORY_API_BASE_URL = "https://api.supermemory.ai";
const DEFAULT_TIMEOUT_MS = 8_000;

export type SupermemoryRuntimeRole = "lead" | "investigate" | "architect" | "apply-fast" | "apply-deep" | "quality" | "setup";

export type SupermemoryRolePolicy = Readonly<{
  role: SupermemoryRuntimeRole;
  maxResults: number;
  maxTokens: number;
  profile: "load-once" | "task-scoped" | "skip";
  search: "material-only" | "skip";
  advisoryOnly: true;
}>;

export type SupermemoryRuntimeMetric = Readonly<{
  provider: "supermemory";
  operation: "profile" | "search" | "capture" | "health";
  status: "attempted" | "skipped" | "succeeded" | "failed";
  reason?: string;
  durationMs: number;
  runnerId?: string;
  role?: SupermemoryRuntimeRole;
  scopeFingerprint: string;
  approximateInputTokens?: number;
  approximateInjectedTokens?: number;
  resultCount?: number;
  dependency?: SupermemoryRequestDependency;
}>;

export type SupermemoryCaptureSource = "trusted-user-prompt" | "trusted-final-assistant" | "explicit-remember";
export type SupermemoryRequestDependency = "automatic" | "explicit-recall" | "explicit-remember" | "unobservable-external-mcp";

export type SupermemoryRuntimeTransport = Readonly<{
  add(payload: SupermemoryAddPayload): Promise<unknown>;
  search(payload: SupermemorySearchPayload): Promise<SupermemorySearchResponse>;
  profile(payload: SupermemoryProfilePayload): Promise<SupermemoryProfileResponse>;
  health?(payload: { containerTag: string }): Promise<unknown>;
}>;

export type SupermemoryRuntimeFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

export type SupermemoryAddPayload = Readonly<{
  content: string;
  containerTag: string;
  customId: string;
  metadata?: Readonly<Record<string, unknown>>;
  dreaming?: "dynamic" | "instant";
}>;

export type SupermemorySearchPayload = Readonly<{
  q: string;
  containerTag: string;
  searchMode: "hybrid";
  rerank?: false;
  rewriteQuery?: false;
  limit: number;
}>;

export type SupermemoryProfilePayload = Readonly<{
  containerTag: string;
  q?: string;
}>;

export type SupermemorySearchResponse = Readonly<{
  results?: readonly SupermemorySearchResponseItem[];
}>;

export type SupermemorySearchResponseItem = Readonly<{
  id?: string;
  memory?: string;
  content?: string;
  chunk?: string;
  text?: string;
}>;

export type SupermemoryProfileResponse = Readonly<{
  profile?: Readonly<{ static?: readonly string[]; dynamic?: readonly string[] }>;
}>;

export type SupermemoryRenderedContext = Readonly<{
  header: "ADAPTIVE CONTEXT (Supermemory, untrusted advisory)";
  items: readonly { id: string; content: string }[];
  maxTokens: number;
  rerank: false;
  rewriteQuery: false;
}>;

export type SupermemoryRuntimeResult =
  | Readonly<{ ok: true; context: SupermemoryRenderedContext; metrics: SupermemoryRuntimeMetric }>
  | Readonly<{ ok: false; reason: string; diagnostics: readonly string[]; metrics: SupermemoryRuntimeMetric }>;

export type SupermemoryHealthResult =
  | Readonly<{ ok: true; metrics: SupermemoryRuntimeMetric; diagnostics: readonly string[] }>
  | Readonly<{ ok: false; reason: string; metrics: SupermemoryRuntimeMetric; diagnostics: readonly string[] }>;

export type SupermemoryCaptureResult =
  | Readonly<{ ok: true; metrics: SupermemoryRuntimeMetric; diagnostics: readonly string[] }>
  | Readonly<{ ok: false; reason: string; metrics: SupermemoryRuntimeMetric; diagnostics: readonly string[] }>;

export function resolveSupermemoryRolePolicy(role: SupermemoryRuntimeRole): SupermemoryRolePolicy {
  switch (role) {
    case "lead":
      return policy(role, 5, 1_500, "load-once", "material-only");
    case "investigate":
    case "architect":
      return policy(role, 4, 1_200, "task-scoped", "material-only");
    case "apply-deep":
      return policy(role, 5, 1_500, "task-scoped", "material-only");
    case "quality":
      return policy(role, 3, 900, "task-scoped", "material-only");
    case "setup":
      return policy(role, 2, 600, "task-scoped", "material-only");
    case "apply-fast":
      return policy(role, 0, 0, "skip", "skip");
  }
}

export function createSupermemoryRuntime(input: {
  canonicalScope: string;
  sessionId: string;
  transport: SupermemoryRuntimeTransport;
  runnerId?: string;
  now?: () => number;
  observe?: (metric: SupermemoryRuntimeMetric) => void;
}) {
  const canonicalScope = input.canonicalScope.trim();
  const scopeFingerprint = isCanonicalSupermemoryProjectScope(canonicalScope)
    ? fingerprintSupermemoryProjectScope(canonicalScope)
    : "smfp_invalid";
  const now = input.now ?? (() => Date.now());

  function metric(args: Omit<SupermemoryRuntimeMetric, "provider" | "durationMs" | "scopeFingerprint"> & { startedAt: number }): SupermemoryRuntimeMetric {
    return {
      provider: "supermemory",
      scopeFingerprint,
      durationMs: Math.max(0, now() - args.startedAt),
      runnerId: input.runnerId,
      ...withoutStartedAt(args),
    };
  }

  function emit(args: Omit<SupermemoryRuntimeMetric, "provider" | "durationMs" | "scopeFingerprint"> & { startedAt: number }): SupermemoryRuntimeMetric {
    const value = metric(args);
    input.observe?.(value);
    return value;
  }

  function invalidScope(operation: SupermemoryRuntimeMetric["operation"], startedAt: number): SupermemoryRuntimeResult {
    return {
      ok: false,
      reason: "invalid_project_scope",
      diagnostics: ["Supermemory runtime is disabled because the canonical project scope is missing or invalid."],
      metrics: metric({ operation, status: "skipped", reason: "invalid_project_scope", startedAt }),
    };
  }

  return {
    async profile(request: { role: SupermemoryRuntimeRole; q?: string; dependency?: SupermemoryRequestDependency }): Promise<SupermemoryRuntimeResult> {
      const startedAt = now();
      if (!isCanonicalSupermemoryProjectScope(canonicalScope)) return invalidScope("profile", startedAt);
      const rolePolicy = resolveSupermemoryRolePolicy(request.role);
      if (rolePolicy.profile === "skip") return skipped("profile", "role_policy_skip", rolePolicy, startedAt, metric);
      try {
        emit({ operation: "profile", status: "attempted", role: request.role, dependency: request.dependency ?? "automatic", startedAt });
        const response = await input.transport.profile({ containerTag: canonicalScope, q: request.q });
        const items = profileItems(response);
        const bounded = boundSupermemoryRetrievalItems({ items, maxItems: rolePolicy.maxResults, maxTokens: rolePolicy.maxTokens });
        return {
          ok: true,
          context: renderContext(bounded),
          metrics: metric({
            operation: "profile",
            status: "succeeded",
            role: request.role,
            resultCount: bounded.items.length,
            approximateInjectedTokens: countApproxTokens(bounded.items.map((item) => item.content).join(" ")),
            dependency: request.dependency ?? "automatic",
            startedAt,
          }),
        };
      } catch (error) {
        return failure("profile", rolePolicy, startedAt, error, metric, request.dependency ?? "automatic");
      }
    },

    async search(request: { role: SupermemoryRuntimeRole; query: string; dependency?: SupermemoryRequestDependency }): Promise<SupermemoryRuntimeResult> {
      const startedAt = now();
      if (!isCanonicalSupermemoryProjectScope(canonicalScope)) return invalidScope("search", startedAt);
      const rolePolicy = resolveSupermemoryRolePolicy(request.role);
      const query = request.query.trim();
      if (rolePolicy.search === "skip" || rolePolicy.maxResults <= 0) return skipped("search", "role_policy_skip", rolePolicy, startedAt, metric);
      if (!query) return skipped("search", "empty_query", rolePolicy, startedAt, metric);
      try {
        emit({ operation: "search", status: "attempted", role: request.role, approximateInputTokens: countApproxTokens(query), dependency: request.dependency ?? "automatic", startedAt });
        const response = await input.transport.search({
          q: query,
          containerTag: canonicalScope,
          searchMode: "hybrid",
          rerank: false,
          rewriteQuery: false,
          limit: rolePolicy.maxResults,
        });
        const bounded = boundSupermemoryRetrievalItems({ items: searchItems(response), maxItems: rolePolicy.maxResults, maxTokens: rolePolicy.maxTokens });
        return {
          ok: true,
          context: renderContext(bounded),
          metrics: metric({
            operation: "search",
            status: "succeeded",
            role: request.role,
            resultCount: bounded.items.length,
            approximateInputTokens: countApproxTokens(query),
            approximateInjectedTokens: countApproxTokens(bounded.items.map((item) => item.content).join(" ")),
            dependency: request.dependency ?? "automatic",
            startedAt,
          }),
        };
      } catch (error) {
        return failure("search", rolePolicy, startedAt, error, metric, request.dependency ?? "automatic");
      }
    },

    async capture(turn: { role: SupermemoryConversationRole; content: string; source: SupermemoryCaptureSource; capturedAt?: string; dependency?: SupermemoryRequestDependency; correlationId?: string }): Promise<SupermemoryCaptureResult> {
      const startedAt = now();
      if (!isCanonicalSupermemoryProjectScope(canonicalScope)) {
        return {
          ok: false,
          reason: "invalid_project_scope",
          diagnostics: ["Supermemory capture skipped because the canonical project scope is missing or invalid."],
          metrics: metric({ operation: "capture", status: "skipped", reason: "invalid_project_scope", startedAt }),
        };
      }
      const rawEligibility = evaluateAdaptiveMemoryCaptureEligibility({ source: turn.source, content: turn.content });
      if (!rawEligibility.eligible) {
        return {
          ok: false,
          reason: rawEligibility.reason,
          diagnostics: rawEligibility.diagnostics,
          metrics: metric({ operation: "capture", status: "skipped", reason: rawEligibility.reason, dependency: turn.dependency ?? "automatic", startedAt }),
        };
      }
      const redacted = redactSupermemoryConversationContent(rawEligibility.content);
      if (!hasSubstantiveContent(redacted.content)) {
        return {
          ok: false,
          reason: "secret_or_empty_content",
          diagnostics: ["Supermemory capture skipped because content was empty or only redacted sensitive material."],
          metrics: metric({ operation: "capture", status: "skipped", reason: "secret_or_empty_content", startedAt }),
        };
      }
      const eligibility = evaluateAdaptiveMemoryCaptureEligibility({ source: turn.source, content: redacted.content });
      if (!eligibility.eligible) {
        return {
          ok: false,
          reason: eligibility.reason,
          diagnostics: eligibility.diagnostics,
          metrics: metric({ operation: "capture", status: "skipped", reason: eligibility.reason, dependency: turn.dependency ?? "automatic", startedAt }),
        };
      }
      const ingest = buildSupermemoryConversationIngest({
        canonicalScope,
        sessionId: input.sessionId,
        turn: { ...turn, content: eligibility.content, source: turn.source, dependency: turn.dependency ?? "automatic", correlationId: turn.correlationId },
      });
      if (!ingest.ok) {
        return {
          ok: false,
          reason: "invalid_capture_payload",
          diagnostics: ingest.diagnostics,
          metrics: metric({ operation: "capture", status: "skipped", reason: "invalid_capture_payload", startedAt }),
        };
      }
      try {
        emit({ operation: "capture", status: "attempted", approximateInputTokens: countApproxTokens(eligibility.content), dependency: turn.dependency ?? "automatic", startedAt });
        await input.transport.add(ingest.request);
        return {
          ok: true,
          diagnostics: ingest.diagnostics,
          metrics: metric({
            operation: "capture",
            status: "succeeded",
            approximateInputTokens: countApproxTokens(eligibility.content),
            dependency: turn.dependency ?? "automatic",
            startedAt,
          }),
        };
      } catch (error) {
        return {
          ok: false,
          reason: "provider_error",
          diagnostics: [redactProviderError(error)],
          metrics: metric({ operation: "capture", status: "failed", reason: "provider_error", dependency: turn.dependency ?? "automatic", startedAt }),
        };
      }
    },

    async health(request: { dependency?: SupermemoryRequestDependency } = {}): Promise<SupermemoryHealthResult> {
      const startedAt = now();
      if (!isCanonicalSupermemoryProjectScope(canonicalScope)) {
        return {
          ok: false,
          reason: "invalid_project_scope",
          diagnostics: ["Supermemory health skipped because the canonical project scope is missing or invalid."],
          metrics: metric({ operation: "health", status: "skipped", reason: "invalid_project_scope", startedAt }),
        };
      }
      try {
        emit({ operation: "health", status: "attempted", dependency: request.dependency ?? "automatic", startedAt });
        if (input.transport.health) await input.transport.health({ containerTag: canonicalScope });
        else await input.transport.profile({ containerTag: canonicalScope });
        return { ok: true, diagnostics: [], metrics: metric({ operation: "health", status: "succeeded", dependency: request.dependency ?? "automatic", startedAt }) };
      } catch (error) {
        return {
          ok: false,
          reason: "provider_error",
          diagnostics: [redactProviderError(error)],
          metrics: metric({ operation: "health", status: "failed", reason: "provider_error", dependency: request.dependency ?? "automatic", startedAt }),
        };
      }
    },
  };
}

export function createSupermemoryHttpTransport(input: {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  fetchImpl?: SupermemoryRuntimeFetch;
}): SupermemoryRuntimeTransport {
  // Runtime operations use this minimal HTTP transport instead of the official
  // Keep this as direct HTTP because runtime timeouts must abort the underlying fetch.
  // The official provider client surface does not provide a stable per-operation AbortSignal contract.
  const baseURL = input.baseURL ?? DEFAULT_SUPERMEMORY_API_BASE_URL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    add: (payload) => callSupermemoryHttp(fetchImpl, baseURL, input.apiKey, "/v3/documents", httpAddPayload(payload), timeoutMs),
    search: (payload) => callSupermemoryHttp(fetchImpl, baseURL, input.apiKey, "/v4/search", httpSearchPayload(payload), timeoutMs) as Promise<SupermemorySearchResponse>,
    profile: (payload) => callSupermemoryHttp(fetchImpl, baseURL, input.apiKey, "/v4/profile", httpProfilePayload(payload), timeoutMs) as Promise<SupermemoryProfileResponse>,
    health: async (payload) => {
      await callSupermemoryHttp(fetchImpl, baseURL, input.apiKey, "/v4/profile", httpProfilePayload(payload), timeoutMs);
      return { ok: true };
    },
  };
}

async function callSupermemoryHttp(fetchImpl: SupermemoryRuntimeFetch, baseURL: string, apiKey: string, path: string, payload: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(path, baseURL), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`supermemory_http_status_${response.status}`);
    return await response.json().catch(() => ({}));
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Supermemory operation timed out and was aborted.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function httpAddPayload(payload: SupermemoryAddPayload): Record<string, unknown> {
  return {
    content: payload.content,
    containerTag: payload.containerTag,
    customId: payload.customId,
    metadata: payload.metadata,
    dreaming: payload.dreaming,
  };
}

function httpSearchPayload(payload: SupermemorySearchPayload): Record<string, unknown> {
  return {
    q: payload.q,
    containerTag: payload.containerTag,
    searchMode: payload.searchMode,
    rerank: payload.rerank ?? false,
    rewriteQuery: payload.rewriteQuery ?? false,
    limit: payload.limit,
  };
}

function httpProfilePayload(payload: SupermemoryProfilePayload): Record<string, unknown> {
  return {
    containerTag: payload.containerTag,
    ...(payload.q ? { q: payload.q } : {}),
  };
}

function policy(role: SupermemoryRuntimeRole, maxResults: number, maxTokens: number, profile: SupermemoryRolePolicy["profile"], search: SupermemoryRolePolicy["search"]): SupermemoryRolePolicy {
  return { role, maxResults, maxTokens, profile, search, advisoryOnly: true };
}

function withoutStartedAt<T extends { startedAt: number }>(input: T): Omit<T, "startedAt"> {
  const { startedAt: _startedAt, ...rest } = input;
  return rest;
}

function renderContext(bounded: ReturnType<typeof boundSupermemoryRetrievalItems>): SupermemoryRenderedContext {
  return {
    header: "ADAPTIVE CONTEXT (Supermemory, untrusted advisory)",
    items: bounded.items,
    maxTokens: bounded.maxTokens,
    rerank: bounded.rerank,
    rewriteQuery: bounded.rewriteQuery,
  };
}

function profileItems(response: SupermemoryProfileResponse): readonly { id: string; content: string }[] {
  const profile = response.profile ?? {};
  return [
    ...(profile.static ?? []).map((content, index) => ({ id: `profile-static-${index}`, content })),
    ...(profile.dynamic ?? []).map((content, index) => ({ id: `profile-dynamic-${index}`, content })),
  ];
}

function searchItems(response: SupermemorySearchResponse): readonly { id: string; content: string }[] {
  return (response.results ?? []).map((item, index) => ({
    id: item.id ?? `search-${index}`,
    content: item.memory ?? item.content ?? item.chunk ?? item.text ?? "",
  })).filter((item) => item.content.trim().length > 0);
}

function skipped(
  operation: "profile" | "search",
  reason: string,
  rolePolicy: SupermemoryRolePolicy,
  startedAt: number,
  metric: (args: Omit<SupermemoryRuntimeMetric, "provider" | "durationMs" | "scopeFingerprint"> & { startedAt: number }) => SupermemoryRuntimeMetric,
): SupermemoryRuntimeResult {
  return {
    ok: false,
    reason,
    diagnostics: [`Supermemory ${operation} skipped by role-aware policy.`],
    metrics: metric({ operation, status: "skipped", reason, role: rolePolicy.role, startedAt }),
  };
}

function failure(
  operation: "profile" | "search",
  rolePolicy: SupermemoryRolePolicy,
  startedAt: number,
  error: unknown,
  metric: (args: Omit<SupermemoryRuntimeMetric, "provider" | "durationMs" | "scopeFingerprint"> & { startedAt: number }) => SupermemoryRuntimeMetric,
  dependency: SupermemoryRequestDependency,
): SupermemoryRuntimeResult {
  return {
    ok: false,
    reason: "provider_error",
    diagnostics: [redactProviderError(error)],
    metrics: metric({ operation, status: "failed", reason: "provider_error", role: rolePolicy.role, dependency, startedAt }),
  };
}

function hasSubstantiveContent(content: string): boolean {
  return content
    .replace(/\[REDACTED[^\]]*\]/g, " ")
    .replace(/Authorization:\s*(?:Bearer|Basic)\s*\[REDACTED\]/gi, " ")
    .trim()
    .length > 0;
}

function countApproxTokens(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function redactProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.match(/supermemory_http_status_(\d{3})/);
  if (status) return `Supermemory provider request failed: endpoint=api status=${status[1]} reason=provider_http_error`;
  if (/timed out|aborted/i.test(message)) return "Supermemory provider request failed: endpoint=api status=timeout reason=timeout";
  return "Supermemory provider request failed: endpoint=api status=unknown reason=transport_error";
}
