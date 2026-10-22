import { describe, expect, test } from "bun:test";
import { sanitizeTurnFailure } from "./failure";

describe("terminal failure metadata", () => {
  const reported = { category: "provider-overloaded", origin: "provider", certainty: "reported" } as const;
  test("retains bounded structured evidence and strips payloads instead of copying native prose", () => {
    expect(sanitizeTurnFailure({ ...reported, code: "serverOverloaded", provider: "openai", httpStatus: 503,
      resetAt: "2026-10-22T01:00:00.000Z", message: "secret", headers: { authorization: "secret" }, body: "secret", recoverable: true,
    })).toEqual({ ...reported, code: "serverOverloaded", provider: "openai", httpStatus: 503, resetAt: "2026-10-22T01:00:00.000Z" });
  });
  test("a token regex is insufficient: only enumerated codes and provider identities survive", () => {
    for (const token of ["sk-secret", "attacker", "__proto__", "constructor", "https://private.example"]) {
      expect(sanitizeTurnFailure({ ...reported, code: token, provider: token })).toEqual(reported);
    }
  });
  test("invalid required metadata safely disappears", () => {
    for (const input of [undefined, null, [], "secret", {}, { ...reported, category: "constructor" }, { ...reported, origin: "external" }, { ...reported, certainty: "sure" },
      Object.defineProperty({}, "category", { get() { throw Error("secret"); } })]) {
      expect(sanitizeTurnFailure(input)).toBeUndefined();
    }
  });
  test("invalid optional fields never invalidate an otherwise useful terminal", () => {
    for (const value of [NaN, Infinity, -1, {}, "429", 200, 600]) expect(sanitizeTurnFailure({ ...reported, httpStatus: value })).toEqual(reported);
    for (const value of [0, "secret", "2026-02-30T00:00:00.000Z", "2026-10-22", "99999-01-01T00:00:00.000Z"]) expect(sanitizeTurnFailure({ ...reported, resetAt: value })).toEqual(reported);
  });
  test("unknown attribution is explicit and accepted without guessing a provider", () => {
    expect(sanitizeTurnFailure({ category: "unknown", origin: "unknown", certainty: "inferred" })).toEqual({ category: "unknown", origin: "unknown", certainty: "inferred" });
  });
});
