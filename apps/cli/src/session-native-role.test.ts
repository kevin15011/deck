import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerAdapter } from "@deck/core";
import { prepareCodexNativeRole } from "../../../packages/adapter-codex/src/native-role";
import { prepareSessionNativeRole } from "./session-native-skills";

test("stale installed Codex generation has an actionable preparation error",async()=>{
  const root=mkdtempSync(join(tmpdir(),"deck-stale-generation-"));
  try {
    mkdirSync(join(root,"deck"));
    writeFileSync(join(root,"deck/manifest.json"),JSON.stringify({version:1,nativeRoleGeneration:"previous-build",files:{}}));
    const adapter={runnerId:"codex",prepareSessionNativeRole:async(roleId:string)=>prepareCodexNativeRole(root,roleId)} as RunnerAdapter;
    await expect(prepareSessionNativeRole(adapter,"deck-quality")).rejects.toThrow("Reinstall the Codex team from Review & Install");
  } finally {rmSync(root,{recursive:true,force:true});}
});
