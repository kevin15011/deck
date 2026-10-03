import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { startFakeLoopbackHost } from "../../__fixtures__/fake-loopback-host";
import { createPiHarness, findRealPi, type PiHarness } from "../../pi-cli-harness";

const realTest = findRealPi() !== undefined ? test : test.skip;
const ADVISORY = "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nadvisory\n{\"items\":[\"PROJECT_FACT_42\"]}\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>";

let harness: PiHarness | undefined;
let host: ReturnType<typeof startFakeLoopbackHost> | undefined;
afterEach(() => { host?.stop(); host = undefined; harness?.cleanup(); harness = undefined; });

const leadEnv = () => ({ DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", ...host!.env });
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

function readLog(path: string): Array<{ child: boolean; role?: string; system: string; text: string }> {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
}

describe("deck-memory in the real Pi 1.0 runtime (faux provider, fake loopback host)", () => {
  realTest("recall reaches the provider once, nothing is persisted as custom_message, and the turn is captured and flushed", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    const run = await harness.run(["what do we know?"], { ...leadEnv(), FAUX_LOG: fauxLog, FAUX_REPLY: "ASSISTANT_FINAL_TEXT" }, { persistSession: true });
    expect(run.code).toBe(0);

    const requests = readLog(fauxLog).filter((entry) => !entry.child);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(occurrences(request.text, "<DECK_ADAPTIVE_CONTEXT_JSON_V1>")).toBe(1);
    expect(requests[0]!.text).toContain("PROJECT_FACT_42");

    const names = host.events.map((entry) => entry.body.event);
    expect(names).toContain("session_start");
    expect(host.named("injection_ack")).toHaveLength(1);
    expect(host.named("capture").map((event) => [event.source, event.content])).toEqual([["trusted-user-prompt", "what do we know?"], ["trusted-final-assistant", "ASSISTANT_FINAL_TEXT"]]);
    expect(names.at(-1)).toBe("shutdown_flush");

    const sessionFiles = readdirSync(harness.sessionsDir, { recursive: true }).map(String).filter((file) => file.endsWith(".jsonl"));
    expect(sessionFiles.length).toBeGreaterThan(0);
    const persisted = sessionFiles.map((file) => readFileSync(join(harness!.sessionsDir, file), "utf8")).join("\n");
    expect(persisted).not.toContain("custom_message");
    expect(persisted).not.toContain("PROJECT_FACT_42");
  }, 120_000);

  realTest("three prompts in one session: recall is re-applied per run, never accumulates, and every prompt is captured", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    const run = await harness.run(["first prompt", "second prompt", "third prompt"], { ...leadEnv(), FAUX_LOG: fauxLog }, { persistSession: true });
    expect(run.code).toBe(0);
    const requests = readLog(fauxLog).filter((entry) => !entry.child);
    expect(requests).toHaveLength(3);
    for (const request of requests) expect(occurrences(request.text, "<DECK_ADAPTIVE_CONTEXT_JSON_V1>")).toBe(1);
    expect(host.named("session_start")).toHaveLength(1);
    expect(host.named("recall")).toHaveLength(2);
    expect(host.named("capture").filter((event) => event.source === "trusted-user-prompt").map((event) => event.content)).toEqual(["first prompt", "second prompt", "third prompt"]);
    const persisted = readdirSync(harness.sessionsDir, { recursive: true }).map(String).filter((file) => file.endsWith(".jsonl")).map((file) => readFileSync(join(harness!.sessionsDir, file), "utf8")).join("\n");
    expect(persisted).not.toContain("PROJECT_FACT_42");
  }, 120_000);

  realTest("without the memory variables the session still runs and reports a single diagnostic", async () => {
    harness = createPiHarness();
    const run = await harness.run(["hello"], { DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead" });
    expect(run.code).toBe(0);
    expect(JSON.stringify(run.events)).toContain("LEAD_DONE");
    expect(occurrences(run.stderr, "Deck memory:")).toBe(1);
  }, 120_000);

  realTest("outside a Deck session the memory extension is inert", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    await harness.run(["hello"], { ...host.env });
    expect(host.events).toHaveLength(0);
  }, 120_000);

  realTest("a delegated child sends role_start with its role and the task, receives recall, and does not capture; the token never reaches its env", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    await harness.run(["delegate"], { ...leadEnv(), FAUX_LOG: fauxLog, FAUX_SCRIPT: "delegate", FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", task: "look around" }), DECK_RUNNER_MEMORY_TOKEN: "must-not-leak" });
    const roleStarts = host.named("role_start");
    expect(roleStarts).toHaveLength(1);
    expect(roleStarts[0]).toMatchObject({ role: "investigate", query: "Task: look around" });
    const leadRequests = readLog(fauxLog).filter((entry) => !entry.child);
    expect(leadRequests.length).toBeGreaterThanOrEqual(2);
    for (const request of leadRequests) expect(occurrences(request.text, "<DECK_ADAPTIVE_CONTEXT_JSON_V1>")).toBe(1);
    const childRequests = readLog(fauxLog).filter((entry) => entry.child);
    expect(childRequests[0]!.text).toContain("PROJECT_FACT_42");
    const captureSources = host.named("capture").map((event) => event.sessionId);
    expect(new Set(captureSources).size).toBe(1);
    for (const entry of host.events) expect(entry.auth).toBe(`Bearer ${host.token}`);
  }, 120_000);

  realTest("the lead calls memory_search and memory_save through the loopback with its role; results reach the model", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    const search = await harness.run(["find it"], { ...leadEnv(), FAUX_LOG: fauxLog, FAUX_SCRIPT: "tool", FAUX_TOOL: "memory_search", FAUX_TOOL_INPUT: JSON.stringify({ query: "earlier decision" }) });
    expect(search.code).toBe(0);
    expect(host.named("search")).toHaveLength(1);
    expect(host.named("search")[0]).toMatchObject({ runnerId: "pi", role: "lead", query: "earlier decision" });
    expect(readLog(fauxLog).filter((entry) => !entry.child).at(-1)!.text).toContain("SEARCH_HIT_7");

    const save = await harness.run(["note it"], { ...leadEnv(), FAUX_SCRIPT: "tool", FAUX_TOOL: "memory_save", FAUX_TOOL_INPUT: JSON.stringify({ content: "Decision: explicit memory tools use the loopback.", kind: "decision" }) });
    expect(save.code).toBe(0);
    expect(host.named("save")).toHaveLength(1);
    expect(host.named("save")[0]).toMatchObject({ role: "lead", kind: "decision", content: "Decision: explicit memory tools use the loopback." });
    for (const entry of host.events) expect(entry.auth).toBe(`Bearer ${host.token}`);
    expect(JSON.stringify(search.events)).not.toContain(host.token);
  }, 120_000);

  realTest("a read-only child can search but memory_save is not even available to it", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    const delegate = JSON.stringify({ agent: "deck-investigate", task: "look around" });
    await harness.run(["delegate"], { ...leadEnv(), FAUX_LOG: fauxLog, FAUX_SCRIPT: "delegate", FAUX_DELEGATE: delegate, FAUX_CHILD_TOOL: "memory_search", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ query: "child question" }) });
    expect(host.named("search").map((event) => [event.role, event.query])).toEqual([["investigate", "child question"]]);
    expect(readLog(fauxLog).filter((entry) => entry.child).at(-1)!.text).toContain("SEARCH_HIT_7");

    host.events.length = 0;
    const blocked = join(harness.root, "faux-blocked.jsonl");
    await harness.run(["delegate"], { ...leadEnv(), FAUX_LOG: blocked, FAUX_SCRIPT: "delegate", FAUX_DELEGATE: delegate, FAUX_CHILD_TOOL: "memory_save", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ content: "Decision: a read-only child must not write memory." }) });
    expect(host.named("save")).toHaveLength(0);
    expect(readLog(blocked).filter((entry) => entry.child).at(-1)!.text).toContain("Tool memory_save not found");
  }, 180_000);

  realTest("with adaptive memory disabled or the handoff missing no memory tools exist", async () => {
    harness = createPiHarness();
    host = startFakeLoopbackHost({ dir: harness.root, advisory: ADVISORY });
    const fauxLog = join(harness.root, "faux.jsonl");
    const disabled = await harness.run(["x"], { ...leadEnv(), DECK_PI_MEMORY: "disabled", FAUX_LOG: fauxLog, FAUX_SCRIPT: "tool", FAUX_TOOL: "memory_search", FAUX_TOOL_INPUT: "{\"query\":\"q\"}" });
    expect(disabled.code).toBe(0);
    expect(host.events).toHaveLength(0);
    expect(readLog(fauxLog).at(-1)!.text).toContain("Tool memory_search not found");
  }, 120_000);
});
