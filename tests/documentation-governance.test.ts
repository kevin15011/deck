import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { parseArgs } from "../apps/cli/src/cli-args";
import { getBootstrapSkillFiles } from "../packages/core/src/skills/bootstrap";
import { STANDALONE_SKILLS } from "../packages/core/src/skills/external";
import { DEVELOPER_TEAM_AGENTS } from "../packages/core/src/teams/developer/catalog";

const root = process.cwd();
const productSurfaces = [
  "README.md",
  "docs/README.md",
  "docs/getting-started.md",
  "docs/runners.md",
  "docs/configuration.md",
  "docs/developer-team.md",
  "docs/skills.md",
  "docs/adaptive-memory.md",
  "docs/operations.md",
  "docs/project-workflows.md",
  "docs/troubleshooting.md",
  "docs/reference/cli.md",
  "docs/reference/support-matrix.md",
] as const;
const brandAssets = [
  "docs/assets/brand/deck-hero-dark.png",
  "docs/assets/brand/deck-hero-panel-background.png",
  "docs/assets/brand/deck-logo-horizontal-dark.png",
  "docs/assets/brand/deck-logo-horizontal-light.png",
  "docs/assets/brand/deck-logo-stacked-dark.png",
  "docs/assets/brand/deck-logo-stacked-light.png",
] as const;
const maintainedSurfaces = [
  ...productSurfaces,
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "docs/architecture.md",
  "docs/developer-team-execution.md",
  "docs/runner-support.md",
  "docs/maintainers/releasing.md",
  "docs/release-descriptor.md",
  ".agents/skills/deck-release-publish/SKILL.md",
  ".agents/skills/openspec-retrospective-audit/SKILL.md",
];
const canonicalFixtures = [
  "apps/cli/src/upgrade-command/__fixtures__/release-fixture.json",
  "apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-no-upgrade.json",
  "apps/cli/src/upgrade-command/__tests__/fixtures/release-fixture-upgrade.json",
];
const obsoleteSnapshots = [
  "docs/tool-references.md",
  "docs/prompt-methodology-modules.md",
  "docs/skills-integration-roadmap.md",
  "docs/deuda-tecnica.md",
  "docs/openspec-retrospective-audit-2026-06-12.md",
];

function content(path: string): string {
  const fullPath = resolve(root, path);
  expect(existsSync(fullPath), `DOC_REQUIRED_ENTRY_POINT_INVALID: ${path} is missing`).toBe(true);
  return readFileSync(fullPath, "utf8");
}


