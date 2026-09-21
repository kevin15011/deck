import { describe, expect, test } from "bun:test";

import { sanitizeRunnerEnv } from "./env-sanitizer";

describe("sanitizeRunnerEnv", () => {
  test("removes personal access tokens while preserving Deck loopback credentials", () => {
    expect(sanitizeRunnerEnv({
      PATH: "/usr/bin",
      GITHUB_MCP_PAT: "github-secret",
      GIT_PERSONAL_ACCESS_TOKEN: "git-secret",
      DECK_RUNNER_MEMORY_TOKEN: "loopback-token",
    })).toEqual({
      PATH: "/usr/bin",
      DECK_RUNNER_MEMORY_TOKEN: "loopback-token",
    });
  });
});
