import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureCodexSupermemoryCapture } from "./supermemory-settings";

// Protects: full-conversation configuration preserves unrelated provider options and rejects unsafe files without leaking their content.
test("reviewed capture settings preserve other options and reject unsafe files", async () => {
  const home = mkdtempSync(join(tmpdir(),"deck-codex-settings-"));
  try {
    const directory=join(home,".codex"); mkdirSync(directory,{mode:0o755});
    const path=join(directory,"supermemory.json");
    writeFileSync(path,JSON.stringify({signalExtraction:true,recallMode:"direct",maxMemories:9}));
    await configureCodexSupermemoryCapture(home);
    expect(JSON.parse(readFileSync(path,"utf8"))).toEqual({signalExtraction:false,recallMode:"direct",maxMemories:9});
    chmodSync(path,0o666);
    await expect(configureCodexSupermemoryCapture(home)).rejects.toThrow("Unsafe");
    rmSync(path); const target=join(home,"foreign.json"); writeFileSync(target,"{}"); symlinkSync(target,path);
    await expect(configureCodexSupermemoryCapture(home)).rejects.toThrow("Unsafe");
    expect(readFileSync(target,"utf8")).toBe("{}");
    rmSync(path); writeFileSync(path,"FAKE_PRIVATE_SETTING invalid JSON");
    await expect(configureCodexSupermemoryCapture(home)).rejects.toThrow(/^Invalid Codex Supermemory settings$/);
  } finally {rmSync(home,{recursive:true,force:true});}
});
