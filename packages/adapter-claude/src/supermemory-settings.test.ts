import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureClaudeSupermemoryCapture } from "./supermemory-settings";

// Protects: reviewed installation enables full-turn capture without discarding personal
// settings or following a replaceable settings path. Oracle: unrelated keys survive;
// malformed/foreign paths fail before writes to their targets.
test("capture settings preserve customization and reject unsafe preimages", () => {
  const home = mkdtempSync(join(tmpdir(), "deck-claude-settings-"));
  const directory = join(home, ".supermemory-claude");
  const path = join(directory, "settings.json");
  try {
    mkdirSync(directory, {mode:0o700});
    writeFileSync(path, JSON.stringify({signalExtraction:true,includeTools:["Read"],maxProfileItems:7}), {mode:0o600});
    configureClaudeSupermemoryCapture(home);
    expect(JSON.parse(readFileSync(path,"utf8"))).toEqual({signalExtraction:false,includeTools:["Read"],maxProfileItems:7});
    const content = readFileSync(path,"utf8");
    configureClaudeSupermemoryCapture(home);
    expect(readFileSync(path,"utf8")).toBe(content);
    writeFileSync(path,"[]");
    expect(()=>configureClaudeSupermemoryCapture(home)).toThrow("Invalid");
    expect(readFileSync(path,"utf8")).toBe("[]");
    rmSync(path);
    const outside = join(home,"personal.json"); writeFileSync(outside,"{}"); symlinkSync(outside,path);
    expect(()=>configureClaudeSupermemoryCapture(home)).toThrow("Unsafe");
    expect(readFileSync(outside,"utf8")).toBe("{}");
  } finally {rmSync(home,{recursive:true,force:true});}
});
