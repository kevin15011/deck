import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DECK_PI_CHILD_ENV,
  DECK_PI_ROLE_ENV,
  DECK_PI_SESSION_ENV,
  deckPiSessionEnv,
  guardDeckExtension,
  readDeckPiActivation,
  renderGuardedExtensionEntry,
} from "./pi-activation-guard";

describe("readDeckPiActivation", () => {
  test("a plain Pi session is inactive", () => {
    expect(readDeckPiActivation({})).toEqual({ active: false, child: false, lead: false, role: undefined });
    expect(readDeckPiActivation({ [DECK_PI_ROLE_ENV]: "lead" }).active).toBe(false);
  });

  test("only DECK_PI_SESSION=1 activates", () => {
    expect(readDeckPiActivation({ [DECK_PI_SESSION_ENV]: "0" }).active).toBe(false);
    expect(readDeckPiActivation({ [DECK_PI_SESSION_ENV]: "true" }).active).toBe(false);
    expect(readDeckPiActivation({ [DECK_PI_SESSION_ENV]: "1" })).toEqual({ active: true, child: false, lead: true, role: "lead" });
  });

  test("a child session carries its role and is never the lead", () => {
    const activation = readDeckPiActivation({ [DECK_PI_SESSION_ENV]: "1", [DECK_PI_CHILD_ENV]: "1", [DECK_PI_ROLE_ENV]: "investigate" });
    expect(activation).toEqual({ active: true, child: true, lead: false, role: "investigate" });
  });

  test("a non-lead role without the child marker is not the lead", () => {
    expect(readDeckPiActivation({ [DECK_PI_SESSION_ENV]: "1", [DECK_PI_ROLE_ENV]: "quality" }).lead).toBe(false);
  });
});

describe("deckPiSessionEnv", () => {
  test("lead launch environment", () => {
    expect(deckPiSessionEnv("lead")).toEqual({ DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead" });
  });

  test("child environment adds the child marker", () => {
    expect(deckPiSessionEnv("investigate", { child: true })).toEqual({ DECK_PI_SESSION: "1", DECK_PI_ROLE: "investigate", DECK_PI_CHILD: "1" });
  });
});

describe("guardDeckExtension", () => {
  function recorder() {
    const calls: string[] = [];
    const factory = (pi: { tag: string }) => { calls.push(pi.tag); };
    return { calls, factory };
  }

  test("is inert in a plain session", async () => {
    const { calls, factory } = recorder();
    await guardDeckExtension(factory, { env: {} })({ tag: "x" });
    expect(calls).toEqual([]);
  });

  test("runs in a Deck session", async () => {
    const { calls, factory } = recorder();
    await guardDeckExtension(factory, { env: { DECK_PI_SESSION: "1" } })({ tag: "x" });
    expect(calls).toEqual(["x"]);
  });

  test("lead-only extensions are inert in children", async () => {
    const { calls, factory } = recorder();
    const guarded = guardDeckExtension(factory, { env: { DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: "quality" }, scope: "lead" });
    await guarded({ tag: "x" });
    expect(calls).toEqual([]);
  });

  test("child-only extensions are inert for the lead", async () => {
    const { calls, factory } = recorder();
    await guardDeckExtension(factory, { env: { DECK_PI_SESSION: "1" }, scope: "child" })({ tag: "x" });
    expect(calls).toEqual([]);
  });

  test("reads the environment at call time by default", async () => {
    const { calls, factory } = recorder();
    const guarded = guardDeckExtension(factory);
    const previous = process.env.DECK_PI_SESSION;
    try {
      delete process.env.DECK_PI_SESSION;
      await guarded({ tag: "off" });
      process.env.DECK_PI_SESSION = "1";
      await guarded({ tag: "on" });
    } finally {
      if (previous === undefined) delete process.env.DECK_PI_SESSION;
      else process.env.DECK_PI_SESSION = previous;
    }
    expect(calls).toEqual(["on"]);
  });
});

describe("renderGuardedExtensionEntry", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  async function load(entrySource: string, env: Record<string, string | undefined>) {
    const dir = mkdtempSync(join(tmpdir(), "deck-guard-entry-"));
    dirs.push(dir);
    writeFileSync(join(dir, "impl.js"), "globalThis.__deckImplLoads = (globalThis.__deckImplLoads ?? 0) + 1;\nexport default function (pi) { pi.calls.push('impl'); }\n");
    writeFileSync(join(dir, "index.js"), entrySource);
    const saved = { ...process.env };
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    try {
      const module = await import(`${pathToFileURL(join(dir, "index.js")).href}?v=${Math.random()}`);
      const pi = { calls: [] as string[] };
      await module.default(pi);
      return pi.calls;
    } finally {
      for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  }

  test("does not even import the implementation in a plain Pi session", async () => {
    (globalThis as { __deckImplLoads?: number }).__deckImplLoads = 0;
    const calls = await load(renderGuardedExtensionEntry({ implFile: "./impl.js" }), { DECK_PI_SESSION: undefined });
    expect(calls).toEqual([]);
    expect((globalThis as { __deckImplLoads?: number }).__deckImplLoads).toBe(0);
  });

  test("loads and runs the implementation in a Deck session", async () => {
    const calls = await load(renderGuardedExtensionEntry({ implFile: "./impl.js" }), { DECK_PI_SESSION: "1", DECK_PI_CHILD: undefined, DECK_PI_ROLE: undefined });
    expect(calls).toEqual(["impl"]);
  });

  test("lead scope skips child sessions", async () => {
    const calls = await load(renderGuardedExtensionEntry({ implFile: "./impl.js", scope: "lead" }), { DECK_PI_SESSION: "1", DECK_PI_CHILD: "1", DECK_PI_ROLE: "quality" });
    expect(calls).toEqual([]);
  });

  test("emits plain ESM JavaScript with no TypeScript syntax", () => {
    const source = renderGuardedExtensionEntry({ implFile: "./impl.js" });
    expect(source).toContain("export default");
    expect(source).not.toMatch(/:\s*(string|boolean|number)\b/);
    expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(source)).not.toThrow();
  });
});
