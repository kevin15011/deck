import { expect, test } from "bun:test";
import { assertCodexContextSequence, codexRequestPhase, modelVisibleText } from "./__fixtures__/codex-context-oracle";

test("telemetry cannot supply the current project to model context", () => {
  const body = {
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "prior alpha history" }] }],
    client_metadata: { workspaces: { beta: {} } },
  };
  expect(modelVisibleText(body)).not.toContain("beta");
  expect(modelVisibleText(body)).toContain("prior alpha history");
});

const prior = { root: "/project/alpha" };
const current = { root: "/project/beta" };
const expected = { prior, current, required: ["root-role", "durable-role"] };
const request = (text: string, kind = "turn", history = "new", compaction?: object) => ({
  input: [{ type: "message", role: "developer", content: [{ type: "input_text", text }] }],
  client_metadata: { "x-codex-turn-metadata": JSON.stringify({
    request_kind: kind, history_initialization: history, compaction,
    workspaces: { [current.root]: {} }, telemetry: "root-role durable-role",
  }) },
});
const startup = () => request("root-role durable-role /project/alpha");
const compaction = () => request("root-role durable-role /project/alpha", "compaction", "cold_resume", { phase: "pre_turn" });
const continuation = () => request("root-role durable-role /project/beta", "turn", "cold_resume");

test("prior-history compaction is followed by a current-project task", () => {
  const checks = assertCodexContextSequence([startup()], [compaction(), continuation()], expected);
  expect(checks.map(check => check.phase)).toEqual(["startup", "prior-history", "resumed-task"]);
});

// Each deletion represents a missing delivery, with the same value still in telemetry.
test.each([
  ["root-role", "missing required role context"],
  ["durable-role", "missing required role context"],
  ["/project/beta", "missing project context"],
])("resumed task rejects missing %s even when telemetry contains it", (missing, error) => {
  const body = continuation();
  body.input[0]!.content[0]!.text = body.input[0]!.content[0]!.text.replace(missing, "");
  expect(() => assertCodexContextSequence([startup()], [compaction(), body], expected)).toThrow(error);
});

test.each(["root-role", "durable-role", "/project/alpha"])("prior-history phase retains %s", missing => {
  const body = compaction();
  body.input[0]!.content[0]!.text = body.input[0]!.content[0]!.text.replace(missing, "");
  expect(() => assertCodexContextSequence([startup()], [body, continuation()], expected)).toThrow();
});

test("startup requires actual current project context", () => {
  const body = startup();
  body.input = [];
  expect(() => assertCodexContextSequence([body], [compaction(), continuation()], expected)).toThrow();
});

test.each([
  ["missing continuation", () => [compaction()]],
  ["repeated compaction without continuation", () => [compaction(), compaction()]],
  ["missing compaction", () => [continuation()]],
  ["reversed sequence", () => [continuation(), compaction()]],
  ["startup posing as continuation", () => [compaction(), startup()]],
  ["compaction after task", () => [compaction(), continuation(), compaction()]],
])("rejects %s", (_name, resumed) => {
  expect(() => assertCodexContextSequence([startup()], resumed(), expected)).toThrow();
});

test.each([
  {},
  { client_metadata: { "x-codex-turn-metadata": "invalid json" } },
  request("context", "unknown"),
  request("context", "turn", "unknown"),
  request("context", "compaction", "cold_resume", { phase: "post_turn" }),
  request("context", "turn", "cold_resume", { phase: "pre_turn" }),
])("unknown or missing phases fail closed (%#)", body => {
  expect(() => codexRequestPhase(body)).toThrow();
});

test("custom sessions exclude root role from model input, regardless of telemetry", () => {
  const bodies = [startup(), compaction(), continuation()];
  for (const body of bodies) body.input[0]!.content[0]!.text = body.input[0]!.content[0]!.text.replace("root-role", "");
  const custom = { ...expected, required: ["durable-role"], forbidden: ["root-role"] };
  expect(assertCodexContextSequence(bodies.slice(0, 1), bodies.slice(1), custom)).toHaveLength(3);
  bodies[2]!.input[0]!.content[0]!.text += " root-role";
  expect(() => assertCodexContextSequence(bodies.slice(0, 1), bodies.slice(1), custom)).toThrow("forbidden role context");
});

test("only textual input and instructions can satisfy a context marker", () => {
  const body = { instructions: "durable", input: [
    { type: "message", role: "developer", metadata: "hidden", content: [{ type: "input_text", text: "root" }, { type: "image", text: "hidden" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "history" }] },
  ], tools: [{ description: "hidden" }], arbitrary: "hidden" };
  expect(modelVisibleText(body)).toBe("durable\nroot\nhistory");
  expect(modelVisibleText({ input: "direct prompt" })).toBe("direct prompt");
});
