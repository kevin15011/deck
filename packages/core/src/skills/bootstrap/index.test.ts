import { describe, expect, test } from "bun:test";

import { getBootstrapSkillFiles } from "./index";

import { DECK_PREPARATION_AUTHORITY_BOUNDARY_V1 } from "../../teams/developer/readiness-authority";
import {
  DECK_INIT_COMPACT_AGENT_BODY,
  DECK_INIT_COMPACT_SKILL_BODY,
} from "../../teams/developer/bootstrap-compact-content";

const COMPONENT_ORDER = [
  "Root and authority precondition",
  "OpenSpec",
  "Skill Registry",
  "Codebase index",
  "Serena project state",
  "Analogous configured capabilities",
  "Owned ignore contributions",
] as const;

function countOccurrences(content: string, fragment: string): number {
  return content.split(fragment).length - 1;
}

function expectOrdered(content: string, markers: readonly string[]): void {
  let cursor = -1;
  for (const marker of markers) {
    const next = content.indexOf(marker, cursor + 1);
    expect(next, `expected ordered marker: ${marker}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function exercisePreparationComposition(
  content: string,
  input: {
    authorityValid: boolean;
    openSpec: "ready" | "changed" | "unchanged" | "blocked";
    registry: "ready" | "changed" | "unchanged" | "unavailable";
    optionalCapability: "ready" | "changed" | "unchanged" | "unavailable" | "skipped";
  },
): { preparationStatus: "completed" | "partial" | "blocked"; continueToTriage: boolean; nextAction?: "existing-tui" } {
  expectOrdered(content, COMPONENT_ORDER);
  expect(countOccurrences(content, DECK_PREPARATION_AUTHORITY_BOUNDARY_V1)).toBe(1);
  if (!input.authorityValid || input.openSpec === "blocked") {
    return { preparationStatus: "blocked", continueToTriage: false };
  }
  if (input.registry === "unavailable" || input.optionalCapability === "unavailable") {
    return {
      preparationStatus: "partial",
      continueToTriage: true,
      nextAction: "existing-tui",
    };
  }
  return { preparationStatus: "completed", continueToTriage: true };
}

function parseFrontmatter(content: string): unknown {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  expect(match, "expected YAML frontmatter block").not.toBeNull();
  return Bun.YAML.parse(match?.[1] ?? "");
}

function getDeckInitContent(): string {
  const file = getBootstrapSkillFiles().find(
    (entry) => entry.relativePath === "deck-init/SKILL.md",
  );

  expect(file).toBeDefined();
  return file?.content ?? "";
}

describe("bootstrap skill registry", () => {
  test("returns exactly the deck-init and deck-onboard skill files", () => {
    const files = getBootstrapSkillFiles();
    expect(files.map((file) => file.relativePath).sort()).toEqual([
      "deck-init/SKILL.md",
      "deck-onboard/SKILL.md",
    ]);
    for (const file of files) expect(file.relativePath).not.toContain("..");
  });

  test("preserves delegate-only deck-init frontmatter", () => {
    const frontmatter = parseFrontmatter(getDeckInitContent()) as Record<string, unknown>;
    expect(frontmatter.name).toBe("deck-init");
    expect(frontmatter["user-invocable"]).toBe(false);
    expect(frontmatter["disable-model-invocation"]).toBe(true);
    expect((frontmatter.metadata as Record<string, unknown>).delegate_only).toBe(true);
  });

  test("composes the exact preparation authority once on every deck-init surface", () => {
    for (const content of [
      getDeckInitContent(),
      DECK_INIT_COMPACT_AGENT_BODY,
      DECK_INIT_COMPACT_SKILL_BODY,
    ]) {
      expect(countOccurrences(content, DECK_PREPARATION_AUTHORITY_BOUNDARY_V1)).toBe(1);
    }
    expect(new Bun.CryptoHasher("sha256").update(DECK_PREPARATION_AUTHORITY_BOUNDARY_V1).digest("hex"))
      .toBe("1ad0630420b0955f70bf1f601aa06ba48b9d7602f72d4a300f6da426df987766");
  });

  test("defines the deterministic seven-component order without a global early return", () => {
    for (const content of [
      getDeckInitContent(),
      DECK_INIT_COMPACT_AGENT_BODY,
      DECK_INIT_COMPACT_SKILL_BODY,
    ]) {
      expectOrdered(content, COMPONENT_ORDER);
      expect(content).toContain("later independent components");
      expect(content).toContain("at most once per preparation invocation");
      expect(content).toContain("read-only postcondition");
      expect(content).not.toContain("return `already-initialized` without");
      expect(content).not.toContain("stop with `already-initialized`");
    }
  });

  test("reuses the complete Skill Registry lifecycle and sole writer", () => {
    const content = getDeckInitContent();
    expect(content).toContain("status `ready` -> `unchanged`");
    expect(content).toContain("status `missing` -> existing `migration`");
    expect(content).toContain("status `stale | invalid | indeterminate` -> existing `regeneration`");
    expect(content).toContain("SkillRegistryWriterV1");
    expect(content).toContain("complete current source set immediately before write");
    expect(content).toContain("compare-and-swap");
    expect(content).toContain("atomic replacement");
    expect(content).toContain("prior-valid bytes");
    expect(content).not.toContain("Scan standard skill locations");
  });

  test("uses only active-runner project-local capability operations", () => {
    const content = getDeckInitContent();
    expect(content).toContain("only `index_repository`");
    expect(content).toContain("active runner's declared project onboarding operation");
    expect(content).toContain("no project initializer");
    expect(content).toContain("detector-only or instruction-only");
    expect(content).not.toContain("guessed Serena CLI");
    expect(content).not.toContain("language-server installation");
  });

  test("defines truthful component and overall status aggregation", () => {
    const content = getDeckInitContent();
    for (const status of ["ready", "changed", "unchanged", "unavailable", "skipped", "blocked"]) {
      expect(content).toContain(`\`${status}\``);
    }
    expect(content).toContain("enabled but absent or unusable");
    expect(content).toContain("not enabled, not applicable, has no project initializer, or is dependency-blocked");
    expect(content).toContain("`completed | partial | blocked`");
    expect(content).toContain("existing TUI installation/configuration flow");
    expect(content).toContain("no routine success message or pause");
  });

  test("preserves narrow ownership-safe ignore reconciliation", () => {
    const content = getDeckInitContent();
    for (const marker of [
      "exact normalized root-contained artifact",
      "machine-local/non-versionable",
      "not tracked",
      "existing regular UTF-8 file, not a symlink",
      "compare-and-swap commit time",
      "preserving all existing bytes, comments, blank lines, and ordering",
    ]) expect(content).toContain(marker);
    expect(content).toContain("Never remove, reorder, normalize, broaden, untrack, or invoke Git");
    expect(content).not.toContain("blanket `/.serena/`");
    expect(content).not.toContain("blanket `/.codebase-memory/`");
  });

  test("returns only a bounded internal handoff and telemetry with no SDD phase", () => {
    const content = getDeckInitContent();
    for (const marker of [
      "DeckPreparationHandoffV1",
      "preparationStatus",
      "continueToTriage",
      "legacyOutcome",
      "skillDiscoveryContext",
      "nextActions",
      "telemetry",
      "blockers",
      "no registry body, candidate records, absolute project path, secrets, user-home path, or raw tool output",
      "not an SDD phase",
      "no phase status, OpenSpec change artifact, `state.yaml` entry, or `events.yaml` entry",
    ]) expect(content).toContain(marker);
  });

  test("keeps installer, network, global, direct TUI, Git, and invented surfaces unreachable", () => {
    const content = getDeckInitContent();
    for (const forbidden of [
      "ProjectInitServiceV1",
      "ProjectInitRequestV1",
      "ProjectInitResultV1",
      "public project-init API",
      "new project-preparation command",
      "direct TUI call",
      "arbitrary scanning",
      "prompt-minted authority",
    ]) expect(content).not.toContain(forbidden);
    expect(content).toContain("MUST NOT install, download, upgrade, invoke package managers");
    expect(content).toContain("MUST NOT trigger a write fallback");
  });

  test("functionally composes ready, silent preparation, partial, and blocked paths", () => {
    const content = getDeckInitContent();
    expect(exercisePreparationComposition(content, {
      authorityValid: true,
      openSpec: "unchanged",
      registry: "unchanged",
      optionalCapability: "skipped",
    })).toEqual({ preparationStatus: "completed", continueToTriage: true });
    expect(exercisePreparationComposition(content, {
      authorityValid: true,
      openSpec: "changed",
      registry: "changed",
      optionalCapability: "changed",
    })).toEqual({ preparationStatus: "completed", continueToTriage: true });
    expect(exercisePreparationComposition(content, {
      authorityValid: true,
      openSpec: "unchanged",
      registry: "unchanged",
      optionalCapability: "unavailable",
    })).toEqual({ preparationStatus: "partial", continueToTriage: true, nextAction: "existing-tui" });
    expect(exercisePreparationComposition(content, {
      authorityValid: false,
      openSpec: "unchanged",
      registry: "unchanged",
      optionalCapability: "ready",
    })).toEqual({ preparationStatus: "blocked", continueToTriage: false });
  });
});
