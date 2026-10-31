import { expect, test } from "bun:test";
import { classifyOpenCodeFailure } from "./failure";
import schema from "./__fixtures__/1.19.1/failure-schema.json";

// Message-domain NamedError schemas inspected in local OpenCode 1.19.1 binary on 2026-10-22.
// ProviderAuthError {data:{providerID,message}}, APIError {data:{message,statusCode?,isRetryable,...}},
// ContextOverflowError {data:{message,responseBody?}}, ContentFilterError {data:{message}}.
test("named classifiers match the inspected local message-domain declarations", () => {
  for (const [name, source] of Object.entries(schema.declarations)) expect(source.declaration).toContain(`create("${name}",`);
  expect(schema.declarations.APIError.declaration).toContain('statusCode:Q.optional');
  expect(schema.declarations.ProviderAuthError.declaration).toContain('providerID:Q.String');
  expect(schema.serialization.declaration).toContain('return{name:e,data:this.data}');
});
test("classifies verified OpenCode message errors without retaining bodies, headers or prose", () => {
  expect(classifyOpenCodeFailure({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "PRIVATE_SENTINEL" } })).toEqual({ category: "authentication", origin: "provider", certainty: "reported", code: "ProviderAuthError", provider: "anthropic" });
  expect(classifyOpenCodeFailure({ name: "ContextOverflowError", data: { message: "PRIVATE_SENTINEL", responseBody: "PRIVATE_SENTINEL" } })).toEqual({ category: "context-limit", origin: "unknown", certainty: "reported", code: "ContextOverflowError" });
  expect(classifyOpenCodeFailure({ name: "APIError", data: { message: "PRIVATE_SENTINEL", statusCode: 429, isRetryable: true, responseHeaders: { authorization: "PRIVATE_SENTINEL", "retry-after": "40" }, responseBody: "PRIVATE_SENTINEL" } })).toEqual({ category: "rate-limit", origin: "provider", certainty: "inferred", code: "APIError", httpStatus: 429 });
  expect(classifyOpenCodeFailure({ name: "APIError", data: { message: "quota exceeded", isRetryable: false } })).toEqual({ category: "unknown", origin: "unknown", certainty: "inferred" });
});
test("context overflow names do not distinguish local compaction from upstream failures", () => {
  for (const data of [
    { message: "Session too large to compact - context exceeds model limit even after stripping media" },
    { message: "The provider reported a context overflow", responseBody: "PRIVATE_SENTINEL" },
  ]) {
    expect(classifyOpenCodeFailure({ name: "ContextOverflowError", data })).toEqual({ category: "context-limit", origin: "unknown", certainty: "reported", code: "ContextOverflowError" });
  }
});
test("unknown/malformed OpenCode shapes never invent quota, auth or provider identity", () => {
  for (const input of [null, { name: "ProviderAuthError" }, { name: "APIError", data: { statusCode: "429" } }, { name: "UnknownError", data: { message: "serverOverloaded" } }]) expect(classifyOpenCodeFailure(input)).toEqual({ category: "unknown", origin: "unknown", certainty: "inferred" });
  const auth = classifyOpenCodeFailure({ name: "ProviderAuthError", data: { providerID: "sk-secret", message: "secret" } });
  expect(auth.provider).toBeUndefined(); expect(JSON.stringify(auth)).not.toContain("secret");
});
test("HTTP status means unavailability, not proof of overload or native retry exhaustion", () => {
  expect(classifyOpenCodeFailure({ name: "APIError", data: { message: "overloaded", statusCode: 503, isRetryable: false } })).toEqual({ category: "provider-unavailable", origin: "provider", certainty: "inferred", code: "APIError", httpStatus: 503 });
});
