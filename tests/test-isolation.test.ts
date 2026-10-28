import { expect, test } from "bun:test";
import os, { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import { isolatedPaths, realHome, testRoot } from "../scripts/test-isolation";
import { getDeckXdgPaths } from "../apps/cli/src/runtime/paths";
import { resolveStatePaths } from "../packages/session-host/src/paths";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

test("default user and Deck state paths stay inside the worker sandbox", () => {
  const paths = [...Object.keys(isolatedPaths).map(key => process.env[key]!), homedir(), os.homedir(),
    ...Object.values(resolveStatePaths()).filter((value): value is string => typeof value === "string"),
    resolveStatePaths().socket.path, ...Object.values(getDeckXdgPaths())];
  for (const path of paths) {
    expect(path).toBeDefined();
    expect(inside(realHome, path)).toBe(false);
    expect(inside(testRoot, path)).toBe(true);
  }
});


test("child processes inherit isolated user directories before native OS initialization", () => {
  const child = Bun.spawnSync([process.execPath, "-e",
    `console.log(JSON.stringify({home:require("node:os").homedir(),env:Object.fromEntries(${JSON.stringify(Object.keys(isolatedPaths))}.map(key=>[key,process.env[key]]))}))`],
    { stdout: "pipe", stderr: "pipe" });
  expect(child.success).toBe(true);
  const value = JSON.parse(child.stdout.toString());
  expect(value.home).toBe(isolatedPaths.HOME);
  for (const key of Object.keys(isolatedPaths)) expect(value.env[key]).toBe(process.env[key]);
});


test("node subprocess defaults and explicit Bun fixture environments stay distinct", async () => {
  const code = 'console.log(require("node:os").homedir())';
  const nodeChild = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
  expect(nodeChild.status).toBe(0);
  expect(nodeChild.stdout.trim()).toBe(isolatedPaths.HOME);
  const child = Bun.spawn({ cmd: [process.execPath, "-e", code], stdout: "pipe" });
  expect((await new Response(child.stdout).text()).trim()).toBe(isolatedPaths.HOME);
  expect(await child.exited).toBe(0);
  const explicit = Bun.spawnSync([process.execPath, "-e", code], {
    env: { HOME: testRoot }, stdout: "pipe",
  });
  expect(explicit.success).toBe(true);
  expect(explicit.stdout.toString().trim()).toBe(testRoot);
});
