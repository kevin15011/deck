/** Test-only in-process stand-in for the Deck Supermemory loopback host (127.0.0.1, bearer auth, v1 schema). */
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FakeHostEvent = { auth: string | null; body: Record<string, any> };

export function startFakeLoopbackHost(options: { dir: string; advisory?: string; token?: string; searchAdvisory?: string; saveRefusal?: string }) {
  const token = options.token ?? "deck-loopback-fake-host-token";
  const events: FakeHostEvent[] = [];
  const acceptedSaves: Record<string, any>[] = [];
  const seen = new Set<string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = JSON.parse(await request.text());
      events.push({ auth: request.headers.get("authorization"), body });
      if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ ok: false, diagnostics: ["unauthorized"] }, { status: 401 });
      if (body.event === "search") return Response.json({ ok: true, advisoryText: options.searchAdvisory ?? "<DECK_ADAPTIVE_CONTEXT_JSON_V1>\nSEARCH_HIT_7\n</DECK_ADAPTIVE_CONTEXT_JSON_V1>", resultCount: 1, diagnostics: [] });
      if (body.event === "save") {
        if (seen.has(body.eventId)) return Response.json({ ok: true, diagnostics: ["duplicate-event"] });
        seen.add(body.eventId);
        if (!options.saveRefusal) acceptedSaves.push(body);
        return Response.json(options.saveRefusal ? { ok: false, diagnostics: [options.saveRefusal] } : { ok: true, diagnostics: [] });
      }
      const recall = ["session_start", "recall", "role_start", "compaction_recall"].includes(body.event);
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
    acceptedSaves,
    named: (name: string) => events.filter((entry) => entry.body.event === name).map((entry) => entry.body),
    env: { DECK_RUNNER_MEMORY_ENDPOINT: `http://127.0.0.1:${server.port}/deck-runner-memory/v1`, DECK_RUNNER_MEMORY_TOKEN_FILE: tokenFile },
    stop: () => server.stop(true),
  };
}
