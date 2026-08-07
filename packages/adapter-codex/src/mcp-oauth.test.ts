import { describe, expect, test } from "bun:test";

import { inspectCodexSupermemoryOAuth } from "./mcp-oauth";

describe("Codex Supermemory OAuth inspection", () => {
  test("uses the supported list JSON command and recognizes authenticated native OAuth", async () => {
    const requests: unknown[] = [];
    const result = await inspectCodexSupermemoryOAuth({
      projectRoot: "/fixture",
      commandRunner: {
        async run(request) {
          requests.push(request);
          return {
            exitCode: 0,
            stdout: JSON.stringify([{
              name: "supermemory",
              enabled: true,
              auth_status: "oauth",
              transport: { type: "streamable_http", url: "https://mcp.supermemory.ai/mcp", bearer_token_env_var: null },
            }]),
            stderr: "",
          };
        },
      },
    });

    expect(requests).toEqual([expect.objectContaining({
      file: "codex",
      args: ["mcp", "list", "--json"],
      cwd: "/fixture",
    })]);
    expect(result).toEqual({ state: "authenticated" });
  });

  test("fails closed for missing, unauthenticated, malformed, and secret-bearing command output", async () => {
    const inspect = (stdout: string) => inspectCodexSupermemoryOAuth({
      projectRoot: "/fixture",
      commandRunner: { async run() { return { exitCode: 0, stdout, stderr: "token=sentinel" }; } },
    });

    await expect(inspect(JSON.stringify([]))).resolves.toEqual({ state: "not-configured" });
    await expect(inspect(JSON.stringify([{
      name: "supermemory",
      enabled: true,
      auth_status: "not_logged_in",
      transport: { type: "streamable_http", url: "https://mcp.supermemory.ai/mcp" },
    }]))).resolves.toEqual({ state: "not-authenticated" });
    await expect(inspect(JSON.stringify([{
      name: "supermemory",
      enabled: true,
      auth_status: "logged_in",
      transport: { type: "streamable_http", url: "https://mcp.supermemory.ai/mcp" },
    }]))).resolves.toEqual({ state: "not-authenticated" });
    await expect(inspect(JSON.stringify([{
      name: "supermemory",
      enabled: false,
      auth_status: "oauth",
      transport: { type: "streamable_http", url: "https://mcp.supermemory.ai/mcp" },
    }]))).resolves.toEqual({ state: "not-configured" });
    for (const enabled of [undefined, "true", 1]) {
      await expect(inspect(JSON.stringify([{
        name: "supermemory",
        ...(enabled === undefined ? {} : { enabled }),
        auth_status: "oauth",
        transport: { type: "streamable_http", url: "https://mcp.supermemory.ai/mcp" },
      }]))).resolves.toEqual({ state: "not-configured" });
    }
    await expect(inspect(JSON.stringify([{
      name: "supermemory",
      enabled: true,
      auth_status: "logged_in",
      transport: {
        type: "streamable_http",
        url: "https://mcp.supermemory.ai/mcp",
        bearer_token_env_var: "SUPERMEMORY_API_KEY",
      },
    }]))).resolves.toEqual({ state: "not-configured" });
    await expect(inspect("not json")).resolves.toEqual({ state: "unknown" });
  });
});
