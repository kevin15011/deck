import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type ForbiddenLiteral = {
  label: string;
  pattern: RegExp;
};

type PurityViolation = {
  file: string;
  line: number;
  literal: string;
  value: string;
};

const sourceExtensions = new Set([".ts", ".tsx"]);
const forbiddenLiterals: ForbiddenLiteral[] = [
  { label: "pi-mermaid", pattern: /\bpi-mermaid\b/i },
  { label: "pi", pattern: /\bpi\b/i },
  { label: "opencode", pattern: /\bopencode\b/i },
  { label: "engram", pattern: /\bengram\b/i },
  { label: "supermemory", pattern: /\bsupermemory\b/i },
];

// Allowlist of legitimate core identifiers that contain forbidden substrings
// but are NOT runtime references — they are canonical provider/model IDs,
// config field names, or enum values that are part of core's public API.
const ALLOWED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Provider/model IDs: "opencode-go" is a canonical provider ID in model catalog
  { pattern: /^"opencode-go"$/, reason: "canonical provider ID in model catalog" },
  { pattern: /^"openai-codex"$/, reason: "canonical provider ID in model catalog" },
  // Model IDs contain provider prefixes: "opencode-go/kimi-k2.6"
  { pattern: /^"opencode-go\/[^"]+"$/, reason: "canonical model ID in model catalog" },
  { pattern: /^"openai-codex\/[^"]+"$/, reason: "canonical model ID in model catalog" },
  // Provider display names (canonical names, not runtime references)
  { pattern: /^"OpenCode Go"$/, reason: "canonical provider display name" },
  // installKind enum values are part of core's public API contract
  { pattern: /^"pi-package"$/, reason: "installKind enum value in RunnerCapabilities" },
  { pattern: /^"opencode-plugin"$/, reason: "installKind enum value in RunnerCapabilities" },
  // Supermemory is a named adaptive memory provider; any string referencing it as
  // the named provider (not importing from it) is allowed in the config schema.
  { pattern: /^"supermemory"$/, reason: "named provider key in deck-config schema" },
  { pattern: /^"adaptiveMemory\.supermemory(?:\.[\w]+)?"$/, reason: "config path in deck-config schema" },
  { pattern: /^"Supermemory[^"]*"$/, reason: "named provider reference in config/validation messages" },
  { pattern: /`Invalid Supermemory[^`]*`/, reason: "named provider reference in error message template" },
  { pattern: /^"Deck config may not store Supermemory credentials\."$/, reason: "credential validation error message" },
  // Forbidden content reason string — explains why engram migration content is banned
  { pattern: /^"Engram migration payloads"$/, reason: "content classification label in governance rules" },
  // Provider labels in adaptive memory instruction content
  { pattern: /^"Provider: Supermemory"$/, reason: "provider label in adaptive memory instruction content" },
  { pattern: /^"Provider: Engram"$/, reason: "provider label in adaptive memory instruction content" },
  // Tool names in adaptive memory instruction content
  { pattern: /supermemory_memory/, reason: "Supermemory tool name in adaptive memory instruction content" },
  { pattern: /supermemory_recall/, reason: "Supermemory tool name in adaptive memory instruction content" },
  // Engram provider reference in adaptive memory instruction content
  { pattern: /`engram`/i, reason: "Engram provider reference in instruction content" },
  // OpenCode references in RTK instruction content about OpenCode hook
  { pattern: /--opencode/, reason: "RTK OpenCode hook flag in instruction content" },
  // Runner ID const arrays in deck-config.ts
  { pattern: /^"pi"$/, reason: "PACKAGE_INSTRUCTION_RUNNERS runner ID const" },
  { pattern: /^"opencode"$/, reason: "PACKAGE_INSTRUCTION_RUNNERS runner ID const" },
  // Runner-capability-registry.ts: capability IDs and catalog entries with runner/provider prefixes
  // These are SPEC-DEFINED catalog identifiers, not runtime references.
  // File path references to adapter-opencode in instruction content (historical example)
  { pattern: /packages\/adapter-opencode/, reason: "file path reference in instruction content example" },
  // Capability IDs: runner-prefixed identifiers in canonical capability registry
  { pattern: /^"pi-mermaid"$/, reason: "canonical capability ID with runner prefix in runner-capability-registry" },
  { pattern: /^"pi-orchestrator-prompt-persistence"$/, reason: "canonical capability ID with runner prefix" },
  { pattern: /^"pi-team-profile"$/, reason: "canonical capability ID with runner prefix" },
  { pattern: /^"opencode-primary-orchestrator"$/, reason: "canonical capability ID with runner prefix" },
  { pattern: /^"opencode-mermaid"$/, reason: "canonical capability ID with runner prefix" },
  { pattern: /^"supermemory-tool-bindings"$/, reason: "canonical capability ID" },
  // Capability display names: human-readable names with runner prefixes
  { pattern: /^"OpenCode Primary Orchestrator"$/, reason: "capability display name with runner prefix" },
  { pattern: /^"OpenCode Mermaid"$/, reason: "capability display name with runner prefix" },
  { pattern: /^"Pi Mermaid"$/, reason: "capability display name with runner prefix" },
  // Adapter sources: runner-prefixed adapter source identifiers
  { pattern: /^"opencode-mcp-config"$/, reason: "adapter source ID with runner prefix" },
  // Runner-capability-parity.ts: parity error codes (spec-defined gap identifiers)
  // Error codes embed runner names as gap identifiers, not runtime references
  { pattern: /^"pi-context-mode-mcp-missing"$/, reason: "parity error code with runner prefix" },
  { pattern: /^"pi-rtk-mapping-missing"$/, reason: "parity error code with runner prefix" },
  { pattern: /^"pi-supermemory-extra-gate-present"$/, reason: "parity error code with runner/provider prefix" },
  { pattern: /^"pi-serena-not-satisfied"$/, reason: "parity error code with runner prefix" },
  // Runner-adapter.ts: engram as model provider ID in RunnerModelProvider union
  { pattern: /^"engram"$/, reason: "model provider ID in RunnerModelProvider type" },
  // Runner capability parity gap descriptions (spec-authored content embedded in catalog)
  // These describe parity gaps for specific runners — spec-defined, not implementation references
  { pattern: /Serena is mandatory for Pi parity/, reason: "parity gap description referencing runner name" },
  { pattern: /parity with OpenCode/, reason: "parity gap description referencing runner name" },
  { pattern: /Pi parity/, reason: "parity gap description referencing runner name" },
  { pattern: /RTK via Bash hook in OpenCode/, reason: "parity gap notes referencing runner name" },
  { pattern: /Deck init is bundled with OpenCode/, reason: "capability notes referencing runner name" },
  { pattern: /OpenCode Mermaid renderer/, reason: "capability description referencing runner name" },
  { pattern: /Configure Supermemory MCP with valid credentials/, reason: "parity gap recommended action" },
  { pattern: /Shared binary plus local MCP config in ~\/\.pi\//, reason: "capability notes referencing pi home path" },
  // runner-capability-registry.ts: capability descriptions and notes with runner/provider names
  // These are spec-authored catalog descriptions, not implementation references
  { pattern: /wrapper @dreki-gg\/pi-context7/, reason: "capability description referencing pi wrapper package" },
  { pattern: /No Pi-only runtime gate/, reason: "capability description referencing pi runtime gate" },
  { pattern: /Pi Mermaid - internal runner-specific package/, reason: "capability description with runner name" },
  // adaptive-memory.ts: provider description strings in instruction content
  // These describe how to use named providers in agent sessions — spec-authored, not runtime
  { pattern: /When the configured memory provider is "engram"/, reason: "provider description in adaptive memory instruction" },
  { pattern: /When the configured memory provider is "supermemory"/, reason: "provider description in adaptive memory instruction" },
  // serena.ts: Serena-specific statement explaining why tools are disabled (OpenCode provides them)
  { pattern: /These tools are explicitly disabled because OpenCode or other packages handle them/, reason: "Serena instruction content explaining tool scope" },
];

const testDir = dirname(fileURLToPath(import.meta.url));
const coreSourceDir = join(testDir, "..");

function collectSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") {
        collectSourceFiles(entryPath, files);
      }
      continue;
    }

    if (!sourceExtensions.has(extname(entry.name))) {
      continue;
    }

    if (entry.name.includes(".test.")) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length))
    .replace(/(^|[^:])\/\/.*$/gm, (line, prefix) => prefix + " ".repeat(line.length - prefix.length));
}

function getLineNumber(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }

  return line;
}

function findStringLiterals(source: string): Array<{ value: string; index: number }> {
  const literals: Array<{ value: string; index: number }> = [];
  const stringLiteralPattern = /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;

  for (const match of source.matchAll(stringLiteralPattern)) {
    literals.push({ value: match[0], index: match.index ?? 0 });
  }

  return literals;
}

function findPurityViolations(): PurityViolation[] {
  const violations: PurityViolation[] = [];

  for (const file of collectSourceFiles(coreSourceDir)) {
    const source = stripComments(readFileSync(file, "utf8"));
    const relativeFile = relative(coreSourceDir, file);

    for (const literal of findStringLiterals(source)) {
      // Skip allowed patterns
      if (ALLOWED_PATTERNS.some((allowed) => allowed.pattern.test(literal.value))) {
        continue;
      }
      for (const forbidden of forbiddenLiterals) {
        if (forbidden.pattern.test(literal.value)) {
          violations.push({
            file: relativeFile,
            line: getLineNumber(source, literal.index),
            literal: forbidden.label,
            value: literal.value,
          });
        }
      }
    }
  }

  return violations;
}

describe("core purity audit", () => {
  test("non-test core source files do not contain concrete runner or provider string literals", () => {
    const violations = findPurityViolations();

    expect(
      violations.map((violation) =>
        `${violation.file}:${violation.line} contains ${violation.literal} in ${violation.value}`,
      ),
    ).toEqual([]);
  });
});
