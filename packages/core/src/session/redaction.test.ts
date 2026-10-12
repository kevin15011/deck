import { describe, expect, test } from "bun:test";
import { redactText } from "./redaction";

describe("redactText", () => {
  const cases: Array<[string, string, string]> = [
    ["Bearer", "Authorization ok Bearer abc.def-123 end", "abc.def-123"],
    ["Basic", "x Basic dXNlcjpwYXNz y", "dXNlcjpwYXNz"],
    ["api_key=", "run api_key=sk-12345 now", "sk-12345"],
    ["JSON token", 'payload {"token": "tok_secret"}', "tok_secret"],
    ["password colon", "password: hunter2", "hunter2"],
    ["authorization header", "Authorization: Token zzz999", "zzz999"],
  ];
  test.each(cases)("redacts %s", (_n, input, secret) => {
    const out = redactText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("redacted");
  });
  test("strips ANSI, OSC and bidi/control characters", () => {
    expect(redactText("\x1b[31mred\x1b[0m")).toBe("red");
    expect(redactText("\x1b]0;title\x07ok")).toBe("ok");
    expect(redactText("a‮b⁦c\x00d")).toBe("abcd");
  });
  test("applies the cap after redaction", () => {
    expect(redactText("x".repeat(100), 10)).toBe("x".repeat(10));
  });
  test("bounds work on huge input", () => {
    expect(redactText("y".repeat(1_000_000), 1_000_000).length).toBeLessThanOrEqual(256 * 1024);
  });
  test("leaves plain text alone", () => {
    expect(redactText("hello world")).toBe("hello world");
  });
});
