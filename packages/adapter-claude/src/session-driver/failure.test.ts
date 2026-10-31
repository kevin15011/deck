import { expect, test } from "bun:test";
import { classifyClaudeFailure } from "./failure";
import { ClaudeStreamMapper } from "./mapper";

// Selected structured fields from session 20261021T141551-27e992, native seq 27013–27014.
// Native prose, response bodies, usage and identifiers are intentionally excluded.
const api = { api_error_status: 429, api_error: "usage_limit_reached", api_error_origin: "first_party" };
const assistant = { type: "assistant", error: "rate_limit", ...api,
  api_error_params: { rate_limit_info: { status: "rejected", resetsAt: 1792607400, rateLimitType: "five_hour" } } };
const result = { type: "result", subtype: "success", is_error: true, terminal_reason: "api_error", ...api };

test("structured Claude usage limits are quota failures, even with success subtype", () => {
  const mapper = new ClaudeStreamMapper();
  mapper.map(assistant);
  expect(mapper.map(result).result?.failure).toEqual({ category: "quota", origin: "provider", certainty: "reported", provider: "anthropic", code: "usage_limit_reached", httpStatus: 429, resetAt: new Date(1792607400 * 1000).toISOString() });
});
test("Claude classification uses structured evidence and explicit origin", () => {
  expect(classifyClaudeFailure({ api_error_status: 429, api_error_origin: "first_party" })).toMatchObject({ category: "rate-limit", origin: "provider", certainty: "inferred" });
  expect(classifyClaudeFailure({ api_error_status: 503, api_error_origin: "first_party" })).toMatchObject({ category: "provider-unavailable", origin: "provider" });
  expect(classifyClaudeFailure({ api_error_status: 401 })).toMatchObject({ category: "authentication", origin: "unknown" });
  expect(classifyClaudeFailure({ errors: ["provider overloaded token=secret"], api_error: "token=secret" })).toBeUndefined();
});
test("result evidence takes precedence; resets are never borrowed from an unrelated category or allowed limit", () => {
  const mapper = new ClaudeStreamMapper(); mapper.map(assistant);
  expect(mapper.map({ ...result, api_error: undefined, api_error_status: 401 }).result?.failure).toMatchObject({ category: "authentication" });
  expect(mapper.map({ ...result, api_error: undefined, api_error_status: 401 }).result?.failure?.resetAt).toBeUndefined();
  const allowed = new ClaudeStreamMapper(); allowed.map({ ...assistant, api_error_params: { rate_limit_info: { status: "allowed", resetsAt: 1792607400 } } });
  expect(allowed.map(result).result?.failure?.resetAt).toBeUndefined();
});
test("malformed reset evidence is discarded and new mapper instances have no inherited failure", () => {
  for (const resetsAt of ["1792607400", -1, NaN, Infinity, 1e20]) expect(classifyClaudeFailure({ ...assistant, api_error_params: { rate_limit_info: { status: "rejected", resetsAt } } })?.resetAt).toBeUndefined();
  expect(new ClaudeStreamMapper().map({ type: "result", subtype: "success", is_error: false }).result?.failure).toBeUndefined();
});
test("a successful retry clears the API fallback; unrelated later terminal errors cannot borrow it", () => {
  const mapper = new ClaudeStreamMapper(); mapper.map(assistant);
  mapper.map({ type: "assistant", message: { content: [{ type: "text", text: "Recovered" }] } });
  expect(mapper.map({ type: "result", subtype: "success", is_error: false }).result?.failure).toBeUndefined();
  expect(mapper.map({ type: "result", subtype: "success", is_error: true, terminal_reason: "api_error" }).result?.failure).toBeUndefined();
  const unrelated = new ClaudeStreamMapper(); unrelated.map(assistant);
  expect(unrelated.map({ type: "result", subtype: "error_max_turns", is_error: true }).result?.failure).toBeUndefined();
});
test("driver-scoped mapping never borrows API/reset fields from an uncorrelated session or native child", () => {
  for (const patch of [{}, { session_id: "foreign" }, { session_id: "current", parent_tool_use_id: "child-tool" }]) {
    const mapper = new ClaudeStreamMapper(undefined, "current"); mapper.map({ ...assistant, ...patch });
    expect(mapper.map({ type: "result", session_id: "current", subtype: "success", is_error: true, terminal_reason: "api_error" }).result?.failure).toBeUndefined();
  }
  const mapper = new ClaudeStreamMapper(undefined, "current"); mapper.map({ ...assistant, session_id: "current" });
  expect(mapper.map({ ...result, session_id: "current" }).result?.failure?.resetAt).toBe(new Date(1792607400 * 1000).toISOString());
});
