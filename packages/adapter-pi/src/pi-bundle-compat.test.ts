import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { adaptBunBundleForNode } from "./pi-bundle-compat";
import { readPiExecutionExtensionSource } from "./pi-team-profile";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempFile = (name: string, content: string) => {
  const dir = mkdtempSync(join(tmpdir(), "deck-bundle-compat-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

describe("adaptBunBundleForNode", () => {
  test("replaces the Bun-only import.meta.require with a createRequire shim", () => {
    const adapted = adaptBunBundleForNode("// @bun\nvar N0=import.meta.require;export default function(){return N0('node:path').sep}");
    expect(adapted).not.toContain("import.meta.require");
    expect(adapted).toContain("createRequire");
    expect(adapted).toContain("import.meta.url");
  });

  test("is idempotent and leaves bundles without the Bun-only API untouched", () => {
    const plain = "export default function(){return 1}\n";
    expect(adaptBunBundleForNode(plain)).toBe(plain);
    const once = adaptBunBundleForNode("var N0=import.meta.require;");
    expect(adaptBunBundleForNode(once)).toBe(once);
  });

  const nodePath = Bun.which("node");
  const nodeTest = nodePath ? test : test.skip;

  nodeTest("the adapted bundle executes under Node (Pi's runtime) where the original fails", async () => {
    const original = "var N0=import.meta.require;export default function(){return N0('node:path').sep}\n";
    const run = async (file: string) => {
      const child = Bun.spawn([nodePath!, "--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(m.default());`], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code: await child.exited, stdout: stdout.trim(), stderr };
    };
    expect((await run(tempFile("original.mjs", original))).code).not.toBe(0);
    const adapted = await run(tempFile("adapted.mjs", adaptBunBundleForNode(original)));
    expect(adapted.code).toBe(0);
    expect(adapted.stdout).toBe("/");
  });

  nodeTest("the packaged execution extension bundle loads under Node once adapted", async () => {
    const file = tempFile("execution.mjs", adaptBunBundleForNode(readPiExecutionExtensionSource()));
    const child = Bun.spawn([nodePath!, "--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(typeof m.default, typeof m.createPiDeveloperTeamExecutionExtensionV1);`], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code: await child.exited, stdout: stdout.trim(), stderr: stderr.slice(0, 400) }).toEqual({ code: 0, stdout: "function function", stderr: "" });
  });
});
