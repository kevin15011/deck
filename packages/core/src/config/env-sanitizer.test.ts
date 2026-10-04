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

  test("recognizes the real Pi session directory variable and drops the ignored legacy one", () => {
    const env = sanitizeRunnerEnv({
      PATH: "/usr/bin",
      PI_CODING_AGENT_SESSION_DIR: "/work/.deck/pi/sessions/developer-team",
      PI_SESSION_DIR: "/work/.deck/pi/sessions/ignored",
    });
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBe("/work/.deck/pi/sessions/developer-team");
    // PI_SESSION_DIR is not a Pi 1.0 variable; it is a session-keyed name, so it is no longer allowlisted.
    expect(env).not.toHaveProperty("PI_SESSION_DIR");
  });

  test("forwards the Pi agent directory and Deck Pi session markers", () => {
    const env = sanitizeRunnerEnv({
      PI_CODING_AGENT_DIR: "/opt/pi-home",
      DECK_PI_SESSION: "1",
      DECK_PI_ROLE: "lead",
      DECK_PI_CHILD: "1",
    });
    expect(env).toEqual({
      PI_CODING_AGENT_DIR: "/opt/pi-home",
      DECK_PI_SESSION: "1",
      DECK_PI_ROLE: "lead",
      DECK_PI_CHILD: "1",
    });
  });
});
