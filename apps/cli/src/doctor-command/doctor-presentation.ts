/**
 * Doctor presentation model and formatter.
 *
 * Provides a pure function to convert DoctorDiagnosticsResult into
 * DoctorPresentationModel for consistent CLI/TUI rendering.
 *
 * Includes:
 * - Summary with counts by severity
 * - Ordered sections (Deck → Runtime → Memory → MCP → Binary → Runner Config)
 * - Truncation logic (max N items per category)
 * - Semantic tokens for icons/severity (not colors)
 */

import type {
  DoctorCategoryResult,
  DoctorDiagnosticsResult,
  DoctorPresentationModel,
  DoctorStatus,
  DoctorSummary,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATE_LIMIT = 10;

// ---------------------------------------------------------------------------
// Types for semantic tokens
// ---------------------------------------------------------------------------

export type IconToken = "✓" | "⚠" | "✗";

export interface SemanticToken {
  icon: IconToken;
  label: string;
  status: DoctorStatus;
}

// Semantic token mapping
const STATUS_TOKENS: Record<DoctorStatus, SemanticToken> = {
  ok: { icon: "✓", label: "OK", status: "ok" },
  warning: { icon: "⚠", label: "Warning", status: "warning" },
  error: { icon: "✗", label: "Error", status: "error" },
};

// ---------------------------------------------------------------------------
// Helper: Truncate items
// ---------------------------------------------------------------------------

interface TruncateResult<T> {
  displayed: T[];
  remaining: number;
}

/**
 * Truncate a list of items to max N, adding a count of remaining items.
 */
function truncateItems<T>(items: T[], limit: number = DEFAULT_TRUNCATE_LIMIT): TruncateResult<T> {
  if (items.length <= limit) {
    return { displayed: items, remaining: 0 };
  }
  return {
    displayed: items.slice(0, limit),
    remaining: items.length - limit,
  };
}

// ---------------------------------------------------------------------------
// Helper: Derive status from categories
// ---------------------------------------------------------------------------

function deriveStatusFromCategories(categories: DoctorCategoryResult[]): DoctorStatus {
  if (categories.some((c) => c.status === "error")) return "error";
  if (categories.some((c) => c.status === "warning")) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Main: Format result to presentation model
// ---------------------------------------------------------------------------

/**
 * Convert DoctorDiagnosticsResult to DoctorPresentationModel.
 * Pure function, no IO.
 *
 * @param result - The diagnostic result to format
 * @param options - Optional formatting options
 * @returns Presentation model for CLI/TUI rendering
 */
export function formatDoctorResult(
  result: DoctorDiagnosticsResult,
  options: { truncateLimit?: number } = {},
): DoctorPresentationModel {
  const limit = options.truncateLimit ?? DEFAULT_TRUNCATE_LIMIT;

  // Build ordered sections: Deck → Runtime → Memory → MCP → Binary → Runner Config
  const sections: DoctorCategoryResult[] = [];

  // Deck checks (manifest, state, config)
  if (result.deck && result.deck.length > 0) {
    for (const cat of result.deck) {
      const truncated = truncateItems(cat.items, limit);
      sections.push({
        ...cat,
        items: truncated.displayed,
      });
    }
  }

  // Runtime checks
  if (result.runtimes && result.runtimes.length > 0) {
    for (const rt of result.runtimes) {
      // Each runtime becomes a category
      const status = deriveStatusFromCategories(rt.checks);
      sections.push({
        category: rt.name,
        status,
        items: rt.checks.flatMap((c) => c.items).slice(0, limit),
      });
    }
  }

  // Memory providers
  if (result.memory && result.memory.length > 0) {
    for (const cat of result.memory) {
      const truncated = truncateItems(cat.items, limit);
      sections.push({
        ...cat,
        items: truncated.displayed,
      });
    }
  }

  // MCP configuration
  if (result.mcp && result.mcp.length > 0) {
    for (const cat of result.mcp) {
      const truncated = truncateItems(cat.items, limit);
      sections.push({
        ...cat,
        items: truncated.displayed,
      });
    }
  }

  // Binary validation
  if (result.binaryCheck && result.binaryCheck.length > 0) {
    for (const cat of result.binaryCheck) {
      const truncated = truncateItems(cat.items, limit);
      sections.push({
        ...cat,
        items: truncated.displayed,
      });
    }
  }

  // Runner config
  if (result.runnerConfig && result.runnerConfig.length > 0) {
    for (const cat of result.runnerConfig) {
      const truncated = truncateItems(cat.items, limit);
      sections.push({
        ...cat,
        items: truncated.displayed,
      });
    }
  }

  // Calculate or use existing summary
  let summary: DoctorSummary;
  if (result.summary) {
    summary = result.summary;
  } else {
    // Calculate from scratch
    let ok = 0;
    let warning = 0;
    let error = 0;

    const countCategories = (categories: DoctorCategoryResult[]) => {
      for (const cat of categories) {
        if (cat.status === "error") error++;
        else if (cat.status === "warning") warning++;
        else ok++;
      }
    };

    countCategories(result.deck ?? []);
    countCategories(result.binaryCheck ?? []);
    countCategories(result.runnerConfig ?? []);
    countCategories(result.memory ?? []);
    countCategories(result.mcp ?? []);

    for (const rt of result.runtimes ?? []) {
      if (rt.checks.some((c) => c.status === "error")) error++;
      else if (rt.checks.some((c) => c.status === "warning")) warning++;
      else ok++;
    }

    summary = {
      ok,
      warning,
      error,
      sections: sections.map((s) => s.category),
    };
  }

  return {
    summary,
    sections,
    hasCriticalErrors: result.hasCriticalErrors,
  };
}

// ---------------------------------------------------------------------------
// Helper: Format executive summary text
// ---------------------------------------------------------------------------

/**
 * Format executive summary as human-readable text.
 * Returns "All N checks passed" if all OK, or "✓ X ok ⚠ Y warnings ✗ Z errors"
 */
export function formatExecutiveSummary(model: DoctorPresentationModel): string {
  const { ok, warning, error } = model.summary;

  if (ok > 0 && warning === 0 && error === 0) {
    return `All ${ok} checks passed`;
  }

  const parts: string[] = [];
  if (ok > 0) parts.push(`✓ ${ok} ok`);
  if (warning > 0) parts.push(`⚠ ${warning} warnings`);
  if (error > 0) parts.push(`✗ ${error} errors`);

  return parts.join("  ");
}

// ---------------------------------------------------------------------------
// Helper: Get semantic token for status
// ---------------------------------------------------------------------------

/**
 * Get semantic token (icon + label) for a status.
 */
export function getSemanticToken(status: DoctorStatus): SemanticToken {
  return STATUS_TOKENS[status];
}

// ---------------------------------------------------------------------------
// Helper: Format truncated message
// ---------------------------------------------------------------------------

/**
 * Format items with truncation indication.
 * Returns original items if within limit, or "...and K more" appended.
 */
export function formatTruncatedItems<T extends { message?: string }>(
  items: T[],
  limit: number = DEFAULT_TRUNCATE_LIMIT,
): { items: T[]; truncated: boolean; remaining: number } {
  const { displayed, remaining } = truncateItems(items, limit);
  return {
    items: displayed,
    truncated: remaining > 0,
    remaining,
  };
}
