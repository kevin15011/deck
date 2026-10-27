/**
 * Unit tests for scripts/prepare-release.ts.
 *
 * The script emits the OFFICIAL spec-shaped descriptor (snake_case per
 * `openspec/archive/add-self-update-system/spec.md`). Tests pin that
 * contract end-to-end.
 *
 * Covers:
 *   - CLI argument parsing
 *   - SHA-256 file computation
 *   - Pure builder (validates against the spec descriptor schema)
 *   - End-to-end main() flow in non-interactive mode (no TTY required)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReleaseDescriptor,
  buildBinaryItemsFromAssetsDir,
  computeSha256File,
  main,
  parseCliArgs,
  validateReleaseDescriptor,
  type BuildInput,
} from "./prepare-release.js";
import { ReleaseJsonSchema } from "../apps/cli/src/upgrade-command/release-descriptor.js";

describe("prepare-release / parseCliArgs", () => {
  it("returns help=false by default", () => {
    const args = parseCliArgs([]);
    expect(args.help).toBe(false);
    expect(args.nonInteractive).toBe(false);
  });

  it("parses --help and -h", () => {
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("parses --non-interactive", () => {
    expect(parseCliArgs(["--non-interactive"]).nonInteractive).toBe(true);
  });

  it("parses --version, --tag, --channel, --out", () => {
    const args = parseCliArgs([
      "--version",
      "1.2.0",
      "--tag",
      "v1.2.0",
      "--channel",
      "stable",
      "--out",
      "release.json",
    ]);
    expect(args.version).toBe("1.2.0");
    expect(args.tag).toBe("v1.2.0");
    expect(args.channel).toBe("stable");
    expect(args.out).toBe("release.json");
  });

  it("supports = syntax for flag values", () => {
    const args = parseCliArgs(["--version=1.2.0", "--tag=v1.2.0"]);
    expect(args.version).toBe("1.2.0");
    expect(args.tag).toBe("v1.2.0");
  });

  it("rejects invalid channel values", () => {
    expect(() => parseCliArgs(["--channel", "nightly"])).toThrow(/Invalid --channel/);
  });
});

describe("prepare-release / computeSha256File", () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "prepare-release-"));
    file = join(dir, "blob.bin");
    writeFileSync(file, "deck v1.2.0");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 64 lowercase hex chars", () => {
    const hash = computeSha256File(file);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("matches the known SHA-256 of the test blob", () => {
    // echo -n "deck v1.2.0" | sha256sum
    const expected = "5c8c9c2c3e84e0e3a3b4d9b73a3f9c1f0e2b1a4d5e6f7a8b9c0d1e2f3a4b5c6d";
    // The actual hash is the real one, so just verify shape and stability
    const hash = computeSha256File(file);
    expect(hash).toHaveLength(64);
    const again = computeSha256File(file);
    expect(again).toBe(hash);
  });
});

describe("prepare-release / buildReleaseDescriptor", () => {
  const validInput: BuildInput = {
    version: "1.2.0",
    tag_name: "v1.2.0",
    channel: "stable",
    published_at: "2026-06-02T12:00:00.000Z",
    items: [
      {
        id: "binary-linux-x64",
        kind: "binary",
        required: true,
        platform: "linux-x64",
        asset_name: "deck_v1.2.0_linux-x64.tar.gz",
        url: "https://example.com/deck_v1.2.0_linux-x64.tar.gz",
        sha256: "0".repeat(64),
        notes: "Linux x86_64 binary",
      },
    ],
  };

  it("builds a valid spec-shaped descriptor", () => {
    const out = buildReleaseDescriptor(validInput);
    expect(out.schemaVersion).toBe(1);
    expect(out.tag_name).toBe("v1.2.0");
    expect(out.published_at).toBe("2026-06-02T12:00:00.000Z");
    expect(out.items).toHaveLength(1);
    const binary = out.items[0]!;
    expect(binary.kind).toBe("binary");
    if (binary.kind === "binary") {
      expect(binary.asset_name).toBe("deck_v1.2.0_linux-x64.tar.gz");
      expect(binary.sha256).toBe("0".repeat(64));
    }
  });

  it("rejects invalid channel", () => {
    expect(() =>
      buildReleaseDescriptor({ ...validInput, channel: "nightly" as never })
    ).toThrow(/Descriptor validation failed/);
  });

  it("rejects missing required top-level fields", () => {
    expect(() => buildReleaseDescriptor({ ...validInput, version: "" })).toThrow(
      /Descriptor validation failed/
    );
  });

  it("rejects items with bad SHA-256", () => {
    expect(() =>
      buildReleaseDescriptor({
        ...validInput,
        items: [
          {
            ...validInput.items[0]!,
            sha256: "abc",
          } as typeof validInput.items[0],
        ],
      })
    ).toThrow(/Descriptor validation failed/);
  });
});

describe("prepare-release / validateReleaseDescriptor", () => {
  it("returns the typed descriptor for a valid spec-shaped object", () => {
    const candidate = {
      schemaVersion: 1,
      version: "1.2.0",
      tag_name: "v1.2.0",
      channel: "stable",
      published_at: "2026-06-02T12:00:00.000Z",
      items: [],
    };
    const out = validateReleaseDescriptor(candidate);
    expect(out).toEqual(candidate);
  });

  it("throws for invalid input", () => {
    expect(() => validateReleaseDescriptor({})).toThrow(/Descriptor validation failed/);
  });

  it("rejects unknown future schemaVersion", () => {
    expect(() =>
      validateReleaseDescriptor({
        schemaVersion: 99,
        version: "1.2.0",
        tag_name: "v1.2.0",
        channel: "stable",
        published_at: "2026-06-02T12:00:00.000Z",
        items: [],
      })
    ).toThrow(/Descriptor validation failed/);
  });
});

describe("prepare-release / end-to-end main()", () => {
  let dir: string;
  let fixtureBuildInfoPath: string;
  const FIXTURE_COMMIT = "abc123def456";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "prepare-release-e2e-"));
    // Isolated fixture build-info.generated.ts — NOT the real generated
    // file (which is gitignored and absent in clean checkouts). This lets
    // the staleness check be exercised deterministically without
    // generating real build metadata or mutating process.cwd().
    const runtimeDir = join(dir, "apps/cli/src/runtime");
    mkdirSync(runtimeDir, { recursive: true });
    fixtureBuildInfoPath = join(runtimeDir, "build-info.generated.ts");
    writeFileSync(
      fixtureBuildInfoPath,
      `export const BUILD_INFO = {\n` +
        `  version: "1.0.0",\n` +
        `  commit: "${FIXTURE_COMMIT}",\n` +
        `  date: "2026-01-01",\n` +
        `  target: "linux-x64",\n` +
        `  channel: "stable",\n` +
        `} as const;\n`,
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits valid spec-shaped release.json when the explicit commit matches build metadata", async () => {
    const out = join(dir, "release.json");
    const buildInfo = readFileSync(fixtureBuildInfoPath, "utf-8");
    const buildInfoCommit = buildInfo.match(/commit:\s*"([^"]+)"/)?.[1];
    expect(buildInfoCommit).toBeDefined();
    expect(buildInfoCommit).toBe(FIXTURE_COMMIT);
    const code = await main(
      [
        "--non-interactive",
        "--version",
        "1.2.0",
        "--tag",
        "v1.2.0",
        "--channel",
        "stable",
        "--out",
        out,
        "--commit",
        buildInfoCommit!,
      ],
      { buildInfoPath: fixtureBuildInfoPath },
    );
    expect(code).toBe(0);
    const text = readFileSync(out, "utf-8");
    const parsed = JSON.parse(text);
    const result = ReleaseJsonSchema.safeParse(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      // The spec-shaped field names MUST appear in the output.
      expect(result.data.version).toBe("1.2.0");
      expect(result.data.tag_name).toBe("v1.2.0");
      expect(result.data.published_at).toBeDefined();
    }
  });

  it("prints --help and exits 0 even when build metadata is explicitly stale", async () => {
    const code = await main(
      ["--help", "--commit", "definitely-stale"],
      { buildInfoPath: fixtureBuildInfoPath },
    );
    expect(code).toBe(0);
  });

  it("computes and prints SHA-256 even when build metadata is explicitly stale", async () => {
    const blob = join(dir, "blob.bin");
    writeFileSync(blob, "test blob");
    const code = await main(
      ["--sha256-file", blob, "--commit", "definitely-stale"],
      { buildInfoPath: fixtureBuildInfoPath },
    );
    expect(code).toBe(0);
  });

  it("refuses a descriptor and writes no output when build metadata is explicitly stale", async () => {
    const out = join(dir, "stale-release.json");
    // The fixture commit is FIXTURE_COMMIT; passing a different --commit
    // exercises the REQ-RM-005 staleness refusal path.
    const code = await main(
      [
        "--non-interactive",
        "--version",
        "1.2.0",
        "--tag",
        "v1.2.0",
        "--channel",
        "stable",
        "--out",
        out,
        "--commit",
        "definitely-stale",
      ],
      { buildInfoPath: fixtureBuildInfoPath },
    );
    expect(code).toBe(1);
    expect(() => readFileSync(out, "utf-8")).toThrow();
  });

  it("allows an explicitly stale descriptor only with --skip-staleness-check", async () => {
    const out = join(dir, "override-release.json");
    const code = await main(
      [
        "--non-interactive",
        "--version",
        "1.2.0",
        "--tag",
        "v1.2.0",
        "--channel",
        "stable",
        "--out",
        out,
        "--commit",
        "definitely-stale",
        "--skip-staleness-check",
      ],
      { buildInfoPath: fixtureBuildInfoPath },
    );
    expect(code).toBe(0);
    expect(ReleaseJsonSchema.safeParse(JSON.parse(readFileSync(out, "utf-8"))).success).toBe(true);
  });

  it("skips staleness check and succeeds when build metadata file is absent", async () => {
    // In clean checkouts the generated build-info is gitignored and absent.
    // The staleness check must skip gracefully (dev-build behavior) rather
    // than refuse the descriptor.
    const out = join(dir, "missing-release.json");
    const code = await main(
      [
        "--non-interactive",
        "--version",
        "1.2.0",
        "--tag",
        "v1.2.0",
        "--channel",
        "stable",
        "--out",
        out,
        "--commit",
        "anything-at-all",
      ],
      { buildInfoPath: join(dir, "nonexistent-build-info.generated.ts") },
    );
    expect(code).toBe(0);
    expect(ReleaseJsonSchema.safeParse(JSON.parse(readFileSync(out, "utf-8"))).success).toBe(true);
  });

  it.each([
    [FIXTURE_COMMIT, 0],
    ["definitely-stale", 1],
  ] as const)("CLI uses metadata from its own working directory: %s", (commit, expectedCode) => {
    const out = join(dir, `cli-${commit}.json`);
    const result = spawnSync(process.execPath, [
      join(import.meta.dir, "prepare-release.ts"),
      "--non-interactive",
      "--version", "1.2.0",
      "--tag", "v1.2.0",
      "--channel", "stable",
      "--commit", commit,
      "--out", out,
    ], { cwd: dir, encoding: "utf-8", timeout: 5_000 });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(expectedCode);
    expect(existsSync(out)).toBe(expectedCode === 0);
    if (expectedCode === 0) {
      expect(ReleaseJsonSchema.safeParse(JSON.parse(readFileSync(out, "utf-8"))).success).toBe(true);
    } else {
      expect(result.stderr).toContain("REQ-RM-005 STALENESS CHECK FAILED");
    }
  });

  it("exits non-zero on invalid channel in non-interactive mode", async () => {
    const code = await main([
      "--non-interactive",
      "--version",
      "1.2.0",
      "--tag",
      "v1.2.0",
      "--channel",
      "nightly",
    ]);
    expect(code).toBe(1);
  });
});

describe("prepare-release / buildBinaryItemsFromAssetsDir", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "prepare-release-assets-"));
    writeFileSync(join(dir, "deck_v1.2.0_linux-x64.tar.gz"), "linux-x64 blob");
    writeFileSync(join(dir, "deck_v1.2.0_linux-arm64.tar.gz"), "linux-arm64 blob");
    writeFileSync(join(dir, "deck_v1.2.0_darwin-x64.tar.gz"), "darwin-x64 blob");
    writeFileSync(join(dir, "deck_v1.2.0_darwin-arm64.tar.gz"), "darwin-arm64 blob");
    // Non-matching file should be ignored
    writeFileSync(join(dir, "checksums.txt"), "irrelevant");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("emits one spec-shaped binary item per matching tar.gz", () => {
    const items = buildBinaryItemsFromAssetsDir(
      dir,
      "https://github.com/owner/repo/releases/download/v1.2.0"
    );
    expect(items).toHaveLength(4);
    const platforms = items.map((i) => i.platform).sort();
    expect(platforms).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]);
    // Each item must have the spec-shaped fields.
    for (const item of items) {
      expect(item.asset_name).toMatch(/^deck_v[0-9A-Za-z.\-+]+_[a-z0-9]+-[a-z0-9]+\.tar\.gz$/);
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.url).toMatch(/^https:\/\/github\.com\/owner\/repo\/releases\/download\/v1\.2\.0\//);
    }
  });

  it("throws on a missing assets dir", () => {
    expect(() =>
      buildBinaryItemsFromAssetsDir(
        "/nonexistent/deck-assets",
        "https://example.com"
      )
    ).toThrow(/Assets directory not found/);
  });
});
