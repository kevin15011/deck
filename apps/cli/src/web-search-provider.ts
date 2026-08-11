import {
  TAVILY_PROVIDER_DESCRIPTOR,
  TAVILY_PROVIDER_ID,
} from "@deck/provider-tavily";

/** Provider implementations currently accepted by the CLI composition root. */
export const SUPPORTED_WEB_SEARCH_PROVIDER_IDS = Object.freeze([TAVILY_PROVIDER_ID] as const);

export type SupportedWebSearchProviderId = (typeof SUPPORTED_WEB_SEARCH_PROVIDER_IDS)[number];

export function isSupportedWebSearchProvider(
  provider: string | undefined,
): provider is SupportedWebSearchProviderId {
  return provider !== undefined
    && SUPPORTED_WEB_SEARCH_PROVIDER_IDS.includes(provider.trim() as SupportedWebSearchProviderId);
}

/** Resolve the reviewed descriptor without exposing credential values. */
export function getWebSearchProviderDescriptor(provider: string | undefined) {
  return isSupportedWebSearchProvider(provider) ? TAVILY_PROVIDER_DESCRIPTOR : undefined;
}
