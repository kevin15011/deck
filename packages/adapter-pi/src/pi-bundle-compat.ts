/**
 * Deck's execution-extension asset is bundled with `bun build --target=bun`, which turns `require("<builtin>")`
 * into `import.meta.require`. That property exists only in Bun's loader; Pi runs on Node, where the bundle fails
 * at import time ("... is not a function"). The generated asset must not be hand-edited, so Deck adapts the
 * emitted copy: `import.meta.require` becomes a `createRequire(import.meta.url)` shim. Pure and idempotent.
 */
const SHIM_MARKER = "__deckNodeRequire";
const SHIM_PREFIX = `import{createRequire as __deckCreateRequire}from"node:module";const ${SHIM_MARKER}=__deckCreateRequire(import.meta.url);\n`;

export function adaptBunBundleForNode(source: string): string {
  if (!source.includes("import.meta.require")) return source;
  return `${SHIM_PREFIX}${source.split("import.meta.require").join(SHIM_MARKER)}`;
}
