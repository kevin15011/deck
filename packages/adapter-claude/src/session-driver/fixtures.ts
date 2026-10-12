import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "__fixtures__", "2.1.296");

/** Raw stdout lines of a recorded (or synthetic) fixture. */
export function fixtureLines(name: string): string[] {
  return readFileSync(join(DIR, name), "utf8").split("\n").filter((l) => l.trim().length > 0);
}
