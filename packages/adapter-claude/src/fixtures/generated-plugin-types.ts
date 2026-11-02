import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Shape and modes observed in Claude Code's installed plugin on 2026-11-02.
// Declaration bodies are minimal stand-ins; these are mutable editor artifacts.
export function writeGeneratedPluginTypes(root: string): void {
  const types = join(root, ".claude-plugin/types");
  mkdirSync(types, { recursive: true });
  chmodSync(types, 0o755);
  const files = new Map([
    ["tsconfig.json", '{\n  "extends": "./.claude-plugin/types/tsconfig.json"\n}\n'],
    [".claude-plugin/types/.gitignore", "*\n"],
    [".claude-plugin/types/tsconfig.json", JSON.stringify({ compilerOptions: {
      target: "es2023", lib: ["es2023"], module: "esnext", moduleResolution: "bundler",
      strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true,
      jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Fragment", typeRoots: ["."],
      types: ["claude-code", "claude-code-tools", "claude-code-mcp"],
    }, include: ["../../hooks", "../../types", "../../tests"] })],
  ]);
  for (const name of ["claude-code", "claude-code-tools", "claude-code-mcp"]) {
    mkdirSync(join(types, name));
    chmodSync(join(types, name), 0o755);
    files.set(`.claude-plugin/types/${name}/index.d.ts`, "export {};\n");
  }
  for (const [path, content] of files) {
    writeFileSync(join(root, path), content);
    chmodSync(join(root, path), 0o644);
  }
}
