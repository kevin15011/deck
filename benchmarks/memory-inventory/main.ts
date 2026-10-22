import { parseArgs } from "./args.ts";
import { printSafe, runInventory } from "./inventory.ts";

try {
  await runInventory(parseArgs(Bun.argv.slice(2)));
} catch (error) {
  try { printSafe({ error: error instanceof Error ? error.message : "Inventory failed." }, []); }
  catch { console.error("Output refused: residual secret patterns detected (count=1)."); }
  process.exitCode = 1;
}
