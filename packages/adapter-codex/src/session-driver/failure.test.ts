import { expect, test } from "bun:test";
import { classifyCodexFailure, codexNotificationFailure } from "./failure";
import schema from "./__fixtures__/0.162.1/failure-schema.json";

// Codex 0.162.1 app-server generate-json-schema, v2/ErrorNotification.json, verified locally.
const overload = { message: "Selected model at capacity. PRIVATE_SENTINEL", codexErrorInfo: "serverOverloaded", additionalDetails: "PRIVATE_SENTINEL" };
test("named classifications use native CodexErrorInfo schema variants", () => {
  const variants = schema.CodexErrorInfo.anyOf;
  const names = variants.flatMap(variant => 'enum' in variant ? variant.enum ?? [] : []);
  for (const name of ["serverOverloaded", "flexUnavailable", "usageLimitExceeded", "rateLimitExceeded", "contextWindowExceeded", "sessionBudgetExceeded", "unauthorized", "badRequest"]) expect(names).toContain(name);
  const structured = variants.flatMap(variant => 'required' in variant ? variant.required ?? [] : []);
  for (const name of ["httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"]) expect(structured).toContain(name);
  expect(schema.ErrorNotification.required).toContain("willRetry");
});
test("Codex observed overload preserves category, without native prose or invented provider identity", () => {
  expect(classifyCodexFailure(overload)).toEqual({ category: "provider-overloaded", origin: "provider", certainty: "reported", code: "serverOverloaded" });
});
test("Codex structured error variants distinguish quota/rate/context and transport evidence", () => {
  expect(classifyCodexFailure({ codexErrorInfo: "usageLimitExceeded" })).toMatchObject({ category: "quota", origin: "provider" });
  expect(classifyCodexFailure({ codexErrorInfo: "rateLimitExceeded" })).toMatchObject({ category: "rate-limit" });
  expect(classifyCodexFailure({ codexErrorInfo: "contextWindowExceeded" })).toMatchObject({ category: "context-limit" });
  expect(classifyCodexFailure({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } })).toEqual({ category: "provider-unavailable", origin: "provider", certainty: "inferred", code: "httpConnectionFailed", httpStatus: 503 });
  expect(classifyCodexFailure({ codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } } })).toEqual({ category: "network", origin: "unknown", certainty: "reported", code: "responseStreamDisconnected" });
});
test("notification fallback requires the exact live thread and turn and never treats retrying as terminal", () => {
  const scope = { threadId: "thread", turnId: "turn" };
  const notification = { ...scope, error: overload, willRetry: false };
  expect(codexNotificationFailure(notification, scope)).toEqual(classifyCodexFailure(overload));
  for (const patch of [{ threadId: "old" }, { turnId: "old" }, { turnId: undefined }, { threadId: undefined }, { willRetry: true }, { willRetry: undefined }]) expect(codexNotificationFailure({ ...notification, ...patch }, scope)).toBeUndefined();
  expect(codexNotificationFailure(notification, { threadId: "thread" })).toBeUndefined();
});
test("unknown Codex codes and prose do not invent a cause; missing result evidence permits same-turn fallback", () => {
  expect(classifyCodexFailure({ message: "quota exceeded token=secret" })).toBeUndefined();
  expect(classifyCodexFailure({ codexErrorInfo: "sk-secret" })).toEqual({ category: "unknown", origin: "unknown", certainty: "inferred" });
  for (const info of [{ httpConnectionFailed: null }, { responseStreamDisconnected: [] }, { httpConnectionFailed: {}, responseStreamDisconnected: {} }]) expect(classifyCodexFailure({ codexErrorInfo: info })?.category).toBe("unknown");
  expect(classifyCodexFailure({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: "503", responseBody: "secret" } } })?.httpStatus).toBeUndefined();
});
