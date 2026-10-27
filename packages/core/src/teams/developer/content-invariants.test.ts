import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { getStandaloneSkill, STANDALONE_SKILLS } from "../../skills/external";
import { DEVELOPER_TEAM_AGENTS, LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP } from "./catalog";
import { getAgentContent } from "./content-registry";
import { ADAPTIVE_AGENT_CONTENT, ADAPTIVE_TEAM_RUNTIME_CONTRACT } from "./adaptive-team-content";
import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";
import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";
import * as verify from "./verify-content";
import * as review from "./review-content";
import * as archive from "./archive-content";

// Protect structure and safety contracts, not editorial wording. U2 activates doctrine rules.
const BANNED_PHRASES: readonly string[] = [];
const PROTECTED_BLOCKS = {
  GIT_DISCARD_PROTECTION_RULE,
  ADAPTIVE_TEAM_RUNTIME_CONTRACT,
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

for (const promptProfile of ["compact", "legacy"] as const) {
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
          const knownIds = new Set([...Object.keys(ADAPTIVE_AGENT_CONTENT), ...Object.keys(LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP), ...STANDALONE_SKILLS.map(s => s.skillId)]);
          for (const [, id] of body.matchAll(/`(deck-[a-z][a-z-]+)`/g)) expect(knownIds.has(id!), `${agent.id}/${surface}: unresolved ID ${id}`).toBe(true);
          for (const phrase of BANNED_PHRASES) expect(body).not.toContain(phrase);
        }
      });
    }
    test("legacy workflow roles retain Git protection on their declared surfaces", () => {
      const roles = Object.keys(LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP).filter(id => id.startsWith("deck-developer-"));
      for (const id of roles) {
        const content = getAgentContent(id, { promptProfile })!;
        expect(content.agentBody, `${id}: GIT_DISCARD_PROTECTION_RULE`).toContain(GIT_DISCARD_PROTECTION_RULE);
        if (promptProfile === "legacy") expect(content.skillBody, `${id}/skill: GIT_DISCARD_PROTECTION_RULE`).toContain(GIT_DISCARD_PROTECTION_RULE);
      }
    });
    test("catalog and legacy role IDs resolve", () => {
      for (const [alias, id] of Object.entries(LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP)) {
        expect(getAgentContent(alias, { promptProfile }), alias).toBeDefined();
        expect(getAgentContent(id, { promptProfile }), id).toBeDefined();
      }
      for (const agent of DEVELOPER_TEAM_AGENTS) expect(getAgentContent(agent.skillId, { promptProfile }), agent.skillId).toBeDefined();
    });
  });
}

test("retained legacy review, verify and archive surfaces preserve authority verbatim", () => {
  for (const [role, exports] of Object.entries({ verify, review, archive })) {
    for (const [name, body] of Object.entries(exports)) {
      if (typeof body === "string" && /_(AGENT|SKILL)_BODY$/.test(name)) {
        expect(body, `${role}/${name}: FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1`).toContain(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1);
      }
    }
  }
});

test("standalone skill IDs, frontmatter and size bounds", () => {
  const ids = STANDALONE_SKILLS.map((s) => s.skillId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    const body = getStandaloneSkill(id).SKILL;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
    expect(frontmatter, `${id}: frontmatter`).not.toBeNull();
    const descriptor = parse(frontmatter![1]!);
    expect(descriptor.name, id).toBe(id);
    expect(typeof descriptor.description, id).toBe("string");
    expect(Buffer.byteLength(body), `${id}: byte budget`).toBeLessThanOrEqual(100_000);
  }
});
