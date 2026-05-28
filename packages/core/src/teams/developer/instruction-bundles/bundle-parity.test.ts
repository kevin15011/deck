import { describe, expect, test } from "bun:test";
import { buildAdaptiveMemoryInstructionBundle } from "./adaptive-memory";
import { buildCodebaseMemoryInstructionBundle } from "./codebase-memory";
import { buildContextModeInstructionBundle } from "./context-mode";
import { buildRtkInstructionBundle } from "./rtk";
import { buildSerenaInstructionBundle } from "./serena";

// ---------------------------------------------------------------------------
// Hash helper — deterministic hash for byte-exact comparison
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Baseline hashes — updated when content intentionally changes
// ---------------------------------------------------------------------------

/**
 * Baseline hashes for all bundle fragments.
 * These must be updated (with justification comment) when content changes.
 * They serve as inline snapshot verification for byte-exact parity.
 */
const BASELINE_HASHES: Record<string, Record<string, number>> = {
  "adaptive-memory": {
    agent: -380073386,
    session: -509854984,
    skill: -456489836,
  },
  "codebase-memory": {
    agent: 392768171,
    skill: 2106445653,
  },
  "context-mode": {
    agent: 1835949962,
    skill: -457739508,
  },
  rtk: {
    agent: -74789039,
    skill: 1540221712,
  },
  serena: {
    agent: 1042159158, // Updated: replaced OpenCode literals with generic "the runner"
    skill: 484477006,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bundle parity snapshots", () => {
  describe("adaptive-memory", () => {
    const bundle = buildAdaptiveMemoryInstructionBundle();

    test("agent fragment hash matches baseline", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();
      expect(hash(agent!.markdown)).toBe(BASELINE_HASHES["adaptive-memory"].agent);
    });

    test("session fragment hash matches baseline", () => {
      const session = bundle.instructions.find((f) => f.surface === "session");
      expect(session).toBeDefined();
      expect(hash(session!.markdown)).toBe(BASELINE_HASHES["adaptive-memory"].session);
    });

    test("skill fragment hash matches baseline", () => {
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      expect(skill).toBeDefined();
      expect(hash(skill!.markdown)).toBe(BASELINE_HASHES["adaptive-memory"].skill);
    });
  });

  describe("codebase-memory", () => {
    const bundle = buildCodebaseMemoryInstructionBundle();

    test("agent fragment hash matches baseline", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();
      expect(hash(agent!.markdown)).toBe(BASELINE_HASHES["codebase-memory"].agent);
    });

    test("skill fragment hash matches baseline", () => {
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      expect(skill).toBeDefined();
      expect(hash(skill!.markdown)).toBe(BASELINE_HASHES["codebase-memory"].skill);
    });
  });

  describe("context-mode", () => {
    const bundle = buildContextModeInstructionBundle();

    test("agent fragment hash matches baseline", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();
      expect(hash(agent!.markdown)).toBe(BASELINE_HASHES["context-mode"].agent);
    });

    test("skill fragment hash matches baseline", () => {
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      expect(skill).toBeDefined();
      expect(hash(skill!.markdown)).toBe(BASELINE_HASHES["context-mode"].skill);
    });
  });

  describe("rtk", () => {
    const bundle = buildRtkInstructionBundle();

    test("agent fragment hash matches baseline", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();
      expect(hash(agent!.markdown)).toBe(BASELINE_HASHES.rtk.agent);
    });

    test("skill fragment hash matches baseline", () => {
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      expect(skill).toBeDefined();
      expect(hash(skill!.markdown)).toBe(BASELINE_HASHES.rtk.skill);
    });
  });

  describe("serena", () => {
    const bundle = buildSerenaInstructionBundle();

    test("agent fragment hash matches baseline", () => {
      const agent = bundle.instructions.find((f) => f.surface === "agent");
      expect(agent).toBeDefined();
      expect(hash(agent!.markdown)).toBe(BASELINE_HASHES.serena.agent);
    });

    test("skill fragment hash matches baseline", () => {
      const skill = bundle.instructions.find((f) => f.surface === "skill");
      expect(skill).toBeDefined();
      expect(hash(skill!.markdown)).toBe(BASELINE_HASHES.serena.skill);
    });
  });
});