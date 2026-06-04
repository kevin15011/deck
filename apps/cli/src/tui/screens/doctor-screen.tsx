import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";

import { runDoctorDiagnostics } from "../../doctor-command/doctor-diagnostics";
import { formatDoctorResult, formatExecutiveSummary } from "../../doctor-command/doctor-presentation";
import type { DoctorCategoryResult, DoctorCheckItem, DoctorDiagnosticsResult, DoctorRuntimeResult, DoctorStatus, DoctorPresentationModel } from "../../doctor-command/types";

type DoctorScreenProps = {
  // No props — standalone screen
};

const STATUS_ICON: Record<DoctorStatus, string> = {
  ok: "✓",
  warning: "⚠",
  error: "✗",
};

const STATUS_COLOR: Record<DoctorStatus, "green" | "yellow" | "red"> = {
  ok: "green",
  warning: "yellow",
  error: "red",
};

const SECTION_ORDER = [
  "Manifest",
  "State",
  "Deck Config",
  "Binaries",
  "Runner Config",
  "Memory",
  "MCP",
];

function CheckItem({ item }: { item: DoctorCheckItem }) {
  const icon = STATUS_ICON[item.status] ?? "?";
  const color = STATUS_COLOR[item.status] ?? "red";
  const showSuggestion = item.suggestion && item.status !== "ok";

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text color={color}>
        {icon} {item.message}
      </Text>
      {showSuggestion ? (
        <Text dimColor>  {item.suggestion}</Text>
      ) : null}
    </Box>
  );
}

function CategorySection({ category }: { category: DoctorCategoryResult }) {
  const icon = STATUS_ICON[category.status] ?? "?";
  const color = STATUS_COLOR[category.status] ?? "red";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color}>
        {icon} {category.category}
      </Text>
      {category.items.map((item, i) => (
        <CheckItem key={`${category.category}-${i}-${item.message}`} item={item} />
      ))}
    </Box>
  );
}

function RuntimeSection({ runtime }: { runtime: DoctorRuntimeResult }) {
  const versionLabel = runtime.version && runtime.version !== "unknown" ? ` v${runtime.version}` : "";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{runtime.name}{versionLabel}</Text>
      {runtime.checks.map((category, i) => (
        <CategorySection key={`${runtime.name}-${i}-${category.category}`} category={category} />
      ))}
    </Box>
  );
}

function DiagnosticsReport({ result }: { result: DoctorDiagnosticsResult }) {
  const hasContent =
    result.runtimes.length > 0 || result.memory.length > 0 || result.mcp.length > 0 ||
    (result.deck?.length ?? 0) > 0 || (result.binaryCheck?.length ?? 0) > 0 || (result.runnerConfig?.length ?? 0) > 0;

  if (!hasContent) {
    return (
      <Text dimColor>No diagnostic results found.</Text>
    );
  }

  // Use presentation model for ordered sections
  const presentation = formatDoctorResult(result);

  return (
    <Box flexDirection="column">
      {/* Executive summary at top */}
      {presentation.summary ? (
        <Box marginBottom={1}>
          <Text bold>
            {presentation.summary.error > 0
              ? `✗ ${presentation.summary.error} errors`
              : presentation.summary.warning > 0
                ? `⚠ ${presentation.summary.warning} warnings`
                : `✓ All OK`}
          </Text>
        </Box>
      ) : null}

      {/* Deck checks (Manifest, State, Config) */}
      {result.deck && result.deck.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Deck Installation</Text>
          {result.deck.map((category, i) => (
            <CategorySection key={`deck-${i}-${category.category}`} category={category} />
          ))}
        </Box>
      ) : null}

      {result.runtimes.length > 0 ? (
        <Box flexDirection="column">
          <Text bold underline>Runtimes</Text>
          {result.runtimes.map((runtime, i) => (
            <RuntimeSection key={`runtime-${i}-${runtime.name}`} runtime={runtime} />
          ))}
        </Box>
      ) : null}

      {result.memory.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Memory</Text>
          {result.memory.map((category, i) => (
            <CategorySection key={`memory-${i}-${category.category}`} category={category} />
          ))}
        </Box>
      ) : null}

      {result.mcp.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>MCP</Text>
          {result.mcp.map((category, i) => (
            <CategorySection key={`mcp-${i}-${category.category}`} category={category} />
          ))}
        </Box>
      ) : null}

      {/* Binary validation */}
      {result.binaryCheck && result.binaryCheck.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Binary Validation</Text>
          {result.binaryCheck.map((category, i) => (
            <CategorySection key={`binary-${i}-${category.category}`} category={category} />
          ))}
        </Box>
      ) : null}

      {/* Runner config */}
      {result.runnerConfig && result.runnerConfig.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Runner Configuration</Text>
          {result.runnerConfig.map((category, i) => (
            <CategorySection key={`runner-${i}-${category.category}`} category={category} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function DoctorScreen(_props: DoctorScreenProps) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<DoctorDiagnosticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    runDoctorDiagnostics()
      .then((diagnostics) => {
        if (cancelled) return;
        setResult(diagnostics);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Compute executive summary for display
  const summaryText = result
    ? formatExecutiveSummary(formatDoctorResult(result))
    : null;

  return (
    <Box flexDirection="column">
      {/* Executive summary at top - prominent */}
      {summaryText && result && (
        <Box marginBottom={1}>
          <Text bold color={result.hasCriticalErrors ? "red" : "green"}>
            {summaryText}
          </Text>
        </Box>
      )}

      {result?.hasCriticalErrors ? (
        <Text color="red" bold>
          ⚠ Critical issues detected — review the report below.
        </Text>
      ) : null}

      {error ? (
        <Text color="red">Error: {error}</Text>
      ) : loading ? (
        <Box flexDirection="column">
          <Text color="cyan">Running diagnostics...</Text>
          <Text dimColor>Checking your environment configuration.</Text>
        </Box>
      ) : result ? (
        <DiagnosticsReport result={result} />
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>Press Enter or Esc to return to Home.</Text>
      </Box>
    </Box>
  );
}