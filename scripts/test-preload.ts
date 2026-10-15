// Tests import the production CLI, which embeds the generated web application.
// Generate it before test modules load so a fresh checkout needs no prior build.
import { resolve } from "node:path";

// Run the browser build in its own process, outside Bun's test module resolver.
const result = Bun.spawnSync([process.execPath, "run", resolve(import.meta.dir, "generate-web-assets.ts")], {
  cwd: resolve(import.meta.dir, ".."),
  stdout: "pipe",
  stderr: "pipe",
});
if (!result.success) {
  throw new Error(`Web asset preparation failed: ${result.stderr.toString()}`);
}
