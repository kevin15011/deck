import { describe, expect, test } from "bun:test";

import { evaluateAdaptiveMemoryCaptureEligibility } from "./capture-eligibility";

describe("adaptive-memory capture eligibility", () => {
  test("accepts high-signal user and assistant content", () => {
    expect(evaluateAdaptiveMemoryCaptureEligibility({
      source: "trusted-user-prompt",
      content: "Remember that Deck runtime credentials are stored only in the owner-only secret store.",
    })).toMatchObject({ eligible: true });
    expect(evaluateAdaptiveMemoryCaptureEligibility({
      source: "trusted-final-assistant",
      content: "Implemented bounded Codex final-message capture and verified it with production-path tests.",
    })).toMatchObject({ eligible: true });
  });

  test.each([
    ["raw_log_or_test_output", "$ bun test\nFAIL runtime.test.ts\nExpected: 1\nReceived: 2"],
    ["stack_trace", "Error: boom\n    at run (/tmp/app.ts:1:1)\n    at main (/tmp/main.ts:2:1)"],
    ["diff_or_patch", "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n"],
    ["source_dump", "```ts\nimport x from 'x';\nexport function run() {\n  const value = 1;\n  if (value) {\n    return value;\n  }\n}\n```"],
    ["tool_chatter", "<function=functions.bash>\nstdout: ok\nstderr: warning"],
    ["secret_detected", "PATH=/bin\nHOME=/home/dev\nSUPERMEMORY_API_KEY=fake-secret-value"],
    ["external_or_official_artifact", "OFFICIAL CONTEXT\n## ADDED Requirements\n- The system SHALL do something."],
    ["trivial_operational_text", "continue"],
    ["no_high_signal_category", "Please implement the dashboard updates and run the relevant tests."],
    ["no_high_signal_category", "Write a short poem about reliable software systems."],
  ])("rejects %s even when captured from trusted text", (reason, content) => {
    expect(evaluateAdaptiveMemoryCaptureEligibility({ source: "trusted-user-prompt", content })).toMatchObject({ eligible: false, reason });
  });

  test.each([
    "password: fake-password-value",
    "{ \"apiKey\": \"fake-api-key-value\" }",
    "token = \"fake-token-value\"",
    "secret: fake-secret-value",
    "--password fake-password-value",
    "https://fake-user:fake-password@example.invalid/path",
    "DATABASE_URL=postgres://user:pass@host/db",
    "DATABASE_URI=postgres://user:pass@host/db",
    "Implemented a database fix. DATABASE_URL=postgres://user:pass@host/db",
    "APP_URI=https://user:pass@example.invalid/private",
    "SQLITE_DSN=file:///home/dev/private/customer.sqlite",
    "DATABASE_URI=/home/dev/private/prod.db",
    "REDIS_URL=redis://default:pass@cache.example.invalid:6379/0",
    "SENTRY_DSN=https://public:secret@sentry.example.invalid/1",
    "MONGODB_URL=mongodb+srv://user:pass@cluster.example.invalid/app",
    "postgres://user:pass@host/db",
    "mysql://user:pass@host/db",
    "Authorization: Bearer fake-token-value",
    "Set-Cookie: session=fake-session-value; HttpOnly",
    "AWS_SECRET_ACCESS_KEY=fake-cloud-secret-value",
    "PRIVATE_KEY=-----BEGIN PRIVATE KEY-----fake",
    "Cookie: session=fake-session-value",
    "SESSION_ID=fake-session-value",
  ])("rejects high-confidence secret form before transport: %s", (content) => {
    expect(evaluateAdaptiveMemoryCaptureEligibility({
      source: "trusted-final-assistant",
      content: `Implemented a credential handling fix. ${content}`,
    })).toMatchObject({ eligible: false, reason: "secret_detected" });
  });
});
