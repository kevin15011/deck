import { VERIFICATION_DOCTRINE_CORE } from "./verification-doctrine";
import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { getStandaloneSkill, STANDALONE_SKILLS } from "../../skills/external";
import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import { getAgentContent } from "./content-registry";
import { ADAPTIVE_AGENT_CONTENT, ADAPTIVE_TEAM_RUNTIME_CONTRACT } from "./adaptive-team-content";
import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";
import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";
import * as verify from "./verify-content";
import * as review from "./review-content";
import * as archive from "./archive-content";

// Protect structure and safety contracts, not editorial wording.
const BANNED_PHRASES = ["strict TDD", "sufficient test coverage", "every new behavior has a corresponding test", "run tests after every refactor step"];
const PROTECTED_BLOCKS = {
  GIT_DISCARD_PROTECTION_RULE,
  ADAPTIVE_TEAM_RUNTIME_CONTRACT,
  VERIFICATION_DOCTRINE_CORE,
};
const REQUIRED_SECTIONS: Record<string, readonly string[]> = {
  "deck-lead": ["Route selection", "OpenSpec persistence", "Communication"],
  "deck-investigate": [], "deck-architect": [], "deck-apply-fast": [],
  "deck-apply-deep": [], "deck-quality": [],
  "deck-setup": ["Activation Contract", "Hard Rules", "Return"],
};
const SIZE_BUDGETS: Record<string, { agentBody: number; skillBody: number }> = Object.fromEntries(
  DEVELOPER_TEAM_AGENTS.map(({ id }) => [id, id === "deck-setup"
    ? { agentBody: 26_000, skillBody: 20_000 } : { agentBody: 16_000, skillBody: 10_000 }]),
);

for (const promptProfile of ["compact"] as const) {
  describe(`content invariants: ${promptProfile}`, () => {
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      test(agent.id, () => {
        const content = getAgentContent(agent.id, { promptProfile })!;
        expect(content, agent.id).toBeDefined();
        expect(Object.keys(ADAPTIVE_AGENT_CONTENT)).toContain(agent.id);
        for (const [name, block] of Object.entries(PROTECTED_BLOCKS)) {
          expect(content.agentBody, `${agent.id}: ${name}`).toContain(block);
        }
        for (const [surface, body] of Object.entries(content)) {
          const headings = [...body.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1]);
          for (const section of ["Context Authority", "Developer Team Language Policy", ...REQUIRED_SECTIONS[agent.id]!]) {
            expect(headings, `${agent.id}/${surface}: ${section}`).toContain(section);
          }
          expect(Buffer.byteLength(body), `${agent.id}/${surface}: byte budget`).toBeLessThanOrEqual(SIZE_BUDGETS[agent.id]![surface as keyof typeof content]);
          const knownIds = new Set([...Object.keys(ADAPTIVE_AGENT_CONTENT), ...STANDALONE_SKILLS.map(s => s.skillId)]);
          for (const [, id] of body.matchAll(/`(deck-[a-z][a-z-]+)`/g)) expect(knownIds.has(id!), `${agent.id}/${surface}: unresolved ID ${id}`).toBe(true);
          for (const phrase of BANNED_PHRASES) expect(body).not.toContain(phrase);
        }
      });
    }
    test("catalog role IDs resolve", () => {
      for (const agent of DEVELOPER_TEAM_AGENTS) expect(getAgentContent(agent.skillId, { promptProfile }), agent.skillId).toBeDefined();
    });
  });
}

test("compact review, verify and archive surfaces preserve authority verbatim", () => {
  for (const [role, exports] of Object.entries({ verify, review, archive })) {
    for (const [name, body] of Object.entries(exports)) {
      if (typeof body === "string" && /_(AGENT|SKILL)_BODY$/.test(name)) {
        expect(body.split(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1), `${role}/${name}: authority exactly once`).toHaveLength(2);
      }
    }
  }
});

test("standalone skill IDs, frontmatter and size bounds", () => {
  const ids = STANDALONE_SKILLS.map((s) => s.skillId);
  expect(ids).not.toContain("test-driven-development");
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    const body = getStandaloneSkill(id).SKILL;
    expect(body, `${id}: removed methodology`).not.toContain("test-driven-development");
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
    expect(frontmatter, `${id}: frontmatter`).not.toBeNull();
    const descriptor = parse(frontmatter![1]!);
    expect(descriptor.name, id).toBe(id);
    expect(typeof descriptor.description, id).toBe("string");
    expect(Buffer.byteLength(body), `${id}: byte budget`).toBeLessThanOrEqual(100_000);
  }
});

// The shipped core must remain useful without an installed skill or a particular stack.
test("doctrine core is bounded and stack-neutral", () => {
  expect(Buffer.byteLength(VERIFICATION_DOCTRINE_CORE)).toBeLessThanOrEqual(1500);
  expect(VERIFICATION_DOCTRINE_CORE).not.toMatch(/merchant|Liquid|bun test|test:changed|scripts\/test\.ts|pytest|npm|Shopify/i);
});

// Compact Full SDD helpers remain in source even though only adaptive roles install.
import * as general from "./apply-general-content";
import * as frontend from "./apply-frontend-content";
import * as backend from "./apply-backend-content";
import * as orchestrator from "./orchestrator-content";
import { APPLY_CONTINUOUS_DELTA_RULE_V1 } from "./continuous-development";
import { SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1 } from "./skill-discovery-content";

test("compact Full SDD surfaces preserve canonical contracts", () => {
  for (const [role, exports] of Object.entries({ general, frontend, backend, verify, review, orchestrator })) {
    for (const [name, body] of Object.entries(exports)) {
      if (typeof body !== "string" || !/_(AGENT|SKILL)_BODY$/.test(name)) continue;
      expect(body.split(VERIFICATION_DOCTRINE_CORE), `${role}/${name}: doctrine`).toHaveLength(2);
      if (name.endsWith("_AGENT_BODY")) expect(body, `${role}: git protection`).toContain(GIT_DISCARD_PROTECTION_RULE);
      if (["general", "frontend", "backend"].includes(role)) expect(body, `${role}: delta contract`).toContain(APPLY_CONTINUOUS_DELTA_RULE_V1);
      if (role === "orchestrator") expect(body.split(SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1), name).toHaveLength(2);
      expect(body, `${role}: default TDD skill`).not.toContain("test-driven-development");
    }
  }
  expect(orchestrator.ORCHESTRATOR_SYSTEM_PROMPT_COMPACT.split(VERIFICATION_DOCTRINE_CORE)).toHaveLength(2);
});
