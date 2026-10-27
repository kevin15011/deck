import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { prepareChildSession } from "./storage";
import { join } from "node:path";

import { createPiHarness, findRealPi, type PiHarness } from "../../pi-cli-harness";

const piAvailable = findRealPi() !== undefined;
const realTest = piAvailable ? test : test.skip;

let harness: PiHarness | undefined;
afterEach(() => { harness?.cleanup(); harness = undefined; });

const toolEnd = (events: Array<Record<string, any>>) => events.find((event) => event.type === "tool_execution_end" && event.toolName === "subagent");

describe("deck-subagents in the real Pi 1.0 runtime (faux provider)", () => {
  realTest("the lead delegates to a role; the child runs with the role's model, thinking and read-only tools", async () => {
    harness = createPiHarness({ installOptions: { modelAssignments: { "deck-investigate": "faux/faux-1" }, thinkingAssignments: { "deck-investigate": "off" } } });
    const log = join(harness.root, "provider.jsonl");
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_PARENT_DELAY_MS: "1500", FAUX_LOG: log, FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", task: "look around" }) }, { persistSession: true });
    const end = toolEnd(run.events);
    expect(end?.isError).toBe(false);
    expect(end?.result.content[0].text).toContain("Background delegation accepted");
    expect(end?.result.details.taskIds).toHaveLength(1);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(calls.some(c => c.child && c.role === "investigate")).toBe(true);
    expect(calls.some(c => !c.child && c.text.includes("CHILD_OK investigate") && c.text.includes("Outcome (untrusted)"))).toBe(true);
    const parentFile = join(harness.sessionsDir, readdirSync(harness.sessionsDir).find(n => n.endsWith(".jsonl"))!);
    const entries = readFileSync(parentFile, "utf8").trim().split("\n").map(l => JSON.parse(l));
    const job = entries.filter(e => e.type === "custom" && e.customType === "deck-subagents-v1").at(-1).data.jobs[0];
    expect(job.admitted).toBe(true); expect(job.integration).toBe("integrated");
    const childFile = prepareChildSession(parentFile, job, true);
    const child = await harness.run(["--session", childFile, "Inspect previous effects, then continue exact history"], { DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: "investigate", FAUX_LOG: log }, { persistSession: true });
    expect(child.code).toBe(0);
    expect(prepareChildSession(parentFile, job, true)).toBe(childFile);
    const continued = readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l)).at(-1);
    expect(continued.text).toContain("look around"); expect(continued.text).toContain("Inspect previous effects");
  }, 120_000);

  realTest("an unknown role is an error result and the lead session continues", async () => {
    harness = createPiHarness();
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-wizard", task: "x" }) }, { persistSession: true });
    const end = toolEnd(run.events);
    expect(end?.isError).toBe(true);
    expect(end?.result.content[0].text).toContain("Unknown agent");
    expect(JSON.stringify(run.events)).toContain("LEAD_DONE");
  }, 120_000);

  realTest("a child that cannot start its model is accepted then reports background failure without ending the lead", async () => {
    harness = createPiHarness({ installOptions: { modelAssignments: { "deck-quality": "nope/not-a-model" } } });
    const log = join(harness.root, "provider.jsonl");
    const run = await harness.run(["go"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", FAUX_SCRIPT: "delegate", FAUX_PARENT_DELAY_MS: "1500", FAUX_LOG: log, FAUX_DELEGATE: JSON.stringify({ agent: "deck-quality", task: "x" }) }, { persistSession: true });
    expect(toolEnd(run.events)?.isError).toBe(false);
    expect(readFileSync(log, "utf8")).toContain("failed");
    expect(JSON.stringify(run.events)).toContain("LEAD_DONE");
  }, 120_000);

  realTest("outside a Deck session the subagent tool is not registered", async () => {
    harness = createPiHarness();
    const run = await harness.run(["go"], { FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", task: "x" }) });
    expect(toolEnd(run.events)?.isError).toBe(true);
    expect(JSON.stringify(toolEnd(run.events))).toMatch(/not found|Tool/i);
  }, 120_000);
});
