import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { composeApplyAgentPrompt } from "./orchestrator-content";
import { EXECUTION_V1_PROMPT_FIXTURE } from "../../../../sdd-runtime/src/fixtures/execution-v1/prompt-fixtures";

describe("execution-v1 static prompt compatibility baseline", () => {
  test("static authorization prompt bytes remain frozen", () => {
    const prompt = composeApplyAgentPrompt(EXECUTION_V1_PROMPT_FIXTURE.basePrompt, EXECUTION_V1_PROMPT_FIXTURE.authorization);
    expect(createHash("sha256").update(prompt).digest("hex")).toBe(EXECUTION_V1_PROMPT_FIXTURE.sha256);
  });
});
