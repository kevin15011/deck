import { renderSddContextSections } from "./adaptive-context-renderer";
import type { AdaptiveMemoryAdapter, AdaptiveMemoryHealthResult } from "./adaptive-memory-contract";

export type AdaptiveMemorySurface = "session" | "agent" | "skill";

export type MemoryCapability =
  | "memory.context"
  | "memory.search"
  | "memory.read"
  | "memory.write"
  | (string & {});

export type AdaptiveMemoryBuildContext = {
  teamId?: string;
};

export type AdaptiveMemoryCompositionContext = {
  surface: AdaptiveMemorySurface;
  teamId?: string;
  agentId?: string;
  skillId?: string;
};

export type MemoryInstructionFragment = {
  surface: AdaptiveMemorySurface;
  markdown: string;
  teamId?: string;
  agentIds?: readonly string[];
  skillIds?: readonly string[];
};

export type MemoryToolBinding = {
  capability: MemoryCapability;
  serverName: string;
  toolNames: readonly string[];
  metadata?: Readonly<Record<string, unknown>>;
};

export type MemoryInjectionBundle = {
  instructions: readonly MemoryInstructionFragment[];
  toolBindings: readonly MemoryToolBinding[];
};

export type AdaptiveMemoryProvider = {
  id: string;
  displayName: string;
  adapter?: AdaptiveMemoryAdapter;
  buildInjection(context: AdaptiveMemoryBuildContext): MemoryInjectionBundle;
  health?(): Promise<AdaptiveMemoryHealthResult> | AdaptiveMemoryHealthResult;
};

export type AdaptiveMemoryCompositionResult = {
  content: string;
  toolBindings: readonly MemoryToolBinding[];
};

export type MemoryDiagnostic = {
  code:
    | "unsupported_memory_provider"
    | "memory_provider_unavailable"
    | "multiple_memory_providers";
  message: string;
  providerId?: string;
  details?: Readonly<Record<string, unknown>>;
};

export type ResolveMemoryInjectionOptions = {
  /** A pre-built memory injection bundle (trusted/internal; takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** A memory provider that will build the injection bundle. Ignored if memoryInjection is set. */
  memoryProvider?: AdaptiveMemoryProvider;
  /** Candidate providers from configuration/registries. More than one fails closed. */
  memoryProviders?: readonly AdaptiveMemoryProvider[];
  /**
   * Provider IDs accepted by the caller's registry.
   *
   * Core stays provider-neutral: concrete provider registration/allowlisting is
   * owned by adapters/CLI or injected here by callers. If omitted, no provider
   * IDs are accepted and provider objects fail closed.
   */
  supportedProviderIds?: Iterable<string>;
  /** Provider-neutral build context forwarded to the selected provider. */
  buildContext?: AdaptiveMemoryBuildContext;
};

export const ADAPTIVE_MEMORY_SECTION_HEADING =
  "## Adaptive Memory (provider-injected)";

export const ADAPTIVE_MEMORY_AUXILIARY_POLICY =
  "Memory is auxiliary and never replaces required OpenSpec artifacts or Spec Registry entries.";

/**
 * Resolve a memory injection bundle from options, with fail-closed provider
 * validation against a caller-supplied provider registry.
 */
export function resolveMemoryInjection(
  options?: ResolveMemoryInjectionOptions,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  const diagnostics: MemoryDiagnostic[] = [];

  if (!options) return { bundle: undefined, diagnostics };
  if (options.memoryInjection) return { bundle: options.memoryInjection, diagnostics };

  const providers = [
    ...(options.memoryProvider ? [options.memoryProvider] : []),
    ...(options.memoryProviders ?? []),
  ];

  if (providers.length === 0) return { bundle: undefined, diagnostics };
  if (providers.length > 1) {
    diagnostics.push({
      code: "multiple_memory_providers",
      message: `Exactly one active adaptive memory provider is allowed; received ${providers.length}.`,
      details: { providerIds: providers.map((provider) => provider.id) },
    });
    return { bundle: undefined, diagnostics };
  }

  const provider = providers[0];
  const supportedProviderIds = new Set(options.supportedProviderIds ?? []);

  if (!supportedProviderIds.has(provider.id)) {
    const supportedList = [...supportedProviderIds].sort().join(", ") || "none configured";
    diagnostics.push({
      code: "unsupported_memory_provider",
      message: `Unsupported memory provider: "${provider.id}". Supported providers: ${supportedList}`,
      providerId: provider.id,
    });
    return { bundle: undefined, diagnostics };
  }

  try {
    const bundle = provider.buildInjection(options.buildContext ?? {});
    return { bundle, diagnostics };
  } catch (error) {
    diagnostics.push({
      code: "memory_provider_unavailable",
      message: `Memory provider is unavailable or incomplete: ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
      providerId: provider.id,
    });
    return { bundle: undefined, diagnostics };
  }
}

export async function collectMemoryProviderHealthDiagnostics(
  provider: AdaptiveMemoryProvider | undefined,
): Promise<AdaptiveMemoryHealthResult | undefined> {
  if (!provider) return undefined;
  if (provider.health) return await provider.health();
  return await provider.adapter?.health();
}

export function composeAdaptiveMemory(
  base: string,
  bundle: MemoryInjectionBundle | undefined,
  context: AdaptiveMemoryCompositionContext,
): AdaptiveMemoryCompositionResult {
  if (!bundle) {
    return { content: base, toolBindings: [] };
  }

  const matchingFragments = bundle.instructions.filter((fragment) =>
    matchesCompositionContext(fragment, context),
  );

  if (matchingFragments.length === 0) {
    return { content: base, toolBindings: [] };
  }

  const adaptiveContext = [
    ADAPTIVE_MEMORY_SECTION_HEADING,
    "",
    ADAPTIVE_MEMORY_AUXILIARY_POLICY,
    "",
    ...matchingFragments.flatMap((fragment) => [fragment.markdown.trim(), ""]),
  ]
    .join("\n")
    .trimEnd();

  return {
    content: `${renderSddContextSections({
      officialContext: base,
      adaptiveContext,
    })}\n`,
    toolBindings: bundle.toolBindings,
  };
}

function matchesCompositionContext(
  fragment: MemoryInstructionFragment,
  context: AdaptiveMemoryCompositionContext,
): boolean {
  if (fragment.surface !== context.surface) return false;
  if (fragment.teamId !== undefined && fragment.teamId !== context.teamId) return false;
  if (
    fragment.agentIds !== undefined &&
    (context.agentId === undefined || !fragment.agentIds.includes(context.agentId))
  ) return false;
  if (
    fragment.skillIds !== undefined &&
    (context.skillId === undefined || !fragment.skillIds.includes(context.skillId))
  ) return false;
  return true;
}
