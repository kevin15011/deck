/**
 * Git Safety Rule — Centralized Presence and Structural Tests
 *
 * Tests that the Git discard protection rule is present in all 24 surfaces
 * (12 content modules × 2 bodies each) and has the required structural elements.
 */

import { describe, test, expect } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import { 
  GIT_DISCARD_PROTECTION_RULE, 
  GIT_SAFETY_SENTINEL,
  assertGitSafetyRulePresent 
} from "./git-safety";

// Import all 12 content modules
import { ORCHESTRATOR_AGENT_BODY, ORCHESTRATOR_SKILL_BODY } from "./orchestrator-content";
import { EXPLORER_AGENT_BODY, EXPLORER_SKILL_BODY } from "./explorer-content";
import { PROPOSAL_AGENT_BODY, PROPOSAL_SKILL_BODY } from "./proposal-content";
import { SPEC_AGENT_BODY, SPEC_SKILL_BODY } from "./spec-content";
import { DESIGN_AGENT_BODY, DESIGN_SKILL_BODY } from "./design-content";
import { TASK_AGENT_BODY, TASK_SKILL_BODY } from "./task-content";
import { APPLY_BACKEND_AGENT_BODY, APPLY_BACKEND_SKILL_BODY } from "./apply-backend-content";
import { APPLY_FRONTEND_AGENT_BODY, APPLY_FRONTEND_SKILL_BODY } from "./apply-frontend-content";
import { APPLY_GENERAL_AGENT_BODY, APPLY_GENERAL_SKILL_BODY } from "./apply-general-content";
import { VERIFY_AGENT_BODY, VERIFY_SKILL_BODY } from "./verify-content";
import { REVIEW_AGENT_BODY, REVIEW_SKILL_BODY } from "./review-content";
import { ARCHIVE_AGENT_BODY, ARCHIVE_SKILL_BODY } from "./archive-content";

// All 24 body surfaces
const allBodies = [
  { name: "orchestrator-agent", body: ORCHESTRATOR_AGENT_BODY },
  { name: "orchestrator-skill", body: ORCHESTRATOR_SKILL_BODY },
  { name: "explorer-agent", body: EXPLORER_AGENT_BODY },
  { name: "explorer-skill", body: EXPLORER_SKILL_BODY },
  { name: "proposal-agent", body: PROPOSAL_AGENT_BODY },
  { name: "proposal-skill", body: PROPOSAL_SKILL_BODY },
  { name: "spec-agent", body: SPEC_AGENT_BODY },
  { name: "spec-skill", body: SPEC_SKILL_BODY },
  { name: "design-agent", body: DESIGN_AGENT_BODY },
  { name: "design-skill", body: DESIGN_SKILL_BODY },
  { name: "task-agent", body: TASK_AGENT_BODY },
  { name: "task-skill", body: TASK_SKILL_BODY },
  { name: "apply-backend-agent", body: APPLY_BACKEND_AGENT_BODY },
  { name: "apply-backend-skill", body: APPLY_BACKEND_SKILL_BODY },
  { name: "apply-frontend-agent", body: APPLY_FRONTEND_AGENT_BODY },
  { name: "apply-frontend-skill", body: APPLY_FRONTEND_SKILL_BODY },
  { name: "apply-general-agent", body: APPLY_GENERAL_AGENT_BODY },
  { name: "apply-general-skill", body: APPLY_GENERAL_SKILL_BODY },
  { name: "verify-agent", body: VERIFY_AGENT_BODY },
  { name: "verify-skill", body: VERIFY_SKILL_BODY },
  { name: "review-agent", body: REVIEW_AGENT_BODY },
  { name: "review-skill", body: REVIEW_SKILL_BODY },
  { name: "archive-agent", body: ARCHIVE_AGENT_BODY },
  { name: "archive-skill", body: ARCHIVE_SKILL_BODY },
];

describe("Git Safety Rule — Structural Tests", () => {
  test("rule contains all required destructive command families", () => {
    const requiredCommands = [
      "git reset --hard",
      "git restore --staged",
      "git checkout --",
      "git clean -fd",
      "git stash drop",
      "git rebase -i",
    ];
    
    for (const cmd of requiredCommands) {
      expect(GIT_DISCARD_PROTECTION_RULE).toContain(cmd);
    }
  });

test("rule contains all required behavior elements", () => {
    // (a) plain-language explanation, (b) irreversible warning, 
    // (c) new-message confirmation, (d) supersedence clause
    const behaviorElements = [
      "irrevocably", // uses "irrevocably" not "irreversibly"
      "new message", // requires new message for confirmation
      "exact command", // requires exact command repetition
      "This rule supersedes", // supersedence clause - exact phrase
    ];
    
    for (const element of behaviorElements) {
      expect(GIT_DISCARD_PROTECTION_RULE).toContain(element);
    }
  });

  test("rule contains high-visibility heading", () => {
    expect(GIT_DISCARD_PROTECTION_RULE).toContain("## CRITICAL SAFETY RULE — Git Discard Protection");
  });
});

describe("Git Safety Rule — Cross-Agent Presence Tests", () => {
  for (const { name, body } of allBodies) {
    test(`sentinel present in ${name}`, () => {
      assertGitSafetyRulePresent(body, name);
    });
  }
});

describe("Git Safety Rule — Byte-Identity Test", () => {
  test("each surface contains exact canonical GIT_DISCARD_PROTECTION_RULE text", () => {
    // Verify that each surface contains the EXACT canonical rule text.
    // This catches if someone modifies the rule in-place instead of importing.
    for (const { name, body } of allBodies) {
      expect(body).toContain(GIT_DISCARD_PROTECTION_RULE);
    }
  });
});

describe("Git Safety Rule — Dynamic Discovery Test", () => {
  test("discovers all *-content.ts files and fails if new file lacks the rule import", async () => {
    const contentDir = path.join(process.cwd(), "packages/core/src/teams/developer");
    
    // Read directory and find all *-content.ts files
    const files = await fs.readdir(contentDir);
    const contentFiles = files.filter(f => f.endsWith("-content.ts"));
    
    // Check each content file - it must import the rule to be compliant
    // This catches if someone creates a new content file without the rule.
    const missingImport: string[] = [];
    for (const file of contentFiles) {
      if (file === "visual-explanations-content.ts") continue; // Skip - not in Developer Team scope
      
      const filePath = path.join(contentDir, file);
      const content = await fs.readFile(filePath, "utf8");
      
      // A compliant content file imports GIT_DISCARD_PROTECTION_RULE from ./git-safety
      if (!content.includes('import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety"')) {
        missingImport.push(file);
      }
    }
    
    // Report any new files missing the rule import
    expect(missingImport).toEqual([]);
  });
});

describe("Git Safety Rule — Roadmap Presence Test", () => {
  test("roadmap contains Git safety rule reference", async () => {
    const roadmapPath = path.join(process.cwd(), "docs/skills-integration-roadmap.md");
    const roadmap = (await fs.readFile(roadmapPath, "utf8")).toString();
    
    // Sentinel phrases that indicate the rule is documented
    const sentinelPhrases = [
      "Critical Git Discard Protection",
      "Git Discard Protection",
      "Phase 3Z",
      "git-safety.ts"
    ];
    
    const found = sentinelPhrases.some(phrase => roadmap.includes(phrase));
    expect(found).toBe(true);
  });
});
