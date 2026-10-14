import { expect, test } from "bun:test";
import { collectContractShapes, compareContractShapes } from "./session-contract-shapes";

test("records only field names and types, never payload or credential values", () => {
  const shapes = collectContractShapes([{ kind: "message.completed", data: { text: "private message", token: "secret-token" }, raw: { method: "item/completed", params: { text: "private raw" } } }]);
  const encoded = JSON.stringify(shapes);
  expect(encoded).not.toContain("secret-token");
  expect(encoded).not.toContain("private message");
  expect(encoded).not.toContain("private raw");
  expect(encoded).toContain("string");
});

test("comparison reports new fields and types while allowing unobserved optional fixture fields", () => {
  const baseline = collectContractShapes([{ kind: "message.completed", data: { text: "hello", optional: 1 } }]);
  expect(compareContractShapes(baseline, collectContractShapes([{ kind: "message.completed", data: { text: "other" } }]))).toEqual([]);
  expect(compareContractShapes(baseline, collectContractShapes([{ kind: "message.completed", data: { text: 2 } }]))).toEqual(["message.completed.data.text: unexpected number"]);
});

test("versioned native manifests contain only bounded field paths and type names", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  for (const [runner, version] of [["claude", "2.1.296"], ["codex", "0.162.1"], ["opencode", "1.18.31"]]) {
    const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, `../packages/adapter-${runner}/src/session-driver/__fixtures__/${version}/live-shapes.json`), "utf8"));
    expect(fixture).toMatchObject({ schema: "deck-session-contract-shapes-v1", runner, version });
    expect(Object.keys(fixture.shapes).length).toBeGreaterThan(20);
    for (const [path, types] of Object.entries(fixture.shapes)) {
      expect(path.length).toBeLessThan(1024);
      expect(Array.isArray(types) && types.every(type => ["array", "boolean", "null", "number", "object", "string", "undefined"].includes(type))).toBe(true);
    }
  }
});
