import { describe, expect, test } from "bun:test";

import {
  ADAPTIVE_CONTEXT_AUTHORITY_RULE,
  ADAPTIVE_CONTEXT_HEADING,
  EMPTY_ADAPTIVE_CONTEXT_NOTICE,
  OFFICIAL_CONTEXT_HEADING,
  renderDeveloperTeamContextAuthorityGuidance,
  renderSddContextSections,
} from "./adaptive-context-renderer";

describe("renderSddContextSections", () => {
  test("renders official and adaptive context in separate explicit sections", () => {
    const rendered = renderSddContextSections({
      officialContext: "Spec says the provider is advisory.",
      adaptiveContext: "User prefers concise summaries.",
    });

    expect(rendered).toContain(OFFICIAL_CONTEXT_HEADING);
    expect(rendered).toContain(ADAPTIVE_CONTEXT_HEADING);
    expect(rendered.indexOf(OFFICIAL_CONTEXT_HEADING)).toBeLessThan(
      rendered.indexOf(ADAPTIVE_CONTEXT_HEADING),
    );
    expect(rendered).toContain("Spec says the provider is advisory.");
    expect(rendered).toContain("User prefers concise summaries.");
  });

  test("includes authority rule that OpenSpec is authoritative and memory is advisory", () => {
    const rendered = renderSddContextSections({
      officialContext: "Official task list.",
      adaptiveContext: "Advisory memory.",
    });

    expect(rendered).toContain(ADAPTIVE_CONTEXT_AUTHORITY_RULE);
    expect(rendered).toMatch(/OpenSpec.*authoritative/i);
    expect(rendered).toMatch(/adaptive memory.*advisory/i);
    expect(rendered).toMatch(/must not modify specs/i);
  });

  test("handles empty adaptive context safely", () => {
    const rendered = renderSddContextSections({ officialContext: "Official spec only." });

    expect(rendered).toContain(OFFICIAL_CONTEXT_HEADING);
    expect(rendered).toContain(ADAPTIVE_CONTEXT_HEADING);
    expect(rendered).toContain(EMPTY_ADAPTIVE_CONTEXT_NOTICE);
  });

  test("renders custom adaptive unavailable reason", () => {
    const rendered = renderSddContextSections({
      officialContext: "Official spec only.",
      adaptiveContextUnavailableReason: "Provider health check failed; no memory loaded.",
    });

    expect(rendered).toContain("Provider health check failed; no memory loaded.");
  });

  test("renders Developer Team prompt guidance with section labels and authority rule", () => {
    const guidance = renderDeveloperTeamContextAuthorityGuidance();

    expect(guidance).toContain("Context Authority");
    expect(guidance).toContain("OFFICIAL CONTEXT");
    expect(guidance).toContain("ADAPTIVE CONTEXT");
    expect(guidance).toContain(ADAPTIVE_CONTEXT_AUTHORITY_RULE);
  });
});
