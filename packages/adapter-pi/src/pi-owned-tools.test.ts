import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import { createPiTools, type PiToolOptions } from "./pi-owned-tools";

let home: string;
beforeEach(() => { home = realpathSync(mkdtempSync(join(tmpdir(), "deck-pi-tools-"))); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const platform = `${process.platform}-${process.arch}`;

function options(overrides: Partial<PiToolOptions> = {}): PiToolOptions {
  return {
    homeDir: home,
    env: {},
    dataRoot: join(home, ".local", "share", "deck"),
    resolveCommand: () => undefined,
    verifyRtkCommand: () => true,
    verifyCodebaseNative: () => true,
    verifyExistingCodebase: () => true,
    ...overrides,
  };
}

function put(directory: string, name: string, content: string, mode = 0o700) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let current = directory; current.length > home.length; current = dirname(current)) chmodSync(current, 0o700);
  writeFileSync(join(directory, name), content, { mode });
  chmodSync(join(directory, name), mode);
}

/** Minimal single-member ustar archive with the layout `extractPinnedRtk` expects. */
function rtkArchive(binary: string): Uint8Array {
  const header = Buffer.alloc(512);
  header.write("rtk", 0, "utf8");
  header.write(binary.length.toString(8).padStart(11, "0"), 124, "ascii");
  header[156] = 48;
  const body = Buffer.alloc(Math.ceil(binary.length / 512) * 512);
  body.write(binary);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)]));
}

describe("owned tool roots", () => {
  test("live under the Deck data root, never under the Pi agent dir or the project", () => {
    const tools = createPiTools(options());
    expect(tools.toolRoot).toBe(join(home, ".local", "share", "deck", "pi", "tools"));
    expect(tools.rtk.root.startsWith(tools.toolRoot)).toBe(true);
  });

  test("requires an absolute HOME", () => {
    expect(() => createPiTools(options({ homeDir: "relative" }))).toThrow(/absolute/i);
  });
});

describe("RTK (Deck-owned pinned release)", () => {
  const binary = "rtk fixture binary";
  const release = { asset: "fixture", archiveSha256: "0".repeat(64), archiveBytes: 1, binarySha256: sha(binary), binaryBytes: binary.length };

  test("is absent until installed and never resolved from PATH", () => {
    const tools = createPiTools(options({ rtkReleaseOverride: release, resolveCommand: (name) => (name === "rtk" ? "/usr/bin/rtk" : undefined) }));
    expect(tools.rtk.state()).toBe("absent");
    expect(tools.rtk.command()).toBeUndefined();
  });

  test("is ready with an absolute owned command once the pinned binary is present", () => {
    const tools = createPiTools(options({ rtkReleaseOverride: release }));
    put(tools.rtk.root, "rtk", binary);
    expect(tools.rtk.state()).toBe("ready");
    expect(tools.rtk.command()).toBe(join(tools.rtk.root, "rtk"));
  });

  test("a tampered binary is a conflict, not ready", () => {
    const tools = createPiTools(options({ rtkReleaseOverride: release }));
    put(tools.rtk.root, "rtk", "tampered content!");
    expect(tools.rtk.state()).toBe("conflict");
    expect(tools.rtk.command()).toBeUndefined();
  });

  test("a binary that fails its version probe is unusable", () => {
    const tools = createPiTools(options({ rtkReleaseOverride: release, verifyRtkCommand: () => false }));
    put(tools.rtk.root, "rtk", binary);
    expect(tools.rtk.state()).toBe("unusable");
    expect(tools.rtk.command()).toBeUndefined();
  });

  test("installs from an injected archive with no network and publishes only the verified binary", async () => {
    const archive = rtkArchive(binary);
    const pinned = { asset: "fixture.tar.gz", archiveSha256: sha(archive), archiveBytes: archive.length, binarySha256: sha(binary), binaryBytes: binary.length };
    const tools = createPiTools(options({ rtkReleaseOverride: pinned, rtkArtifactEffects: { fetchArchive: async () => archive } }));
    expect(await tools.rtk.install()).toBe("installed");
    expect(tools.rtk.state()).toBe("ready");
    expect(await tools.rtk.install()).toBe("unchanged");
    expect(existsSync(join(tools.rtk.root, "rtk"))).toBe(true);
  });

  test("an archive that fails integrity checks is never published", async () => {
    const tools = createPiTools(options({ rtkReleaseOverride: { ...release, archiveBytes: 3, archiveSha256: "1".repeat(64) }, rtkArtifactEffects: { fetchArchive: async () => new Uint8Array([1, 2, 3]) } }));
    await expect(tools.rtk.install()).rejects.toThrow();
    expect(tools.rtk.state()).toBe("absent");
  });

  test("reports an unsupported platform without throwing", () => {
    const tools = createPiTools(options({ rtkReleaseOverride: undefined }));
    // Pinned releases cover the current CI platforms; an unknown platform must be expressed as unsupported.
    expect(["unsupported", "absent"]).toContain(tools.rtk.state());
  });
});

describe("Codebase Memory", () => {
  const binary = "codebase fixture binary";
  const release = { asset: "fixture", archiveSha256: "0".repeat(64), archiveBytes: 1, binarySha256: sha(binary), binaryBytes: binary.length };

  test("reuses a usable shared binary and plans no owned download", () => {
    const shared = join(home, "bin", "codebase-memory-mcp");
    put(join(home, "bin"), "codebase-memory-mcp", "shared");
    const tools = createPiTools(options({ codebaseReleaseOverride: release, resolveCommand: (name) => (name === "codebase-memory-mcp" ? shared : undefined) }));
    expect(tools.codebase.existing()).toBe(shared);
    expect(tools.codebase.command()).toBe(shared);
  });

  test("falls back to the owned pinned binary when no shared binary exists", () => {
    const tools = createPiTools(options({ codebaseReleaseOverride: release }));
    expect(tools.codebase.command()).toBeUndefined();
    put(tools.codebase.root, "codebase-memory-mcp", binary);
    expect(tools.codebase.state()).toBe("ready");
    expect(tools.codebase.command()).toBe(join(tools.codebase.root, "codebase-memory-mcp"));
  });

  test("an unusable shared binary is ignored", () => {
    const shared = join(home, "bin", "codebase-memory-mcp");
    put(join(home, "bin"), "codebase-memory-mcp", "shared");
    const tools = createPiTools(options({ codebaseReleaseOverride: release, verifyExistingCodebase: () => false, resolveCommand: (name) => (name === "codebase-memory-mcp" ? shared : undefined) }));
    expect(tools.codebase.existing()).toBeUndefined();
  });
});

describe("shared command resolution", () => {
  test("returns absolute executable paths only", () => {
    const exe = join(home, "bin", "context-mode");
    put(join(home, "bin"), "context-mode", "#!/bin/sh\n");
    const tools = createPiTools(options({ resolveCommand: (name) => (name === "context-mode" ? exe : name === "npx" ? "npx" : undefined) }));
    expect(tools.resolveExecutable("context-mode")).toBe(exe);
    expect(tools.resolveExecutable("npx")).toBeUndefined();
    expect(tools.resolveExecutable("missing")).toBeUndefined();
  });

  test("rejects non-executable files and paths with control characters", () => {
    const data = join(home, "bin", "data.txt");
    put(join(home, "bin"), "data.txt", "x", 0o600);
    const tools = createPiTools(options({ resolveCommand: (name) => (name === "data" ? data : name === "evil" ? "/bin/sh\nrm" : undefined) }));
    expect(tools.resolveExecutable("data")).toBeUndefined();
    expect(tools.resolveExecutable("evil")).toBeUndefined();
  });
});
