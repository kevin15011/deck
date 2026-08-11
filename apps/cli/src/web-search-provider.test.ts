import { describe, expect, test } from "bun:test";

import { getWebSearchProviderDescriptor, isSupportedWebSearchProvider, SUPPORTED_WEB_SEARCH_PROVIDER_IDS } from "./web-search-provider";

describe("CLI web-search provider composition", () => {
  test("currently accepts only the Tavily provider while Core remains opaque", () => {
    expect(SUPPORTED_WEB_SEARCH_PROVIDER_IDS).toEqual(["tavily"]);
    expect(isSupportedWebSearchProvider("tavily")).toBe(true);
    expect(isSupportedWebSearchProvider("future-provider")).toBe(false);
    expect(isSupportedWebSearchProvider(undefined)).toBe(false);
  });

  test("returns a typed descriptor only for the supported selection", () => {
    const descriptor = getWebSearchProviderDescriptor("tavily");
    expect(descriptor).toMatchObject({ providerId: "tavily", semanticServerId: "web-search" });
    expect(descriptor?.command).toEqual(["npx", "-y", "tavily-mcp@0.2.22"]);
    expect(getWebSearchProviderDescriptor("future-provider")).toBeUndefined();
    expect(getWebSearchProviderDescriptor(undefined)).toBeUndefined();
  });
});
