import { afterEach, expect, test } from "bun:test";
import { createDeckMemoryExtension } from "./extension";
import { clearPublishedMemoryHandoff, readPublishedMemoryHandoff, resolveMemoryHandoff } from "../shared/memory-handoff";

const endpoint = "http://127.0.0.1:12345/deck-runner-memory/v1";
const secret = "fake-private-file-secret";
afterEach(clearPublishedMemoryHandoff);
function initialize(env: Record<string, string | undefined>, readFile = (_path: string) => secret) {
  const tools: string[] = [], notices: string[] = [];
  const handlers: Record<string, Function> = {};
  createDeckMemoryExtension({ env, readFile })({ registerTool: (tool: { name: string }) => tools.push(tool.name), on: (name: string, handler: Function) => { handlers[name] = handler; } } as never);
  handlers.session_start?.({}, { hasUI: true, ui: { notify: (text: string) => notices.push(text) } });
  expect(JSON.stringify({ notices, handoff: readPublishedMemoryHandoff(), env })).not.toContain(secret);
  expect(Object.keys(env).some(key => key.startsWith("DECK_RUNNER_MEMORY_TOKEN"))).toBe(false);
  return { tools, notices };
}
function fresh() { return { DECK_RUNNER_MEMORY_ENDPOINT: endpoint, DECK_RUNNER_MEMORY_TOKEN_FILE: "/fake/private-token" } as Record<string, string | undefined>; }

test("fresh and repeated initialization restore tools from matching scrubbed coordinates and reread the private file", () => {
  const env = fresh();
  const reads: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = initialize(env, path => { reads.push(path); return secret; });
    expect(result.tools).toEqual(["memory_search", "memory_save"]);
    expect(result.notices).toEqual([]);
  }
  expect(reads).toEqual(Array(3).fill("/fake/private-token"));
});

test("fresh explicit coordinates override published coordinates for memory and child forwarding", () => {
  initialize(fresh());
  const next = { DECK_RUNNER_MEMORY_ENDPOINT: endpoint.replace("12345", "12346"), DECK_RUNNER_MEMORY_TOKEN_FILE: "/fake/new-token" };
  expect(resolveMemoryHandoff(next)).toEqual({ endpoint: next.DECK_RUNNER_MEMORY_ENDPOINT, tokenFile: next.DECK_RUNNER_MEMORY_TOKEN_FILE });
  const paths: string[] = [];
  expect(initialize(next, path => { paths.push(path); return secret; }).tools).toHaveLength(2);
  expect(paths).toEqual(["/fake/new-token"]);
});

test("an explicit changed token file at the same endpoint wins over the scrubbed handoff", () => {
  const env = fresh(); initialize(env);
  env.DECK_RUNNER_MEMORY_TOKEN_FILE = "/fake/rotated-token";
  const paths: string[] = [];
  expect(initialize(env, path => { paths.push(path); return secret; }).tools).toHaveLength(2);
  expect(paths).toEqual(["/fake/rotated-token"]);
  expect(readPublishedMemoryHandoff()?.tokenFile).toBe("/fake/rotated-token");
});

test("partial or invalid explicit coordinates invalidate stale handoff, never cross-bind", () => {
  for (const replacement of [
    { DECK_RUNNER_MEMORY_ENDPOINT: undefined },
    { DECK_RUNNER_MEMORY_ENDPOINT: "", DECK_RUNNER_MEMORY_TOKEN_FILE: "/fake/token" },
    { DECK_RUNNER_MEMORY_ENDPOINT: endpoint.replace("12345", "54321") },
    { DECK_RUNNER_MEMORY_TOKEN_FILE: "" },
    { DECK_RUNNER_MEMORY_TOKEN_FILE: undefined },
    { DECK_RUNNER_MEMORY_ENDPOINT: "http://example.com", DECK_RUNNER_MEMORY_TOKEN_FILE: "/fake/token" },
  ]) {
    const env = fresh(); initialize(env); Object.assign(env, replacement);
    if (env.DECK_RUNNER_MEMORY_ENDPOINT !== "http://example.com") expect(resolveMemoryHandoff(env)).toBeUndefined();
    const result = initialize(env);
    expect(result.tools).toEqual([]); expect(result.notices).toHaveLength(1);
    expect(readPublishedMemoryHandoff()).toBeUndefined();
    expect(initialize(env).tools).toEqual([]);
  }
});

test("disabled clears stale handoff silently and cannot revive on reenable", () => {
  const env = fresh(); initialize(env); env.DECK_PI_MEMORY = "disabled";
  expect(resolveMemoryHandoff(env)).toBeUndefined();
  expect(initialize(env)).toEqual({ tools: [], notices: [] });
  expect(readPublishedMemoryHandoff()).toBeUndefined();
  delete env.DECK_PI_MEMORY;
  expect(initialize(env).tools).toEqual([]);
});

test("reload still validates unreadable and empty private files and read-only roles", () => {
  for (const read of [() => "  ", () => { throw new Error(secret); }]) {
    const env = fresh(); initialize(env);
    const result = initialize(env, read);
    expect(result.tools).toEqual([]); expect(result.notices).toHaveLength(1);
    expect(readPublishedMemoryHandoff()).toBeUndefined();
  }
  const env = { ...fresh(), DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" };
  for (let i = 0; i < 3; i++) expect(initialize(env).tools).toEqual(["memory_search"]);
});
