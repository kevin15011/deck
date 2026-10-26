import { readFileSync } from "node:fs";

/** Poll only newline-committed fixture records; malformed complete records still fail. */
export function readChildLog(path: string): any[] {
  let content: string;
  try { content = readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  return content.slice(0, content.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map(line => JSON.parse(line));
}
