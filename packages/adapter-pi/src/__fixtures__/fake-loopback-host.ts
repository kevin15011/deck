/** Test-only in-process stand-in for the Deck Supermemory loopback host (127.0.0.1, bearer auth, v1 schema). */
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FakeHostEvent = { auth: string | null; body: Record<string, any> };

export function startFakeLoopbackHost(options: { dir: string; advisory?: string; token?: string }) {
  const token = options.token ?? "deck-loopback-fake-host-token";
  const events: FakeHostEvent[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = JSON.parse(await request.text());
      events.push({ auth: request.headers.get("authorization"), body });
      if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ ok: false, diagnostics: ["unauthorized"] }, { status: 401 });
      const recall = ["session_start", "recall", "role_start"].includes(body.event);
      return Response.json(recall ? { ok: true, advisoryText: options.advisory, diagnostics: [] } : { ok: true, diagnostics: [] });
    },
  });
  const tokenFile = join(options.dir, "memory-token");
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return {
    token,
    tokenFile,
    endpoint: `http://127.0.0.1:${server.port}/deck-runner-memory/v1`,
    events,
    named: (name: string) => events.filter((entry) => entry.body.event === name).map((entry) => entry.body),
    env: { DECK_RUNNER_MEMORY_ENDPOINT: `http://127.0.0.1:${server.port}/deck-runner-memory/v1`, DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile },
    stop: () => server.stop(true),
  };
}
