export type AdaptiveMemorySurface = "session" | "agent" | "skill";

export type MemoryCapability =
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
  buildInjection(context: AdaptiveMemoryBuildContext): MemoryInjectionBundle;
};

export type AdaptiveMemoryCompositionResult = {
  content: string;
  toolBindings: readonly MemoryToolBinding[];
};

export type MemoryDiagnostic = {
  code: "unsupported_memory_provider" | "memory_provider_unavailable";
  message: string;
  providerId?: string;
};

export type ResolveMemoryInjectionOptions = {
  /** A pre-built memory injection bundle (trusted/internal; takes precedence over provider). */
  memoryInjection?: MemoryInjectionBundle;
  /** A memory provider that will build the injection bundle. Ignored if memoryInjection is set. */
  memoryProvider?: AdaptiveMemoryProvider;
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
 *
 * Core intentionally does not name or register concrete providers. Callers that
 * accept provider objects must inject their supported provider IDs through
 * `supportedProviderIds`; otherwise provider resolution rejects by default.
 *
 * Resolution priority:
 * 1. If `memoryInjection` is provided, use it directly (trusted/internal path).
 * 2. If `memoryProvider` is provided and its ID is not in the injected registry,
 *    return an `unsupported_memory_provider` diagnostic and no bundle.
 * 3. If `memoryProvider.buildInjection()` throws, return a
 *    `memory_provider_unavailable` diagnostic and no bundle.
 * 4. Otherwise return the bundle from buildInjection.
 */
export function resolveMemoryInjection(
  options?: ResolveMemoryInjectionOptions,
): { bundle: MemoryInjectionBundle | undefined; diagnostics: MemoryDiagnostic[] } {
  const diagnostics: MemoryDiagnostic[] = [];

  if (!options) return { bundle: undefined, diagnostics };
  if (options.memoryInjection) return { bundle: options.memoryInjection, diagnostics };
  if (!options.memoryProvider) return { bundle: undefined, diagnostics };

  const provider = options.memoryProvider;
  const supportedProviderIds = new Set(options.supportedProviderIds ?? []);

  // Validate provider ID against the caller-injected registry (REQ-AMI-003).
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
    // No matching fragments: do not inject any tool bindings for this surface.
    // Tool bindings are only propagated when at least one instruction fragment
    // matches the target surface, ensuring bindings are scoped to surfaces that
    // actually receive memory guidance.
    return { content: base, toolBindings: [] };
  }

  const section = [
    ADAPTIVE_MEMORY_SECTION_HEADING,
    "",
    ADAPTIVE_MEMORY_AUXILIARY_POLICY,
    "",
    ...matchingFragments.flatMap((fragment) => [fragment.markdown.trim(), ""]),
  ]
    .join("\n")
    .trimEnd();

  return {
    content: `${base.trimEnd()}\n\n${section}\n`,
    toolBindings: bundle.toolBindings,
  };
}

function matchesCompositionContext(
  fragment: MemoryInstructionFragment,
  context: AdaptiveMemoryCompositionContext,
): boolean {
  if (fragment.surface !== context.surface) {
    return false;
  }

  if (fragment.teamId !== undefined && fragment.teamId !== context.teamId) {
    return false;
  }

  if (
    fragment.agentIds !== undefined &&
    (context.agentId === undefined || !fragment.agentIds.includes(context.agentId))
  ) {
    return false;
  }

  if (
    fragment.skillIds !== undefined &&
    (context.skillId === undefined || !fragment.skillIds.includes(context.skillId))
  ) {
    return false;
  }

  return true;
}
