/**
 * Init state reader — reads the OpenSpec config.yaml to determine initialization status.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface InitState {
  initialized: boolean;
  last_index?: string;
  index_mode?: string;
  context?: string;
  parseError?: string; // present when file exists but is malformed
}

/**
 * Root-level parsed config fields we care about
 */
interface ParsedConfig {
  last_index?: string;
  index_mode?: string;
  context?: string;
  initialized?: boolean;
}

/**
 * Read OpenSpec config.yaml and determine initialization state.
 *
 * @param projectRoot - Absolute path to the project root containing openspec/config.yaml
 * @returns InitState reflecting whether deck has been initialized
 *
 * States:
 * - File missing → { initialized: false }
 * - Malformed YAML → { initialized: false, parseError: "..." }
 * - initialized: false → { initialized: false }
 * - initialized: true → { initialized: true, last_index, index_mode, context, ...rest }
 */
export function readOpenSpecInitState(projectRoot: string): InitState {
  const configPath = join(projectRoot, "openspec", "config.yaml");

  // Missing config file
  if (!existsSync(configPath)) {
    return { initialized: false };
  }

  // File exists, try to parse
  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, "utf-8");
  } catch (err) {
    // Cannot read file despite existence
    return {
      initialized: false,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }

  // Parse YAML manually to extract known fields
  const parsed = parseConfigYaml(rawContent);

  if (parsed instanceof Error) {
    return {
      initialized: false,
      parseError: parsed.message,
    };
  }

  // initialized field must be explicitly true to be considered initialized
  if (parsed.initialized !== true) {
    return { initialized: false };
  }

  // Build init state from parsed fields
  const initState: InitState = {
    initialized: true,
  };

  if (parsed.last_index) {
    initState.last_index = parsed.last_index;
  }
  if (parsed.index_mode) {
    initState.index_mode = parsed.index_mode;
  }
  if (parsed.context) {
    initState.context = parsed.context;
  }

  return initState;
}

/**
 * Parse a minimal subset of YAML needed for OpenSpec config.
 * Returns the parsed object or an Error if parsing fails.
 */
function parseConfigYaml(content: string): ParsedConfig | Error {
  try {
    const result: ParsedConfig = {};

    // Very simple YAML parser for known fields only
    // Look for 'last_index:', 'index_mode:', 'context:', 'initialized:'
    const lines = content.split("\n");
    let inContextBlock = false;
    let contextBuffer = "";

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Detect obviously malformed YAML (unmatched brackets/braces in a line not part of context)
      if (/[[\]{}]/.test(line) && !line.startsWith("#") && !inContextBlock) {
        return new Error(`Malformed YAML syntax: ${line}`);
      }

      // Context multiline block
      if (line === "context: |") {
        inContextBlock = true;
        contextBuffer = "";
        continue;
      }

      if (inContextBlock) {
        // End of context block (dedent or new key)
        if (rawLine.startsWith(" ") || rawLine.startsWith("\t")) {
          contextBuffer += rawLine.slice(rawLine.search(/\S/)) + "\n";
          continue;
        } else {
          // End block
          result.context = contextBuffer.trim();
          inContextBlock = false;
        }
      }

      // Simple key: value pairs
      if (line.startsWith("last_index:")) {
        const value = line.substring("last_index:".length).trim();
        if (value) {
          result.last_index = value.replace(/^["']|["']$/g, "");
        }
        continue;
      }

      if (line.startsWith("index_mode:")) {
        const value = line.substring("index_mode:".length).trim();
        if (value) {
          result.index_mode = value.replace(/^["']|["']$/g, "");
        }
        continue;
      }

      if (line.startsWith("initialized:")) {
        const value = line.substring("initialized:".length).trim().toLowerCase();
        result.initialized = value === "true" || value === "yes" || value === "1";
        continue;
      }
    }

    if (inContextBlock && contextBuffer) {
      result.context = contextBuffer.trim();
    }

    return result;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}