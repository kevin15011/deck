import { describe, expect, test } from "bun:test";

import { classifyCodeSearch } from "./graph";

const bash = (command: string) => classifyCodeSearch("bash", { command });

describe("classifyCodeSearch", () => {
  test("a symbol grep over source paths is a code-structure search", () => {
    expect(bash("grep -rn createUser src/")).toMatchObject({ code: true });
    expect(bash("rg 'class UserService' --glob '*.ts'")).toMatchObject({ code: true });
    expect(bash("rg handleRequest -t ts")).toMatchObject({ code: true });
    expect(bash("grep -r 'function renderPage' packages/app/src/page.tsx")).toMatchObject({ code: true });
    expect(bash("find . -name '*.py'")).toMatchObject({ code: true });
  });

  test("searches over non-code files or literal strings are never code-structure searches", () => {
    expect(bash("grep -n timeout config/settings.yaml")).toMatchObject({ code: false });
    expect(bash("rg version package.json")).toMatchObject({ code: false });
    expect(bash("grep -rn 'connection refused: retry in 5s' logs/")).toMatchObject({ code: false });
    expect(bash("rg TODO --glob '*.md'")).toMatchObject({ code: false });
    expect(bash("find . -name '*.lock'")).toMatchObject({ code: false });
  });

  test("other commands and complex shell pipelines are ignored", () => {
    expect(bash("ls -la")).toBeUndefined();
    expect(bash("git log --oneline")).toBeUndefined();
    expect(bash("cat src/a.ts | grep foo")).toBeUndefined();
    expect(bash("grep foo $(git ls-files)")).toBeUndefined();
  });

  test("the grep and find built-ins are classified from their arguments", () => {
    expect(classifyCodeSearch("grep", { pattern: "createUser", path: "src" })).toMatchObject({ code: true });
    expect(classifyCodeSearch("grep", { pattern: "createUser", glob: "*.ts" })).toMatchObject({ code: true });
    expect(classifyCodeSearch("grep", { pattern: "retries", glob: "*.yaml" })).toMatchObject({ code: false });
    expect(classifyCodeSearch("find", { pattern: "*.tsx", path: "." })).toMatchObject({ code: true });
    expect(classifyCodeSearch("find", { pattern: "*.json" })).toMatchObject({ code: false });
    expect(classifyCodeSearch("read", { path: "src/a.ts" })).toBeUndefined();
  });

  test("equivalent searches share one key so the repeat can be recognized", () => {
    expect(bash("grep -rn createUser src/")?.key).toBe(bash("grep -rn createUser src/")?.key);
    expect(bash("grep -rn createUser src/")?.key).not.toBe(bash("grep -rn deleteUser src/")?.key);
  });
});
