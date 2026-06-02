/**
 * Unit tests for the release descriptor schema and parser.
 *
 * These tests pin the contract described in
 * `openspec/changes/add-self-update-system/spec.md` (REQ-RD-001 .. REQ-RD-011).
 * The fixture under `__fixtures__/release-fixture.json` is the canonical
 * reference descriptor used by T1.2 (prepare-release.ts) and downstream
 * G2 backend tasks.
 *
 * Field names are **spec-shaped (snake_case)** as required by REQ-RD-002
 * and REQ-RD-003. A separate `designDescriptorToSpec` transform is
 * exercised in the "design-shape compatibility" describe block.
 */

import { describe, it, expect } from "bun:test";

import {
  BINARY_ASSET_NAME_PATTERN,
  designDescriptorToSpec,
  getCurrentPlatformTriple,
  orderReleaseItems,
  parseDescriptorAuto,
  parseReleaseDescriptor,
  ReleaseDescriptorError,
  ReleaseItemSchema,
  ReleaseJsonSchema,
  selectBinaryItemForPlatform,
  selectItemsByKind,
  Sha256HexSchema,
  toLegacyReleaseInfo,
  RELEASE_ITEM_KINDS,
  type DesignReleaseJson,
  type ReleaseItem,
  type ReleaseJson,
} from "../release-descriptor.js";

const FIXTURE_PATH = new URL("../__fixtures__/release-fixture.json", import.meta.url);

async function loadFixture(): Promise<unknown> {
  const file = Bun.file(FIXTURE_PATH);
  return file.json();
}

/**
 * Build a spec-shaped binary item (REQ-RD-003, REQ-RD-005). All fields
 * are spec-named; `asset_name` is enforced to match the binary pattern.
 */
function makeSpecBinaryItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "binary-test",
    kind: "binary",
    required: true,
    platform: "linux-x64",
    asset_name: "deck_v1.0.0_linux-x64.tar.gz",
    url: "https://github.com/gentleman-programming/deck/releases/download/v1.0.0/deck_v1.0.0_linux-x64.tar.gz",
    sha256: "0".repeat(64),
    notes: "test binary",
    ...overrides,
  };
}

describe("release-descriptor / Sha256HexSchema", () => {
  it("accepts 64 lowercase hex characters", () => {
    const value = "abcdef0123456789".repeat(4);
    const result = Sha256HexSchema.safeParse(value);
    expect(result.success).toBe(true);
  });

  it("rejects values with mixed case", () => {
    const result = Sha256HexSchema.safeParse("A".repeat(64));
    expect(result.success).toBe(false);
  });

  it("rejects values with wrong length", () => {
    const result = Sha256HexSchema.safeParse("abc");
    expect(result.success).toBe(false);
  });
});

describe("release-descriptor / BINARY_ASSET_NAME_PATTERN (REQ-RD-005)", () => {
  it("accepts a deck_v{VERSION}_{OS}-{ARCH}.tar.gz filename", () => {
    expect(BINARY_ASSET_NAME_PATTERN.test("deck_v1.2.0_linux-x64.tar.gz")).toBe(true);
    expect(BINARY_ASSET_NAME_PATTERN.test("deck_v0.1.0_darwin-arm64.tar.gz")).toBe(true);
  });

  it("rejects filenames that don't match the required pattern", () => {
    expect(BINARY_ASSET_NAME_PATTERN.test("deck-1.2.0-linux.tar.gz")).toBe(false);
    expect(BINARY_ASSET_NAME_PATTERN.test("deck_v1.2.0.tar.gz")).toBe(false);
    expect(BINARY_ASSET_NAME_PATTERN.test("random_v1.2.0_linux-x64.tar.gz")).toBe(false);
  });
});

