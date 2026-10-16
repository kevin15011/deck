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

test.each(["token", "access_token", "refresh_token", "api_key", "apikey", "key", "secret", "password", "passwd", "sig", "signature", "auth", "authorization"])("URL %s is redacted while other parameters survive", key => {
  expect(redactText(`https://alice:p%40ss@example.com/path?ok=1&${key}=private-value&next=2#section`)).toBe(`https://[redacted]@example.com/path?ok=1&${key}=[redacted]&next=2#section`);
  const encoded = Array.from(key, char => `%${char.charCodeAt(0).toString(16)}`).join("");
  expect(redactText(`https://host/?${encoded}=private-value&view=full`)).toBe(`https://host/?${encoded}=[redacted]&view=full`);
});
test("URL user-only credentials and mixed case query keys", () => {
  expect(redactText("ssh://alice@example.com/path?TOKEN=value&view=full")).toBe("ssh://[redacted]@example.com/path?TOKEN=[redacted]&view=full");
});

test.each([
  ["https://alice:prefix@SECRET@host/path?view=full", "https://[redacted]@host/path?view=full"],
  ["https://alice@prefix@SECRET@host:8443/path#section", "https://[redacted]@host:8443/path#section"],
  ["https://host/?%73ig=SECRET&view=full", "https://host/?%73ig=[redacted]&view=full"],
  ["https://host/?%61ccess%5Ftoken=SECRET&view=full", "https://host/?%61ccess%5Ftoken=[redacted]&view=full"],
  ["https://host/?%53IGNATURE=SECRET&view=full", "https://host/?%53IGNATURE=[redacted]&view=full"],
])("URL credential regression: %s", (input, expected) => {
  expect(redactText(input)).toBe(expected);
});

test("URL redaction preserves nonsecret encoded parameters, malformed names and path at-signs", () => {
  const url = "https://host/path@segment?%76iew=full&bad%ZZ=keep&next=a%40b#user@fragment";
  expect(redactText(url)).toBe(url);
});
