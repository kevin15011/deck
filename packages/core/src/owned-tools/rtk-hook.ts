/** Pin only an unquoted executable word at a simple-command boundary. This is
 * deliberately conservative: substitutions, redirects and shell grammar we do
 * not recognize keep the original runner command instead of being rewritten. */
export function pinRtkRewrite(command: string, binary: string): string | undefined {
  const executable = "'" + binary.replaceAll("'", "'\\''") + "'";
  let result = "", cursor = 0, replacements = 0, expectCommand = true;
  while (cursor < command.length) {
    const start = cursor;
    if (command[cursor] === "\n") { result += "\n"; cursor++; expectCommand = true; continue; }
    if (/\s/.test(command[cursor]!)) { result += command[cursor++]; continue; }
    if (command.startsWith("&&", cursor) || command.startsWith("||", cursor)) { result += command.slice(cursor, cursor + 2); cursor += 2; expectCommand = true; continue; }
    if (command[cursor] === ";" || command[cursor] === "|") { result += command[cursor++]; expectCommand = true; continue; }
    if (/[&<>()[\]{}]/.test(command[cursor]!)) return undefined;
    let quote = "";
    while (cursor < command.length) {
      const char = command[cursor]!;
      if (quote === "'") { if (char === "'") quote = ""; cursor++; continue; }
      if (char === "$" || char === "`" || char === "\\" || !quote && char === "#") return undefined;
      if (quote === '"') { if (char === '"') quote = ""; cursor++; continue; }
      if (char === "'" || char === '"') { quote = char; cursor++; continue; }
      if (/\s/.test(char) || /[&|;<>()[\]{}]/.test(char)) break;
      cursor++;
    }
    if (quote || cursor === start) return undefined;
    const word = command.slice(start, cursor);
    if (expectCommand && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { result += word; continue; }
    // An RTK token in argument position could be an opaque wrapper's target.
    // Defer the whole rewrite rather than emit even one ambiguous bare call.
    if (!expectCommand && (word === "rtk" || /^(['"])rtk\1$/.test(word))) return undefined;
    if (expectCommand && word === "rtk") { result += executable; replacements++; }
    else {
      // Do not mistake an argument to env/sudo/etc. for a shell executable.
      // RTK may support those forms, but this bridge intentionally defers them.
      if (expectCommand && ["env", "sudo", "command", "exec", "eval", "source", ".", "bash", "sh", "if", "then", "else", "for", "while", "do", "function"].includes(word.slice(word.lastIndexOf("/") + 1))) return undefined;
      result += word;
    }
    expectCommand = false;
  }
  return replacements ? result : undefined;
}

/**
 * Static JavaScript twin of {@link pinRtkRewrite}. The hook script embeds this text instead of `Function.prototype.toString()`
 * because the latter differs between `bun run` and compiled binaries, which would make the generated script (and its
 * ownership hash) depend on which Deck build planned it. rtk-hook.test.ts proves both forms behave identically.
 */
export const PIN_RTK_REWRITE_SOURCE: string = [
  "function pinRtkRewrite(command, binary) {",
  "  const executable = \"'\" + binary.replaceAll(\"'\", \"'\\\\''\") + \"'\";",
  "  let result = \"\", cursor = 0, replacements = 0, expectCommand = true;",
  "  while (cursor < command.length) {",
  "    const start = cursor;",
  "    if (command[cursor] === \"\\n\") { result += \"\\n\"; cursor++; expectCommand = true; continue; }",
  "    if (/\\s/.test(command[cursor])) { result += command[cursor++]; continue; }",
  "    if (command.startsWith(\"&&\", cursor) || command.startsWith(\"||\", cursor)) { result += command.slice(cursor, cursor + 2); cursor += 2; expectCommand = true; continue; }",
  "    if (command[cursor] === \";\" || command[cursor] === \"|\") { result += command[cursor++]; expectCommand = true; continue; }",
  "    if (/[&<>()[\\]{}]/.test(command[cursor])) return undefined;",
  "    let quote = \"\";",
  "    while (cursor < command.length) {",
  "      const char = command[cursor];",
  "      if (quote === \"'\") { if (char === \"'\") quote = \"\"; cursor++; continue; }",
  "      if (char === \"$\" || char === \"`\" || char === \"\\\\\" || !quote && char === \"#\") return undefined;",
  "      if (quote === '\"') { if (char === '\"') quote = \"\"; cursor++; continue; }",
  "      if (char === \"'\" || char === '\"') { quote = char; cursor++; continue; }",
  "      if (/\\s/.test(char) || /[&|;<>()[\\]{}]/.test(char)) break;",
  "      cursor++;",
  "    }",
  "    if (quote || cursor === start) return undefined;",
  "    const word = command.slice(start, cursor);",
  "    if (expectCommand && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) { result += word; continue; }",
  "    // An RTK token in argument position could be an opaque wrapper's target.",
  "    // Defer the whole rewrite rather than emit even one ambiguous bare call.",
  "    if (!expectCommand && (word === \"rtk\" || /^(['\"])rtk\\1$/.test(word))) return undefined;",
  "    if (expectCommand && word === \"rtk\") { result += executable; replacements++; }",
  "    else {",
  "      // Do not mistake an argument to env/sudo/etc. for a shell executable.",
  "      // RTK may support those forms, but this bridge intentionally defers them.",
  "      if (expectCommand && [\"env\", \"sudo\", \"command\", \"exec\", \"eval\", \"source\", \".\", \"bash\", \"sh\", \"if\", \"then\", \"else\", \"for\", \"while\", \"do\", \"function\"].includes(word.slice(word.lastIndexOf(\"/\") + 1))) return undefined;",
  "      result += word;",
  "    }",
  "    expectCommand = false;",
  "  }",
  "  return replacements ? result : undefined;",
  "}",
].join("\n");

/** Owner-only plugin script, executed by an absolute locally verified Node.js.
 * The pinned hook retains policy decisions and tool fields; only its structured
 * updatedInput.command is eligible for executable-word qualification. */
export type RtkHookFlavor = "claude" | "codex";

export function rtkHookScript(binary: string, flavor: RtkHookFlavor): string {
  return `"use strict";
const {spawnSync} = require("node:child_process");
${PIN_RTK_REWRITE_SOURCE}
const binary = ${JSON.stringify(binary)};
let input = [], bytes = 0;
process.stdin.on("data", chunk => { bytes += chunk.length; if (bytes > 256 * 1024) process.exit(0); input.push(chunk); });
process.stdin.on("end", () => {
  try {
    const raw = Buffer.concat(input).toString("utf8");
    const request = JSON.parse(raw);
    if (request.tool_name !== "Bash" || typeof request.tool_input?.command !== "string") return;
    const result = spawnSync(binary, ["hook", ${JSON.stringify(flavor)}], {input: raw, encoding: "utf8", timeout: 3000, maxBuffer: 512 * 1024, stdio: ["pipe", "pipe", "ignore"]});
    if (result.status !== 0 || result.error || !result.stdout.trim()) return;
    const response = JSON.parse(result.stdout);
    const hook = response.hookSpecificOutput;
    if (hook?.hookEventName !== "PreToolUse" || typeof hook.updatedInput?.command !== "string") return;
    const command = pinRtkRewrite(hook.updatedInput.command, binary);
    if (command === undefined) return;
    hook.updatedInput.command = command;
    process.stdout.write(JSON.stringify(response) + "\\n");
  } catch { /* No executable or malformed rewrite: let the runner handle the original. */ }
});
`;
}
