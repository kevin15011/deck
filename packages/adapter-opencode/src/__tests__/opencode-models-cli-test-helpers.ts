import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ModelDiscoveryFileSystem,
  OpenCodeCommandRequest,
  OpenCodeModelDiscoveryDependencies,
} from "../opencode-models-cli";

const FIXTURE_EXECUTABLE = "/fixtures/bin/opencode";
const FIXTURE_ROOT = "/fixtures";

type FixtureName = "v1-valid" | "v1-invalid";

type HermeticFixtureOptions = {
  transcript: string;
  now: number;
  files?: Readonly<Record<string, string>>;
};

type HermeticDiscoveryDependencies = {
  dependencies: OpenCodeModelDiscoveryDependencies;
  calls: { command: OpenCodeCommandRequest[] };
};

export function loadOpenCodeModelsVerboseFixture(name: FixtureName): string {
  const fileName = name === "v1-valid"
    ? "opencode-1.17.18-valid.txt"
    : "opencode-1.17.18-invalid.txt";
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/opencode-models-verbose/${fileName}`, import.meta.url)),
    "utf8",
  );
}

export function createHermeticOpenCodeDiscoveryDependencies(
  options: HermeticFixtureOptions,
): HermeticDiscoveryDependencies {
  const calls: OpenCodeCommandRequest[] = [];
  const files = new Map(Object.entries(options.files ?? {}));
  const rejectUserPath = (path: string) => {
    if (path.startsWith("/home/") || path.startsWith("/Users/") || path.includes("~")) {
      throw new Error(`real user path is forbidden in OpenCode discovery tests: ${path}`);
    }
  };
  const fs: ModelDiscoveryFileSystem = {
    async readFile(path) {
      rejectUserPath(path);
      const body = files.get(path);
      if (body === undefined) throw new Error(`unconfigured fixture file: ${path}`);
      return body;
    },
    async stat(path) {
      rejectUserPath(path);
      const body = files.get(path) ?? "";
      return { size: body.length, mtimeMs: options.now, mode: 0o600 };
    },
    async realpath(path) {
      rejectUserPath(path);
      if (!path.startsWith(FIXTURE_ROOT)) throw new Error(`unconfigured fixture path: ${path}`);
      return path;
    },
    async mkdir(path) {
      rejectUserPath(path);
      if (!path.startsWith(FIXTURE_ROOT)) throw new Error(`unconfigured fixture path: ${path}`);
    },
    async writeFile(path) {
      rejectUserPath(path);
      throw new Error(`fixture filesystem is read-only: ${path}`);
    },
    async rename(from, to) {
      rejectUserPath(from);
      rejectUserPath(to);
      throw new Error("fixture filesystem is read-only");
    },
  };
  const dependencies: OpenCodeModelDiscoveryDependencies = {
    commandRunner: {
      async run(request) {
        if (request.file !== FIXTURE_EXECUTABLE) {
          throw new Error("OpenCode discovery tests require the fixture executable");
        }
        if (
          request.args.some((arg) =>
            ["--refresh", "--pure", "sh", "bash", "curl", "wget"].includes(arg),
          )
        ) {
          throw new Error("shell or network helper is forbidden in OpenCode discovery tests");
        }
        rejectUserPath(request.cwd);
        calls.push(request);
        return { exitCode: 0, signal: null, stdout: options.transcript, stderr: "" };
      },
    },
    fs,
    now: () => options.now,
    env: Object.freeze({ OPENCODE_FIXTURE: "1" }),
    async resolveExecutable(command) {
      if (command !== "opencode") {
        throw new Error("shell or network helper is forbidden in OpenCode discovery tests");
      }
      return FIXTURE_EXECUTABLE;
    },
  };
  return { dependencies, calls: { command: calls } };
}
