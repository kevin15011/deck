import { afterEach, describe, expect, test } from "bun:test";

import { createPiHarness, findRealPi, type PiHarness } from "../../pi-cli-harness";

const piAvailable = findRealPi() !== undefined;
const realTest = piAvailable ? test : test.skip;

let harness: PiHarness | undefined;
afterEach(() => { harness?.cleanup(); harness = undefined; });

const toolEnd = (events: Array<Record<string, any>>) => events.find((event) => event.type === "tool_execution_end" && event.toolName === "subagent");

describe("deck-subagents in the real Pi 1.0 runtime (faux provider)", () => {
  realTest("the lead delegates to a role; the child runs with the role's model, thinking and read-only tools", async () => {
    harness = createPiHarness({ installOptions: { modelAssignments: { "deck-investigate": "faux/faux-1" }, thinkingAssignments: { "deck-investigate": "off" } } });
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", task: "look around" }) });
    const end = toolEnd(run.events);
    expect(end?.isError).toBe(false);
    expect(end?.result.content[0].text).toBe("CHILD_OK investigate");
    expect(end?.result.details.results[0]).toMatchObject({ agent: "deck-investigate", model: "faux/faux-1", thinking: "off", tools: ["read", "grep", "find", "ls", "memory_search"], exitCode: 0 });
  }, 120_000);

  realTest("an unknown role is an error result and the lead session continues", async () => {
    harness = createPiHarness();
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-wizard", task: "x" }) });
    const end = toolEnd(run.events);
    expect(end?.isError).toBe(true);
    expect(end?.result.content[0].text).toContain("Unknown agent");
    expect(JSON.stringify(run.events)).toContain("LEAD_DONE");
  }, 120_000);

  realTest("a child that cannot start its model is reported as a tool error without ending the lead", async () => {
    harness = createPiHarness({ installOptions: { modelAssignments: { "deck-quality": "nope/not-a-model" } } });
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-quality", task: "x" }) });
    expect(toolEnd(run.events)?.isError).toBe(true);
    expect(JSON.stringify(run.events)).toContain("LEAD_DONE");
  }, 120_000);

  realTest("outside a Deck session the subagent tool is not registered", async () => {
    harness = createPiHarness();
    const run = await harness.run(["go"], { FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", task: "x" }) });
    expect(toolEnd(run.events)?.isError).toBe(true);
    expect(JSON.stringify(toolEnd(run.events))).toMatch(/not found|Tool/i);
  }, 120_000);
});
