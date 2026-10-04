import { createHash } from "node:crypto";

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "kts", "rb", "php", "c", "h", "cc", "cpp", "hpp", "cs", "swift", "scala", "lua", "vue", "svelte"]);
const NON_CODE_EXTENSIONS = new Set(["json", "yaml", "yml", "toml", "md", "mdx", "txt", "lock", "ini", "cfg", "conf", "env", "xml", "csv", "log", "html", "css", "svg", "sql", "lcov"]);
const CODE_TYPES = new Set(["ts", "tsx", "js", "jsx", "py", "python", "go", "rust", "rs", "java", "kotlin", "ruby", "rb", "php", "c", "cpp", "cs", "swift", "scala", "lua"]);
const SEARCH_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg", "find"]);
/** Options that take a separate value argument (the value is not a pattern or path). */
const VALUE_OPTIONS = new Set(["-g", "--glob", "-t", "--type", "-T", "--type-not", "-e", "-f", "-A", "-B", "-C", "-m", "--max-count", "--max-depth", "-maxdepth", "-type", "-path", "-ipath", "-regex", "-newer", "-mtime", "-size", "--include", "--exclude", "--exclude-dir"]);
const COMPLEX_SHELL = /[|;&<>`$()\n]/;
const SYMBOL_PATTERN = /^[A-Za-z_$][\w$]{2,}$/;
const DEFINITION_PATTERN = /\b(?:function|class|interface|type|def|func|fn|struct|enum|trait|impl)\s+[A-Za-z_$][\w$]*/;

export type CodeSearchClassification = Readonly<{ code: boolean; key: string }>;

function extensionOf(value: string): string | undefined {
  const cleaned = value.replace(/^['"]|['"]$/g, "").replace(/[*?{}\[\]]+$/g, "");
  const match = /\.([A-Za-z0-9]+)$/.exec(cleaned);
  return match?.[1]?.toLowerCase();
}

function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let current = "";
  let quote = "";
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) { words.push(current); current = ""; started = false; }
    } else {
      current += char;
    }
  }
  if (quote) return undefined;
  if (started || current) words.push(current);
  return words;
}

function classify(pattern: string | undefined, hints: readonly string[], types: readonly string[], key: string): CodeSearchClassification {
  const extensions = hints.map(extensionOf).filter((ext): ext is string => ext !== undefined);
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 16);
  if (extensions.some((ext) => NON_CODE_EXTENSIONS.has(ext))) return { code: false, key: digest };
  if (extensions.some((ext) => CODE_EXTENSIONS.has(ext)) || types.some((type) => CODE_TYPES.has(type))) return { code: true, key: digest };
  // No file-type hint (a directory or the whole tree): only symbol-shaped patterns are code-structure searches.
  const symbolic = pattern !== undefined && (SYMBOL_PATTERN.test(pattern) || DEFINITION_PATTERN.test(pattern));
  return { code: symbolic, key: digest };
}

function classifyBash(command: string): CodeSearchClassification | undefined {
  if (COMPLEX_SHELL.test(command)) return undefined;
  const words = shellWords(command.trim());
  if (!words || words.length === 0) return undefined;
  const executable = words[0]!.slice(words[0]!.lastIndexOf("/") + 1);
  if (!SEARCH_COMMANDS.has(executable)) return undefined;

  const hints: string[] = [];
  const types: string[] = [];
  const operands: string[] = [];
  let explicitPattern: string | undefined;
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (word.startsWith("--include=") || word.startsWith("--glob=")) { hints.push(word.slice(word.indexOf("=") + 1)); continue; }
    if (word.startsWith("--type=")) { types.push(word.slice(7)); continue; }
    if (VALUE_OPTIONS.has(word)) {
      const value = words[++index];
      if (value === undefined) continue;
      if (word === "-g" || word === "--glob" || word === "--include") hints.push(value);
      else if (word === "-t" || word === "--type") types.push(value);
      else if (word === "-e") explicitPattern = value;
      else if (word === "-name" || word === "-iname") hints.push(value);
      continue;
    }
    if (executable === "find" && (word === "-name" || word === "-iname")) { const value = words[++index]; if (value) hints.push(value); continue; }
    if (word.startsWith("-") && word.length > 1) continue;
    operands.push(word);
  }
  if (executable === "find") return classify(undefined, [...hints, ...operands], types, command);
  const pattern = explicitPattern ?? operands.shift();
  return classify(pattern, [...hints, ...operands], types, command);
}

/**
 * Decides whether a search tool call is a code-structure search (a candidate for redirection toward the codebase
 * graph) or a literal/non-code search that must run untouched. `undefined` means "not a search at all".
 */
export function classifyCodeSearch(toolName: string, input: Record<string, unknown> | undefined): CodeSearchClassification | undefined {
  if (!input) return undefined;
  if (toolName === "bash") return typeof input.command === "string" ? classifyBash(input.command) : undefined;
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
  if (toolName === "grep") {
    const hints = [text(input.glob), text(input.path)].filter((entry): entry is string => entry !== undefined);
    return classify(text(input.pattern), hints, [], JSON.stringify([toolName, input.pattern, input.path, input.glob]));
  }
  if (toolName === "find") {
    const hints = [text(input.pattern), text(input.path)].filter((entry): entry is string => entry !== undefined);
    return classify(undefined, hints, [], JSON.stringify([toolName, input.pattern, input.path]));
  }
  return undefined;
}
