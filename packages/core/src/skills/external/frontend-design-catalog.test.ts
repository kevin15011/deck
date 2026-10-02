import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getStandaloneSkill, getStandaloneSkills } from "./index";
import { parseSkillDescriptor } from "../../skill-discovery/discovery";
import { getAgentContent, getTeamSessionInstructions } from "../../teams/developer/content-registry";
import catalog from "./deck-frontend-design/references/catalog.json";

describe("canonical frontend aesthetic catalog", () => {
  test("each profile resolves a complete packaged skill and preserves upstream identity", () => {
    const registered = new Set(getStandaloneSkills().map((skill) => skill.skillId));
    expect(new Set(catalog.profiles.map((profile) => profile.skillId)).size).toBe(catalog.profiles.length);
    for (const profile of catalog.profiles) {
      expect(registered.has(profile.skillId)).toBe(true);
      const bundle = getStandaloneSkill(profile.skillId);
      const descriptor = parseSkillDescriptor(bundle.SKILL, profile.skillId);
      expect(descriptor).toMatchObject({ ok: true });
      expect(bundle.SKILL).toBe(readFileSync(join(import.meta.dir, profile.skillId, "SKILL.md"), "utf8"));
      if ("source" in profile) {
        expect(profile.source!.revision).toMatch(/^[a-f0-9]{40}$/);
        expect(Object.keys(bundle.files).some((path) => /(^|\/)LICENSE(\.txt|\.md)?$/i.test(path))).toBe(true);
      }
    }
  });

  test("router catalog and guide travel inside the standalone bundle", () => {
    const bundle = getStandaloneSkill("deck-frontend-design");
    expect(JSON.parse(bundle.files["references/catalog.json"]!)).toEqual(catalog);
    expect(bundle.files["references/routing.md"]).toBe(readFileSync(join(import.meta.dir, "deck-frontend-design/references/routing.md"), "utf8"));
    expect(bundle.SKILL).toContain("references/catalog.json");
  });

  test("new complete skill directories contain only strict UTF8 regular resources", () => {
    function check(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        expect(entry.isSymbolicLink()).toBe(false);
        const path = join(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (entry.isFile()) {
          const bytes = readFileSync(path);
          expect(() => new TextDecoder("utf8", { fatal: true }).decode(bytes)).not.toThrow();
          expect(bytes.includes(0)).toBe(false);
        }
      }
    }
    for (const profile of catalog.profiles.filter((entry) => "source" in entry)) check(join(import.meta.dir, profile.skillId));
  });

  test("manual invocation and brand/platform exclusions survive selection metadata", () => {
    expect(catalog.profiles.find((entry) => entry.skillId === "review-animations")?.activation).toBe("manual-only");
    expect(getStandaloneSkill("review-animations").SKILL).toContain("disable-model-invocation: true");
    expect(catalog.profiles.find((entry) => entry.skillId === "brand-guidelines")?.activation).toBe("explicit-only");
    expect(catalog.profiles.find((entry) => entry.skillId === "design-taste-frontend")?.excludes).toContain("dashboards");
    expect(catalog.profiles.some((entry) => entry.skillId === "impeccable")).toBe(false);
  });

  test("Lead references router on compact and legacy surfaces without injecting all profiles", () => {
    for (const promptProfile of ["compact", "legacy"] as const) {
      const lead = getAgentContent("deck-lead", { promptProfile })!;
      for (const body of [lead.agentBody, lead.skillBody, getTeamSessionInstructions("developer-team", { promptProfile })!]) {
        expect(body).toContain("deck-frontend-design");
        expect(body).not.toContain('"schemaVersion"');
      }
    }
  });
});