function isCanonicalDeckGitHubReference(reference: string): boolean {
  const match = reference.match(/^https:\/\/github\.com\/([^/]+)\/deck(?:[/?#]|$)/);
  return match?.[1] === "kevin15011";
}

function parseDeckCommand(command: string): string[] | undefined {
  const match = command.match(/^(?:deck|\.\/dist\/cli\/deck)(?:[ \t]+(.+))?$/);
  if (!match) return undefined;

  const args = match[1]?.trim();
  if (!args) return [];
  if (/[`$;|&<>]/.test(args)) return undefined;
  return args.split(/[ \t]+/);
}

function isNonEmptyCommandValue(value: string | undefined): value is string {
  return value !== undefined
    && value.length > 0
    && !value.startsWith("-")
    && !/[`$;|&<>]/.test(value);
}

function isNonEmptyEqualsFlag(flag: string, prefix: string): boolean {
  return flag.startsWith(prefix) && isNonEmptyCommandValue(flag.slice(prefix.length));
}

function isDocumentedRunnerId(value: string | undefined): value is "pi" | "opencode" {
  return value === "pi" || value === "opencode";
}

/**
 * Documentation intentionally accepts a finite, conservative command grammar.
 * The runtime parser has a few compatibility-permissive branches; examples in
 * maintained docs must not rely on those branches.
 */
function isDocumentedDeckCommandShape(args: string[]): boolean {
  const [first, ...rest] = args;

  if (first === "doctor" || first === "version") return rest.length === 0;

  if (first === "update" || first === "upgrade") {
    return rest.length <= 1 && rest.every((flag) => flag === "--yes" || flag === "-y");
  }

  if (first === "rollback") {
    let forceSeen = false;
    let backupSeen = false;
    for (let index = 0; index < rest.length; index += 1) {
      const flag = rest[index]!;
      if (flag === "--force") {
        if (forceSeen) return false;
        forceSeen = true;
        continue;
      }
      if (flag === "--backup" || flag === "--backup-id") {
        if (backupSeen || !isNonEmptyCommandValue(rest[index + 1])) return false;
        backupSeen = true;
        index += 1;
        continue;
      }
      if (isNonEmptyEqualsFlag(flag, "--backup=") || isNonEmptyEqualsFlag(flag, "--backup-id=")) {
        if (backupSeen) return false;
        backupSeen = true;
        continue;
      }
      return false;
    }
    return true;
  }

  if (first === "openspec") {
    if (rest[0] !== "validate") return false;
    const seen = new Set<string>();
    for (let index = 1; index < rest.length; index += 1) {
      const flag = rest[index]!;
      if (flag === "--json") {
        if (seen.has("json")) return false;
        seen.add("json");
        continue;
      }
      if (flag === "--change" || flag === "--root") {
        const key = flag.slice(2);
        if (seen.has(key) || !isNonEmptyCommandValue(rest[index + 1])) return false;
        seen.add(key);
        index += 1;
        continue;
      }
      if (isNonEmptyEqualsFlag(flag, "--change=") || isNonEmptyEqualsFlag(flag, "--root=")) {
        const key = flag.slice(2, flag.indexOf("="));
        if (seen.has(key)) return false;
        seen.add(key);
        continue;
      }
      return false;
    }
    return true;
  }

  if (first === "skill-registry") {
    const [subcommand, ...flags] = rest;
    if (subcommand !== "validate" && subcommand !== "discover" && subcommand !== "refresh") return false;
    let runnerSeen = false;
    let rootSeen = false;
    let jsonSeen = false;
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index]!;
      if (flag === "--json") {
        if (jsonSeen) return false;
        jsonSeen = true;
        continue;
      }
      if (flag === "--runner" || flag === "--root") {
        const key = flag === "--runner" ? "runner" : "root";
        const alreadySeen = key === "runner" ? runnerSeen : rootSeen;
        if (alreadySeen || !isNonEmptyCommandValue(flags[index + 1])) return false;
        if (key === "runner" && !isDocumentedRunnerId(flags[index + 1])) return false;
        if (key === "runner") runnerSeen = true;
        else rootSeen = true;
        index += 1;
        continue;
      }
      if (isNonEmptyEqualsFlag(flag, "--runner=") || isNonEmptyEqualsFlag(flag, "--root=")) {
        const key = flag.startsWith("--runner=") ? "runner" : "root";
        const alreadySeen = key === "runner" ? runnerSeen : rootSeen;
        if (alreadySeen) return false;
        if (key === "runner" && !isDocumentedRunnerId(flag.slice("--runner=".length))) return false;
        if (key === "runner") runnerSeen = true;
        else rootSeen = true;
        continue;
      }
      return false;
    }
    return subcommand === "refresh" || runnerSeen;
  }

  if (first === "pi") {
    if (rest[0] !== "developer") return false;
    let continueSeen = false;
    let resumeSeen = false;
    let memorySeen = false;
    for (const flag of rest.slice(1)) {
      if (flag === "--continue") {
        if (continueSeen) return false;
        continueSeen = true;
        continue;
      }
      if (flag === "--resume") {
        if (resumeSeen) return false;
        resumeSeen = true;
        continue;
      }
      if (/^--memory=(?:none|engram|supermemory)$/.test(flag)) {
        if (memorySeen) return false;
        memorySeen = true;
        continue;
      }
      return false;
    }
    return !(continueSeen && resumeSeen);
  }

  return false;
}

function isSupportedDirectCommand(command: string): boolean {
  if (command === "bun install" || command === "bun test" || command === "bunx tsc --noEmit") {
    return true;
  }
  if (new Set([
    "deck codex developer --dry-run",
    "deck codex developer --yes",
    "deck codex developer exec -- --your-prompt",
    "deck codex developer resume <session-id>",
    "deck codex developer resume --last",
    "deck doctor",
  ]).has(command)) return true;

  const target = command.match(/^bun test ((?:tests|packages|apps|scripts)(?:\/[\w-]+)*\/[\w-]+\.test\.(?:ts|tsx))$/)?.[1];
  if (target) {
    const targetPath = resolve(root, target);
    const relativeTarget = targetPath.slice(root.length + 1);
    return relativeTarget === target && existsSync(targetPath) && statSync(targetPath).isFile();
  }

  const args = parseDeckCommand(command);
  if (!args) return false;
  if (args.length === 0) return true;

  const supportedTopLevelCommands = new Set([
    "doctor",
    "version",
    "upgrade",
    "update",
    "rollback",
    "openspec",
    "skill-registry",
    "pi",
  ]);
  if (!supportedTopLevelCommands.has(args[0]!)) return false;
  if (!isDocumentedDeckCommandShape(args)) return false;

  const parsed = parseArgs(args);
  return parsed.command !== "error" && parsed.command !== "tui";
}


function extractDocumentedDirectCommands(text: string): string[] {
  const commands = new Set<string>();
  const pattern = /(?:^|`)\s*((?:bun test|bunx tsc|bun install|deck|\.\/dist\/cli\/deck)(?:[ \t]+[^`\n]+)?)(?=`|$)/gm;
  for (const match of text.matchAll(pattern)) {
    commands.add(match[1]!.trim());
  }
  return [...commands];
}


const directCommandExpectations = [
  ["bun test packages/core/src/teams/developer/git-safety.test.ts", true],
  ["bunx tsc --noEmit", true],
  ["deck", true],
  ["deck version", true],
  ["deck doctor", true],
  ["deck update --yes", true],
  ["deck rollback --backup backup-id", true],
  ["deck openspec validate --json --root .", true],
  ["deck skill-registry validate --runner pi", true],
  ["deck pi developer --memory=engram", true],
  ["deck --help", false],
  ["deck --version", false],
  ["./dist/cli/deck --help", false],
  ["bunx tsc --emit", false],
  ["deck unsupported-command", false],
] as const;

const malformedDocumentedCommandFixtures = [
  "deck pi developer --bogus",
  "deck pi developer --memory",
  "deck rollback --backup=",
  "deck openspec validate --root=",
  "deck update --yes=garbage",
  "deck skill-registry validate --runner claude",
  "deck skill-registry validate --runner=",
  "deck skill-registry validate --runner unknown",
  "deck update --yes --yes",
  "deck update -y -y",
  "deck upgrade --yes -y",
] as const;

function sectionBetween(text: string, startHeading: string, endHeading?: string): string {
  const start = text.indexOf(startHeading);
  expect(start, `DOC_GOVERNANCE_SECTION_MISSING: ${startHeading}`).toBeGreaterThanOrEqual(0);
  const remainder = text.slice(start + startHeading.length);
  const end = endHeading ? remainder.indexOf(endHeading) : -1;
  return end >= 0 ? remainder.slice(0, end) : remainder;
}

function extractFirstColumnIds(section: string): string[] {
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]!);
}

function productDocumentation(): string {
  return productSurfaces.map((file) => content(file)).join("\n");
}

describe("documentation governance predicates", () => {
  test("recognizes only canonical Deck GitHub references", () => {
    expect(isCanonicalDeckGitHubReference("https://github.com/kevin15011/deck/releases")).toBe(true);
    expect(isCanonicalDeckGitHubReference("https://github.com/example/deck/releases")).toBe(false);
  });

  test("recognizes only finite supported direct command forms", () => {
    for (const [command, expected] of directCommandExpectations) {
      expect(isSupportedDirectCommand(command)).toBe(expected);
    }
  });

  test("rejects malformed public command fixtures", () => {
    for (const command of malformedDocumentedCommandFixtures) {
      expect(isSupportedDirectCommand(command), `DOC_COMMAND_UNSUPPORTED: ${command}`).toBe(false);
    }
  });

  test("extracts inline direct commands and rejects unsupported mutations", () => {
    const invalidInlineCommands = [
      "bunx tsc --emit",
      "bun test --watch",
      "bun test tests/missing.test.ts",
      "bun test tests/documentation-governance.test.ts --watch",
      "bun test tests/documentation-governance.test.ts packages/core/src/teams/developer/git-safety.test.ts",
      "bun test tests/../tests/documentation-governance.test.ts",
      "bun test tests",
      "bun test package.json",
      "bun test tests/documentation-governance.ts",
    ];
    const extractedCommands = extractDocumentedDirectCommands(
      `Invalid inline commands: ${invalidInlineCommands.map((command) => `\`${command}\``).join(", ")}.`,
    );

    expect(extractedCommands).toEqual(invalidInlineCommands);
    for (const command of extractedCommands) {
      expect(isSupportedDirectCommand(command)).toBe(false);
    }

    const documentedCommands = extractDocumentedDirectCommands(content("CONTRIBUTING.md"));
    const documentedTestCommand = "bun test tests/documentation-governance.test.ts";
    expect(documentedCommands).toContain(documentedTestCommand);
    expect(isSupportedDirectCommand(documentedTestCommand)).toBe(true);
  });
});

describe("documentation governance", () => {
  test("product entry points reference the maintained Deck brand assets", () => {
    const readme = content("README.md");
    expect(readme).toContain("![Deck command deck with modular signal paths and a reserved runner panel](docs/assets/brand/deck-hero-dark.png)");

    const docsHub = content("docs/README.md");
    expect(docsHub).toContain('srcset="assets/brand/deck-logo-horizontal-light.png"');
    expect(docsHub).toContain('srcset="assets/brand/deck-logo-horizontal-dark.png"');
    expect(docsHub).toContain('alt="Deck"');

    for (const file of brandAssets) {
      const fullPath = resolve(root, file);
      expect(existsSync(fullPath), `DOC_BRAND_ASSET_MISSING: ${file}`).toBe(true);
      expect(statSync(fullPath).isFile(), `DOC_BRAND_ASSET_INVALID: ${file} is not a file`).toBe(true);

      const bytes = readFileSync(fullPath);
      expect(bytes.byteLength, `DOC_BRAND_ASSET_INVALID: ${file} is empty`).toBeGreaterThan(8);
      expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `DOC_BRAND_ASSET_INVALID: ${file} is not a PNG`).toBe(true);
    }
  });

  test("README keeps the product narrative before governance metadata", () => {
    const text = content("README.md");
    expect(text.trimStart().startsWith("# Deck")).toBe(true);
    const narrative = text.indexOf("## Choose your next move");
    expect(narrative, "DOC_REQUIRED_ENTRY_POINT_INVALID: README lacks product navigation").toBeGreaterThanOrEqual(0);
    for (const label of ["Audience:", "Authority:", "Maintainer:", "Evidence:"]) {
      expect(text.indexOf(label), `DOC_ORDER_INVALID: README ${label} precedes product narrative`).toBeGreaterThan(narrative);
    }
  });

  test("maintained surfaces are non-empty and declare their role", () => {
    for (const file of maintainedSurfaces) {
      const text = content(file);
      expect(text.trim().length, `DOC_REQUIRED_ENTRY_POINT_INVALID: ${file} is empty`).toBeGreaterThan(0);
      for (const label of ["Audience:", "Authority:", "Maintainer:", "Evidence:"]) {
        expect(text, `DOC_REQUIRED_ENTRY_POINT_INVALID: ${file} lacks ${label}`).toContain(label);
      }
    }
  });

  test("product inventories stay synchronized with source catalogs", () => {
    const teamText = content("docs/developer-team.md");
    const documentedRoles = extractFirstColumnIds(sectionBetween(teamText, "## Role inventory", "## Adaptive routing"));
    expect(documentedRoles).toEqual(DEVELOPER_TEAM_AGENTS.map((agent) => agent.id));

    const skillsText = content("docs/skills.md");
    const lifecycleSection = sectionBetween(skillsText, "## Lifecycle skills", "## Bundled external skills");
    expect(extractFirstColumnIds(lifecycleSection)).toEqual(getBootstrapSkillFiles().map((skill) => skill.skillId));

    const externalSection = sectionBetween(skillsText, "## Bundled external skills", "## Project-local skills");
    expect(extractFirstColumnIds(externalSection).sort()).toEqual(STANDALONE_SKILLS.map((skill) => skill.skillId).sort());
  });

  test("product documentation preserves explicit support boundaries", () => {
    const text = productDocumentation();

    expect(text).not.toMatch(/\bpi-hud\b/i);
    expect(text).not.toMatch(/\b(?:uninstall|uninstallation)\b/i);
    expect(text).not.toMatch(/\b(?:spec-driven-development|planning-and-task-breakdown|incremental-implementation|context-engineering|source-driven-development|browser-testing-with-devtools)\b/i);
    expect(text).not.toMatch(/\b(?:Claude|Codex)\b[^.\n]*(?:is|are)\s+(?:an?\s+)?(?:operational|supported|first-class)\b/i);
    expect(text).not.toMatch(/\b(?:supports?|install(?:s|ed)?|launch(?:es|ed)?|configure(?:s|d)?)\s+(?:Claude|Codex)\b/i);
    expect(text).not.toMatch(/\bautomatic(?:ally)?\s+(?:routes?|loads?|invokes?|activates?)\s+(?:all|every)\s+(?:\d+\s+)?(?:bundled\s+)?external\s+skills\b/i);
  });

  test("maintained relative Markdown links resolve", () => {
    for (const file of maintainedSurfaces) {
      const text = content(file);
      for (const match of text.matchAll(/\[[^\]]+\]\(([^)#?]+)(?:[?#][^)]*)?\)/g)) {
        const target = match[1]!;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
        expect(existsSync(resolve(root, file, "..", target)), `DOC_LINK_UNRESOLVED: ${file} -> ${target}`).toBe(true);
      }
    }
  });

  test("documented bun run commands are supported", () => {
    const scripts = Object.keys(JSON.parse(content("package.json")).scripts as Record<string, string>);
    for (const file of maintainedSurfaces) {
      const text = content(file);
      for (const match of text.matchAll(/\bbun run ([\w:./-]+)/g)) {
        const command = match[1]!;
        const supported = command.includes("/") || command.endsWith(".ts")
          ? existsSync(resolve(root, command))
          : scripts.includes(command);
        expect(supported, `DOC_COMMAND_UNSUPPORTED: ${file} -> bun run ${command}`).toBe(true);
      }
    }
  });

  test("documented direct commands use finite supported forms", () => {
    for (const file of maintainedSurfaces) {
      const text = content(file);
      for (const command of extractDocumentedDirectCommands(text)) {
        expect(isSupportedDirectCommand(command), `DOC_COMMAND_UNSUPPORTED: ${file} -> ${command}`).toBe(true);
      }
    }
  });

  test("maintained references and canonical fixtures use the canonical repository identity", () => {
    for (const file of [...maintainedSurfaces, ...canonicalFixtures]) {
      const text = content(file);
      for (const match of text.matchAll(/https:\/\/github\.com\/[^/\s)]+\/deck(?:[/?#][^\s)]*)?/g)) {
        const reference = match[0]!;
        expect(isCanonicalDeckGitHubReference(reference), `DOC_IDENTITY_NONCANONICAL: ${file} -> ${reference}`).toBe(true);
      }
    }
  });

  test("generated outputs retain ownership markers without being regenerated", () => {
    const requiredGeneratedFile = "packages/core/src/skills/external/content.generated.ts";
    const requiredPath = resolve(root, requiredGeneratedFile);
    expect(existsSync(requiredPath), `DOC_GENERATED_BOUNDARY_VIOLATED: ${requiredGeneratedFile} is missing`).toBe(true);
    if (existsSync(requiredPath)) {
      expect(readFileSync(requiredPath, "utf8"), `DOC_GENERATED_BOUNDARY_VIOLATED: ${requiredGeneratedFile} lacks a generated ownership marker`).toMatch(/generated|do not edit/i);
    }

    const optionalGeneratedFile = "apps/cli/src/runtime/build-info.generated.ts";
    const optionalPath = resolve(root, optionalGeneratedFile);
    if (existsSync(optionalPath)) {
      expect(readFileSync(optionalPath, "utf8"), `DOC_GENERATED_BOUNDARY_VIOLATED: ${optionalGeneratedFile} lacks a generated ownership marker`).toMatch(/generated|do not edit/i);
    }
  });

  test("obsolete documentation snapshots remain absent", () => {
    for (const file of obsoleteSnapshots) {
      expect(existsSync(resolve(root, file)), `DOC_OBSOLETE_SNAPSHOT_PRESENT: ${file} must remain absent`).toBe(false);
    }
  });
});
