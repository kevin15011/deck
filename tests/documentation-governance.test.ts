import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const maintainedSurfaces = [
  "README.md",
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

function isSupportedDirectCommand(command: string): boolean {
  if (command === "bun install" || command === "bun test" || command === "bunx tsc --noEmit" || command === "deck --help" || command === "./dist/cli/deck --help") {
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
  if (!target) return false;

  const targetPath = resolve(root, target);
  const relativeTarget = targetPath.slice(root.length + 1);
  return relativeTarget === target && existsSync(targetPath) && statSync(targetPath).isFile();
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
  ["deck --help", true],
  ["bunx tsc --emit", false],
  ["deck unsupported-command", false],
] as const;

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
  test("maintained surfaces are non-empty and declare their role", () => {
    for (const file of maintainedSurfaces) {
      const text = content(file);
      expect(text.trim().length, `DOC_REQUIRED_ENTRY_POINT_INVALID: ${file} is empty`).toBeGreaterThan(0);
      for (const label of ["Audience:", "Authority:", "Maintainer:", "Evidence:"]) {
        expect(text, `DOC_REQUIRED_ENTRY_POINT_INVALID: ${file} lacks ${label}`).toContain(label);
      }
    }
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
    for (const file of [
      "packages/core/src/skills/external/content.generated.ts",
      "apps/cli/src/runtime/build-info.generated.ts",
    ]) {
      expect(content(file), `DOC_GENERATED_BOUNDARY_VIOLATED: ${file} lacks a generated ownership marker`).toMatch(/generated|do not edit/i);
    }
  });

  test("obsolete documentation snapshots remain absent", () => {
    for (const file of obsoleteSnapshots) {
      expect(existsSync(resolve(root, file)), `DOC_OBSOLETE_SNAPSHOT_PRESENT: ${file} must remain absent`).toBe(false);
    }
  });
});
