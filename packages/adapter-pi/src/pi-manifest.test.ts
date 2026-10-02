import { describe, expect, test } from "bun:test";

import {
  PI_MANIFEST_SCHEMA,
  canonicalJson,
  createEmptyPiManifest,
  hashContent,
  hashJsonValue,
  normalizePackageSource,
  parsePiManifest,
  serializePiManifest,
} from "./pi-manifest";

describe("hashing", () => {
  test("hashContent is a stable sha256 hex digest", () => {
    expect(hashContent("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("hashJsonValue ignores key order", () => {
    expect(hashJsonValue({ a: 1, b: { c: 2, d: 3 } })).toBe(hashJsonValue({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashJsonValue({ a: 1 })).not.toBe(hashJsonValue({ a: 2 }));
  });

  test("canonicalJson sorts keys recursively and keeps array order", () => {
    expect(canonicalJson({ b: [2, 1], a: { z: 1, y: 2 } })).toBe('{"a":{"y":2,"z":1},"b":[2,1]}');
  });
});

describe("manifest serialization", () => {
  test("round-trips and is deterministic", () => {
    const manifest = createEmptyPiManifest();
    manifest.files["deck/package/package.json"] = hashContent("{}");
    manifest.settings.packages = ["deck/package"];
    manifest.mcp.servers["context7"] = hashJsonValue({ command: "/bin/true" });
    const text = serializePiManifest(manifest);
    expect(text.endsWith("\n")).toBe(true);
    expect(parsePiManifest(text)).toEqual({ ok: true, manifest });
    expect(serializePiManifest(parsePiManifest(text).ok ? (parsePiManifest(text) as { manifest: typeof manifest }).manifest : manifest)).toBe(text);
  });

  test("rejects malformed input without throwing", () => {
    expect(parsePiManifest("not json").ok).toBe(false);
    expect(parsePiManifest("[]").ok).toBe(false);
    expect(parsePiManifest(JSON.stringify({ schema: "other" })).ok).toBe(false);
    expect(parsePiManifest(JSON.stringify({ schema: PI_MANIFEST_SCHEMA, files: [] })).ok).toBe(false);
  });

  test("missing optional sections default to empty", () => {
    const parsed = parsePiManifest(JSON.stringify({ schema: PI_MANIFEST_SCHEMA, files: {} }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.settings.packages).toEqual([]);
      expect(parsed.manifest.settings.addedPackages).toEqual([]);
      expect(parsed.manifest.mcp.servers).toEqual({});
    }
  });
});

describe("normalizePackageSource", () => {
  test("handles npm prefixes, versions and object entries", () => {
    expect(normalizePackageSource("npm:pi-subagents")).toBe("pi-subagents");
    expect(normalizePackageSource("npm:pi-subagents@1.2.3")).toBe("pi-subagents");
    expect(normalizePackageSource("pi-mcp-adapter")).toBe("pi-mcp-adapter");
    expect(normalizePackageSource("npm:@scope/pkg@2.0.0")).toBe("@scope/pkg");
    expect(normalizePackageSource({ source: "npm:pi-mcp-adapter", extensions: [] })).toBe("pi-mcp-adapter");
    expect(normalizePackageSource("deck/package")).toBe("deck/package");
  });

  test("returns undefined for unusable entries", () => {
    expect(normalizePackageSource(42)).toBeUndefined();
    expect(normalizePackageSource({})).toBeUndefined();
    expect(normalizePackageSource(null)).toBeUndefined();
  });
});
