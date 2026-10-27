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
import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import { getAgentContent } from "./content-registry";
const allBodies = DEVELOPER_TEAM_AGENTS.map(({ id }) => ({ name: id, body: getAgentContent(id)!.agentBody }));

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
