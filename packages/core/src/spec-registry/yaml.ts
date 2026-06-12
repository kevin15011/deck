/**
 * YAML parser adapter with tolerant error handling.
 *
 * Encapsulates the yaml npm package and normalizes parse diagnostics
 * into a consistent DTO format for the validator.
 */

import { parse, parseDocument, YAMLParseError } from "yaml";

/**
 * Severity level for parser diagnostics.
 */
export type YamlDiagnosticSeverity = "error" | "warning";

/**
 * Diagnostic issue from YAML parsing.
 */
export type YamlDiagnostic = {
  severity: YamlDiagnosticSeverity;
  code: "yaml.parse_error" | "yaml.parse_warning" | "yaml.duplicate_key";
  message: string;
  line?: number;
  column?: number;
};

/**
 * Result of parsing a YAML document.
 */
export type ParsedYamlDocument = {
  /** Whether the document parsed successfully. */
  ok: boolean;
  /** The parsed document as a plain object, undefined if parse failed. */
  data?: unknown;
  /** List of diagnostics (errors and warnings) from parsing. */
  diagnostics: YamlDiagnostic[];
};

/**
 * Parse a YAML string into a document.
 *
 * This function is tolerant: malformed YAML produces a result with
 * `ok: false` and a diagnostic, not an uncaught exception.
 */
export function parseYaml(source: string): ParsedYamlDocument {
  const diagnostics: YamlDiagnostic[] = [];

  try {
    const doc = parseDocument(source);

    if (doc.errors.length > 0) {
      for (const err of doc.errors) {
        diagnostics.push({
          severity: "error",
          code: "yaml.parse_error",
          message: err.message,
          line: err.linePos?.[0]?.line,
          column: err.linePos?.[0]?.col,
        });
      }
    }

    if (doc.warnings.length > 0) {
      for (const warn of doc.warnings) {
        diagnostics.push({
          severity: "warning",
          code: "yaml.parse_warning",
          message: warn.message,
          line: warn.linePos?.[0]?.line,
          column: warn.linePos?.[0]?.col,
        });
      }
    }

    // Check for duplicate keys by inspecting the AST
    const duplicates = findDuplicateKeys(doc);
    for (const dup of duplicates) {
      diagnostics.push({
        severity: "warning",
        code: "yaml.duplicate_key",
        message: `Duplicate key found: "${dup}"`,
      });
    }

    const hasErrors = diagnostics.some((d) => d.severity === "error");

    return {
      ok: !hasErrors,
      data: hasErrors ? undefined : doc.toJS(),
      diagnostics,
    };
  } catch (err) {
    // Unexpected error — wrap it as a diagnostic
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      data: undefined,
      diagnostics: [
        {
          severity: "error",
          code: "yaml.parse_error",
          message: `Unexpected parse error: ${message}`,
        },
      ],
    };
  }
}

/**
 * Simple wrapper that returns the parsed object or throws on error.
 * Use this when you want the caller to handle errors explicitly.
 */
export function parseYamlSync(source: string): unknown {
  return parse(source);
}

/**
 * Find duplicate keys in a YAML document by walking the AST.
 */
function findDuplicateKeys(doc: ReturnType<typeof parseDocument>): string[] {
  const duplicates: string[] = [];

  // Walk the AST to find mapping keys
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;

    const n = node as { type?: string; key?: string; value?: unknown; items?: unknown[] };

    if (n.type === "MAP") {
      // Each MAP node gets its own seen Set for per-map scoping
      const seen = new Set<string>();
      // Check for duplicate keys in this map
      const items = n.items as Array<{ key: { value: string } }> | undefined;
      if (items) {
        for (const item of items) {
          if (item.key && typeof item.key === "object") {
            const keyValue = (item.key as { value: string }).value;
            if (seen.has(keyValue)) {
              if (!duplicates.includes(keyValue)) {
                duplicates.push(keyValue);
              }
            } else {
              seen.add(keyValue);
            }
          }
        }
      }
    }

    // Recurse into children
    if (Array.isArray(n.items)) {
      for (const item of n.items) {
        walk(item);
      }
    }
    if (n.value) {
      walk(n.value);
    }
  }

  // The root of a parsed document is a YAML.YMap
  const root = doc.contents;
  if (root) {
    walk(root);
  }

  return duplicates;
}