export const OFFICIAL_CONTEXT_HEADING = "## OFFICIAL CONTEXT";
export const ADAPTIVE_CONTEXT_HEADING = "## ADAPTIVE CONTEXT";

export const ADAPTIVE_CONTEXT_AUTHORITY_RULE =
  "RULE: OpenSpec artifacts and Spec Registry entries are authoritative; adaptive memory is advisory and must not modify specs, requirements, designs, tasks, or approved change history without explicit user action through the normal OpenSpec workflow.";

export const EMPTY_ADAPTIVE_CONTEXT_NOTICE =
  "Adaptive context was not loaded; continue with official OpenSpec context only.";

export type RenderSddContextSectionsOptions = {
  officialContext: string;
  adaptiveContext?: string | readonly string[];
  adaptiveContextUnavailableReason?: string;
  includeAuthorityRule?: boolean;
};

export function renderSddContextSections(options: RenderSddContextSectionsOptions): string {
  const officialContext = options.officialContext.trim();
  const adaptiveContext = normalizeAdaptiveContext(options.adaptiveContext);
  const adaptiveBody = adaptiveContext || options.adaptiveContextUnavailableReason || EMPTY_ADAPTIVE_CONTEXT_NOTICE;

  return [
    OFFICIAL_CONTEXT_HEADING,
    "",
    officialContext || "(No official context was provided.)",
    "",
    ADAPTIVE_CONTEXT_HEADING,
    "",
    options.includeAuthorityRule === false ? undefined : ADAPTIVE_CONTEXT_AUTHORITY_RULE,
    options.includeAuthorityRule === false ? undefined : "",
    adaptiveBody,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .trimEnd();
}

export function renderDeveloperTeamContextAuthorityGuidance(): string {
  return [
    "## Context Authority",
    "",
    `- Use \`${OFFICIAL_CONTEXT_HEADING.replace(/^## /, "")}\` for OpenSpec artifacts, Spec Registry entries, code, and tests that define the official state of the change.`,
    `- Use \`${ADAPTIVE_CONTEXT_HEADING.replace(/^## /, "")}\` only for advisory adaptive-memory content.`,
    `- ${ADAPTIVE_CONTEXT_AUTHORITY_RULE}`,
    "- If adaptive context is unavailable, continue with official context and state that adaptive context was not loaded.",
  ].join("\n");
}

function normalizeAdaptiveContext(adaptiveContext: string | readonly string[] | undefined): string {
  if (adaptiveContext === undefined) {
    return "";
  }

  if (typeof adaptiveContext === "string") {
    return adaptiveContext.trim();
  }

  return adaptiveContext
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n\n");
}
