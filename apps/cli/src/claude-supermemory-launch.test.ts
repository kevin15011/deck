import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClaudeSupermemoryLaunchCredential, resolveClaudeSupermemorySessionCredential } from "./claude-supermemory-launch";

// Protects: a higher-priority v5 namespace cannot redirect the verified project or
// global launch; ordinary personal customization survives. Oracle: project identity
// comes from the verified Git binding, never provider config, for both launch routes.
test("native and managed Claude deny namespace shadowing without touching personal settings", () => {
  const home=mkdtempSync(join(tmpdir(),"deck-claude-binding-"));
  const repo=join(home,"project"),global=join(home,"global");
  mkdirSync(repo);mkdirSync(global);
  const effects={home,managedSettingsPaths:[],store:{read:()=>JSON.stringify({schema:"deck-opencode-supermemory-profiles-v1",profiles:{},defaultToken:"fake-token"})}};
  try {
    const git=(...args:string[])=>Bun.spawnSync(["git","-C",repo,...args],{env:{HOME:home,PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:"1"},stdout:"ignore",stderr:"pipe"});
    expect(git("init","-q").exitCode).toBe(0);
    expect(git("remote","add","origin","https://github.com/example/claude-test.git").exitCode).toBe(0);
    const personal=join(home,".claude","settings.json");mkdirSync(join(home,".claude"));
    writeFileSync(personal,JSON.stringify({env:{EDITOR:"vi"},enabledPlugins:{"personal@example":true}}));
    const before=readFileSync(personal,"utf8");
    const credential=resolveClaudeSupermemoryLaunchCredential(repo,effects);
    expect(credential.canonicalRepoTag).toMatch(/^sm_project_v1_/);
    expect(resolveClaudeSupermemorySessionCredential(repo,effects)).toEqual(credential);
    expect(resolveClaudeSupermemorySessionCredential(global,effects).canonicalRepoTag).toBeUndefined();
    for (const root of [repo,global]) {
      const directory=join(root,".claude",".supermemory-claude");mkdirSync(directory,{recursive:true});
      writeFileSync(join(directory,"config.json"),JSON.stringify({namespace:"foreign_project"}));
      expect(()=>resolveClaudeSupermemorySessionCredential(root,effects)).toThrow("override");
      if(root===repo) expect(()=>resolveClaudeSupermemoryLaunchCredential(root,effects)).toThrow("override");
    }
    expect(readFileSync(personal,"utf8")).toBe(before);
  } finally {rmSync(home,{recursive:true,force:true});}
});