describe("release-descriptor / ReleaseJsonSchema (spec-shaped)", () => {
  it("parses the canonical fixture (snake_case)", async () => {
    const fixture = await loadFixture();
    const result = ReleaseJsonSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data;
    expect(data.schemaVersion).toBe(1);
    expect(data.version).toBe("1.2.0");
    expect(data.tag_name).toBe("v1.2.0");
    expect(data.channel).toBe("stable");
    expect(data.items).toHaveLength(6);
  });

  it("rejects missing required top-level fields", () => {
    const invalid = { items: [] };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown schemaVersion", () => {
    const invalid = {
      schemaVersion: 2,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid channel", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "nightly",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects non-ISO published_at", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "yesterday",
      items: [],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe("release-descriptor / ReleaseItemSchema (spec-shaped)", () => {
  it("accepts all five supported kinds with spec-named fields", () => {
    const items = [
      makeSpecBinaryItem(),
      {
        id: "content",
        kind: "content",
        required: false,
        asset_name: "deck_v1.0.0_content.tar.gz",
        url: "https://example.com/c.tar.gz",
        sha256: "0".repeat(64),
        notes: "",
        content_kinds: ["prompts"],
      },
      {
        id: "migration",
        kind: "migration",
        required: true,
        asset_name: "deck_v1.0.0_migration.tar.gz",
        url: "https://example.com/m.tar.gz",
        sha256: "0".repeat(64),
        notes: "",
        from_schema_version: 1,
        to_schema_version: 2,
      },
      {
        id: "advisory",
        kind: "advisory",
        required: false,
        asset_name: "deck_v1.0.0_advisory.json",
        url: "https://example.com/a.json",
        sha256: "0".repeat(64),
        notes: "all good",
        severity: "info",
        affected_versions: ["<=1.0.0"],
      },
      {
        id: "channel-eol",
        kind: "channel_eol",
        required: false,
        asset_name: "deck_v1.0.0_channel_eol.json",
        url: "https://example.com/e.json",
        sha256: "0".repeat(64),
        notes: "switch to stable",
        successor_channel: "stable",
      },
    ];
    for (const item of items) {
      const result = ReleaseItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown kind values", () => {
    const result = ReleaseItemSchema.safeParse({
      ...makeSpecBinaryItem(),
      kind: "patch",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid SHA-256 in a binary item", () => {
    const result = ReleaseItemSchema.safeParse(
      makeSpecBinaryItem({ sha256: "not-a-hash" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a content item without content_kinds", () => {
    const result = ReleaseItemSchema.safeParse({
      id: "content-bad",
      kind: "content",
      required: false,
      asset_name: "deck_v1.0.0_content.tar.gz",
      url: "https://example.com/c.tar.gz",
      sha256: "0".repeat(64),
      notes: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an advisory missing affected_versions", () => {
    const result = ReleaseItemSchema.safeParse({
      id: "advisory-bad",
      kind: "advisory",
      required: false,
      asset_name: "deck_v1.0.0_advisory.json",
      url: "https://example.com/a.json",
      sha256: "0".repeat(64),
      notes: "hi",
      severity: "info",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a binary item whose asset_name doesn't match the spec pattern", () => {
    const result = ReleaseItemSchema.safeParse(
      makeSpecBinaryItem({ asset_name: "not-the-right-name.tar.gz" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("release-descriptor / parseReleaseDescriptor", () => {
  it("returns a typed ReleaseJson for a valid descriptor", async () => {
    const fixture = (await loadFixture()) as ReleaseJson;
    const parsed = parseReleaseDescriptor(fixture);
    expect(parsed.version).toBe("1.2.0");
    // Runtime narrowing: every item must have a `kind`
    const kinds: ReleaseItem["kind"][] = parsed.items.map((i) => i.kind);
    expect(new Set(kinds)).toEqual(new Set(RELEASE_ITEM_KINDS));
  });

  it("throws ReleaseDescriptorError for invalid JSON", () => {
    expect(() => parseReleaseDescriptor({})).toThrow(ReleaseDescriptorError);
  });

  it("uses DESCRIPTOR_INVALID error code", () => {
    try {
      parseReleaseDescriptor({ schemaVersion: 1 });
      throw new Error("should not reach here");
    } catch (err) {
      expect(err).toBeInstanceOf(ReleaseDescriptorError);
      expect((err as ReleaseDescriptorError).code).toBe("DESCRIPTOR_INVALID");
    }
  });
});

// ---------------------------------------------------------------------------
// T2.1 — Parsing logic, platform selection, item ordering
// ---------------------------------------------------------------------------

describe("release-descriptor / getCurrentPlatformTriple", () => {
  it("returns a non-empty triple in {OS}-{ARCH} form", () => {
    const triple = getCurrentPlatformTriple();
    expect(triple).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});

describe("release-descriptor / selectBinaryItemForPlatform", () => {
  it("returns the binary item whose platform matches the requested triple", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "bin-darwin",
          kind: "binary",
          required: true,
          platform: "darwin-arm64",
          asset_name: "deck_v1.0.0_darwin-arm64.tar.gz",
          url: "https://example.com/darwin.tar.gz",
          sha256: "a".repeat(64),
          notes: "",
        },
        {
          id: "bin-linux",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          asset_name: "deck_v1.0.0_linux-x64.tar.gz",
          url: "https://example.com/linux.tar.gz",
          sha256: "b".repeat(64),
          notes: "",
        },
      ],
    };
    const linux = selectBinaryItemForPlatform(descriptor, "linux-x64");
    expect(linux?.asset_name).toContain("linux-x64");
    const darwin = selectBinaryItemForPlatform(descriptor, "darwin-arm64");
    expect(darwin?.asset_name).toContain("darwin-arm64");
  });

  it("returns undefined when no binary item matches the platform", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "content-only",
          kind: "content",
          required: false,
          asset_name: "deck_v1.0.0_content.tar.gz",
          url: "https://example.com/c.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          content_kinds: ["prompts"],
        },
      ],
    };
    expect(selectBinaryItemForPlatform(descriptor, "linux-x64")).toBeUndefined();
  });
});

describe("release-descriptor / selectItemsByKind", () => {
  it("returns items of the requested kind, preserving descriptor order", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "adv-1",
          kind: "advisory",
          required: false,
          asset_name: "deck_v1.0.0_adv1.json",
          url: "https://example.com/a1.json",
          sha256: "0".repeat(64),
          notes: "a1",
          severity: "info",
          affected_versions: ["<=1.0.0"],
        },
        {
          id: "adv-2",
          kind: "advisory",
          required: false,
          asset_name: "deck_v1.0.0_adv2.json",
          url: "https://example.com/a2.json",
          sha256: "0".repeat(64),
          notes: "a2",
          severity: "warning",
          affected_versions: ["<=1.0.0"],
        },
        {
          id: "mig-1",
          kind: "migration",
          required: true,
          asset_name: "deck_v1.0.0_mig.tar.gz",
          url: "https://example.com/mig.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          from_schema_version: 1,
          to_schema_version: 2,
        },
      ],
    };
    const advisories = selectItemsByKind(descriptor, "advisory");
    expect(advisories).toHaveLength(2);
    expect(advisories[0]?.id).toBe("adv-1");
    expect(advisories[1]?.id).toBe("adv-2");
  });

  it("returns an empty array when no items of the kind are present", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [],
    };
    expect(selectItemsByKind(descriptor, "channel_eol")).toEqual([]);
  });
});

describe("release-descriptor / orderReleaseItems", () => {
  it("orders items as advisory → migration → binary → content → channel_eol", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "content",
          kind: "content",
          required: false,
          asset_name: "deck_v1.0.0_c.tar.gz",
          url: "https://example.com/c.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          content_kinds: ["prompts"],
        },
        {
          id: "binary",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          asset_name: "deck_v1.0.0_linux-x64.tar.gz",
          url: "https://example.com/b.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
        },
        {
          id: "advisory",
          kind: "advisory",
          required: false,
          asset_name: "deck_v1.0.0_a.json",
          url: "https://example.com/a.json",
          sha256: "0".repeat(64),
          notes: "info",
          severity: "info",
          affected_versions: ["<=1.0.0"],
        },
        {
          id: "channel-eol",
          kind: "channel_eol",
          required: false,
          asset_name: "deck_v1.0.0_e.json",
          url: "https://example.com/e.json",
          sha256: "0".repeat(64),
          notes: "eol",
          successor_channel: "stable",
        },
        {
          id: "migration",
          kind: "migration",
          required: true,
          asset_name: "deck_v1.0.0_mig.tar.gz",
          url: "https://example.com/mig.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          from_schema_version: 1,
          to_schema_version: 2,
        },
      ],
    };
    const ordered = orderReleaseItems(descriptor).map((i) => i.id);
    expect(ordered).toEqual([
      "advisory",
      "migration",
      "binary",
      "content",
      "channel-eol",
    ]);
  });

  it("preserves the relative order of items with the same kind", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "adv-1",
          kind: "advisory",
          required: false,
          asset_name: "deck_v1.0.0_a1.json",
          url: "https://example.com/a1.json",
          sha256: "0".repeat(64),
          notes: "first",
          severity: "info",
          affected_versions: ["<=1.0.0"],
        },
        {
          id: "adv-2",
          kind: "advisory",
          required: false,
          asset_name: "deck_v1.0.0_a2.json",
          url: "https://example.com/a2.json",
          sha256: "0".repeat(64),
          notes: "second",
          severity: "warning",
          affected_versions: ["<=1.0.0"],
        },
      ],
    };
    const ordered = orderReleaseItems(descriptor).map((i) => i.id);
    expect(ordered).toEqual(["adv-1", "adv-2"]);
  });
});

describe("release-descriptor / toLegacyReleaseInfo (legacy fallback)", () => {
  it("returns a legacy-shaped object when a binary item matches the platform", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "bin-linux",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          asset_name: "deck_v1.0.0_linux-x64.tar.gz",
          url: "https://example.com/deck.tar.gz",
          sha256: "f".repeat(64),
          notes: "",
        },
      ],
    };
    const legacy = toLegacyReleaseInfo(descriptor, "linux-x64");
    expect(legacy).not.toBeNull();
    expect(legacy?.tagName).toBe("v1.0.0");
    expect(legacy?.version).toBe("1.0.0");
    expect(legacy?.downloadUrl).toBe("https://example.com/deck.tar.gz");
    expect(legacy?.sha256).toBe("f".repeat(64));
  });

  it("returns null when the descriptor has no binary item for the platform", () => {
    const descriptor: ReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "content",
          kind: "content",
          required: false,
          asset_name: "deck_v1.0.0_c.tar.gz",
          url: "https://example.com/c.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          content_kinds: ["prompts"],
        },
      ],
    };
    expect(toLegacyReleaseInfo(descriptor, "linux-x64")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Spec-shaped descriptor pinned by spec.md REQ-RD-001 .. REQ-RD-011
// ---------------------------------------------------------------------------

describe("release-descriptor / spec-shaped descriptor (REQ-RD-001..011)", () => {
  /**
   * This descriptor is hand-written from the spec and asserts the exact
   * field names that REQ-RD-002 and REQ-RD-003 require. It exercises the
   * minimum-viable contract: top-level required fields + one item per kind
   * with kind-specific fields populated.
   */
  it("accepts a hand-written spec-shaped descriptor for all five kinds", () => {
    const descriptor = {
      schemaVersion: 1,
      version: "2.0.0",
      tag_name: "v2.0.0",
      published_at: "2026-06-02T12:00:00.000Z",
      channel: "stable",
      release_notes_url: "https://github.com/owner/repo/releases/tag/v2.0.0",
      items: [
        {
          id: "binary-linux-x64-v2.0.0",
          kind: "binary",
          required: true,
          asset_name: "deck_v2.0.0_linux-x64.tar.gz",
          sha256: "0".repeat(64),
          notes: "Linux x86_64 binary",
          platform: "linux-x64",
          url: "https://github.com/owner/repo/releases/download/v2.0.0/deck_v2.0.0_linux-x64.tar.gz",
        },
        {
          id: "content-prompts-skills-v2.0.0",
          kind: "content",
          required: false,
          asset_name: "deck_v2.0.0_content.tar.gz",
          sha256: "1".repeat(64),
          notes: "Content bundle",
          url: "https://github.com/owner/repo/releases/download/v2.0.0/deck_v2.0.0_content.tar.gz",
          content_kinds: ["prompts", "skills"],
        },
        {
          id: "migration-v1-to-v2",
          kind: "migration",
          required: true,
          asset_name: "deck_v2.0.0_migration.tar.gz",
          sha256: "2".repeat(64),
          notes: "Manifest v1 -> v2",
          from_schema_version: 1,
          to_schema_version: 2,
        },
        {
          id: "advisory-homebrew",
          kind: "advisory",
          required: false,
          asset_name: "deck_v2.0.0_advisory.json",
          sha256: "3".repeat(64),
          notes: "Homebrew users should run `brew upgrade deck`",
          severity: "warning",
          affected_versions: ["<=1.9.0"],
        },
        {
          id: "channel-eol-beta-2026",
          kind: "channel_eol",
          required: false,
          asset_name: "deck_v2.0.0_channel_eol.json",
          sha256: "4".repeat(64),
          notes: "Beta channel is being retired; move to stable.",
          successor_channel: "stable",
        },
      ],
    } as const;
    const parsed = parseReleaseDescriptor(descriptor);
    expect(parsed.version).toBe("2.0.0");
    expect(parsed.tag_name).toBe("v2.0.0");
    expect(parsed.published_at).toBe("2026-06-02T12:00:00.000Z");
    expect(parsed.release_notes_url).toContain("releases/tag/v2.0.0");
    expect(parsed.items).toHaveLength(5);
    const kinds = new Set(parsed.items.map((i) => i.kind));
    expect(kinds).toEqual(new Set(RELEASE_ITEM_KINDS));
  });

  it("rejects a spec-shaped descriptor missing `tag_name` (REQ-RD-002)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      published_at: "2026-06-02T00:00:00.000Z",
      channel: "stable",
      items: [],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects a spec-shaped descriptor missing `published_at` (REQ-RD-002)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      items: [],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects an item missing `sha256` (REQ-RD-003, REQ-RD-010)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [
        {
          id: "x",
          kind: "binary",
          required: true,
          asset_name: "deck_v1.0.0_linux-x64.tar.gz",
          platform: "linux-x64",
          url: "https://example.com/x.tar.gz",
          notes: "",
        },
      ],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects an item missing `asset_name` (REQ-RD-003)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [
        {
          id: "x",
          kind: "binary",
          required: true,
          sha256: "0".repeat(64),
          platform: "linux-x64",
          url: "https://example.com/x.tar.gz",
          notes: "",
        },
      ],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects a migration item without from_schema_version (REQ-RD-007)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [
        {
          id: "m",
          kind: "migration",
          required: true,
          asset_name: "deck_v1.0.0_mig.tar.gz",
          url: "https://example.com/m.tar.gz",
          sha256: "0".repeat(64),
          notes: "",
          to_schema_version: 2,
        },
      ],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects a channel_eol item without successor_channel (REQ-RD-009)", () => {
    const invalid = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-06-02T00:00:00.000Z",
      items: [
        {
          id: "e",
          kind: "channel_eol",
          required: false,
          asset_name: "deck_v1.0.0_eol.json",
          url: "https://example.com/eol.json",
          sha256: "0".repeat(64),
          notes: "",
        },
      ],
    };
    const result = ReleaseJsonSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// design-shape compatibility transform
// ---------------------------------------------------------------------------

describe("release-descriptor / designDescriptorToSpec (compatibility)", () => {
  it("converts a design-shaped (camelCase) descriptor to spec-shaped (snake_case)", () => {
    const design: DesignReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag: "v1.0.0",
      channel: "stable",
      publishedAt: "2026-01-01T00:00:00.000Z",
      notesUrl: "https://example.com/notes",
      minDeckVersion: "0.9.0",
      items: [
        {
          id: "bin-linux",
          kind: "binary",
          required: true,
          platform: "linux-x64",
          assetName: "deck_v1.0.0_linux-x64.tar.gz",
          url: "https://example.com/b.tar.gz",
          checksum: { algorithm: "sha256", value: "a".repeat(64) },
        },
        {
          id: "content",
          kind: "content",
          required: false,
          assetName: "deck_v1.0.0_content.tar.gz",
          url: "https://example.com/c.tar.gz",
          checksum: { algorithm: "sha256", value: "b".repeat(64) },
          contentKinds: ["prompts", "skills"],
        },
        {
          id: "mig",
          kind: "migration",
          required: true,
          assetName: "deck_v1.0.0_migration.tar.gz",
          url: "https://example.com/mig.tar.gz",
          checksum: { algorithm: "sha256", value: "c".repeat(64) },
          migrationId: "m1",
          fromSchema: { manifest: 1 },
          toSchema: { manifest: 2 },
        },
        {
          id: "adv",
          kind: "advisory",
          required: false,
          assetName: "deck_v1.0.0_advisory.json",
          url: "https://example.com/a.json",
          checksum: { algorithm: "sha256", value: "d".repeat(64) },
          severity: "info",
          message: "all good",
        },
        {
          id: "eol",
          kind: "channel_eol",
          required: false,
          assetName: "deck_v1.0.0_eol.json",
          url: "https://example.com/e.json",
          checksum: { algorithm: "sha256", value: "e".repeat(64) },
          channel: "beta",
          message: "switch",
          migrateToChannel: "stable",
        },
      ],
    };
    const spec = designDescriptorToSpec(design);
    const validated = parseReleaseDescriptor(spec);
    expect(validated.tag_name).toBe("v1.0.0");
    expect(validated.published_at).toBe("2026-01-01T00:00:00.000Z");
    expect(validated.release_notes_url).toBe("https://example.com/notes");
    expect(validated.min_deck_version).toBe("0.9.0");
    // binary
    const binary = validated.items.find((i) => i.kind === "binary");
    expect(binary?.asset_name).toBe("deck_v1.0.0_linux-x64.tar.gz");
    expect(binary?.sha256).toBe("a".repeat(64));
    // content
    const content = validated.items.find((i) => i.kind === "content");
    expect(content?.content_kinds).toEqual(["prompts", "skills"]);
    // migration: fromSchema { manifest: 1 } -> from_schema_version 1
    const migration = validated.items.find((i) => i.kind === "migration");
    expect(migration?.from_schema_version).toBe(1);
    expect(migration?.to_schema_version).toBe(2);
    // advisory: affected_versions defaulted to ["unknown"]
    const advisory = validated.items.find((i) => i.kind === "advisory");
    expect(advisory?.severity).toBe("info");
    expect(advisory?.affected_versions).toEqual(["unknown"]);
    // channel_eol: migrateToChannel -> successor_channel
    const eol = validated.items.find((i) => i.kind === "channel_eol");
    expect(eol?.successor_channel).toBe("stable");
  });
});

describe("release-descriptor / parseDescriptorAuto", () => {
  it("returns a spec-shaped descriptor when given a spec-shaped input", () => {
    const specInput = {
      schemaVersion: 1,
      version: "1.0.0",
      tag_name: "v1.0.0",
      channel: "stable",
      published_at: "2026-01-01T00:00:00.000Z",
      items: [],
    };
    const out = parseDescriptorAuto(specInput);
    expect(out.tag_name).toBe("v1.0.0");
  });

  it("normalizes a design-shaped input to spec-shaped", () => {
    const designInput: DesignReleaseJson = {
      schemaVersion: 1,
      version: "1.0.0",
      tag: "v1.0.0",
      channel: "stable",
      publishedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "eol",
          kind: "channel_eol",
          required: false,
          assetName: "deck_v1.0.0_eol.json",
          url: "https://example.com/e.json",
          checksum: { algorithm: "sha256", value: "0".repeat(64) },
          channel: "beta",
          message: "switch",
          migrateToChannel: "stable",
        },
      ],
    };
    const out = parseDescriptorAuto(designInput);
    expect(out.tag_name).toBe("v1.0.0");
    const eol = out.items.find((i) => i.kind === "channel_eol");
    expect(eol?.successor_channel).toBe("stable");
  });
});
