import { validateRequestCap, type InventoryOptions } from "./inventory.ts";

export function parseArgs(args: string[]): InventoryOptions {
  const flags = new Map<string, string>();
  let mode: "dry-run" | "live" | undefined;
  const takesValue = new Set(["--max-requests", "--sessions", "--window-start", "--window-end"]);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run" || flag === "--live") {
      if (mode) throw new Error("Choose exactly one of --dry-run or --live.");
      mode = flag.slice(2) as "dry-run" | "live";
      continue;
    }
    if (!takesValue.has(flag) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete flag: ${flag}`);
    if (flags.has(flag)) throw new Error(`Duplicate flag: ${flag}`);
    flags.set(flag, args[++i]);
  }
  if (!mode) throw new Error("Select --dry-run for offline preflight or --live for read-only API calls.");
  const maxRequests = flags.has("--max-requests") ? Number(flags.get("--max-requests")) : undefined;
  validateRequestCap(maxRequests);
  for (const flag of ["--window-start", "--window-end"]) if (flags.has(flag) && !Number.isFinite(Date.parse(flags.get(flag)!))) throw new Error(`${flag} must be a valid date-time.`);
  const sessions = flags.get("--sessions")?.split(",").map((id) => id.trim()).filter(Boolean);
  return { dryRun: mode === "dry-run", live: mode === "live", maxRequests, sessions, windowStart: flags.get("--window-start"), windowEnd: flags.get("--window-end") };
}
