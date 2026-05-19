import { describe, expect, test } from "bun:test";
import {
  createEngramMemoryProvider,
} from "./index";
import { resolveMemoryInjection } from "@deck/core/memory/adaptive-memory";

describe("createEngramMemoryProvider", () => {
  const provider = createEngramMemoryProvider();

  test("has correct provider id and displayName", () => {
    expect(provider.id).toBe("engram");
    expect(provider.displayName).toContain("Engram");
    expect(provider.displayName).toContain("Experimental");
  });

  test("buildInjection returns fragments with session, agent, and skill surfaces", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const surfaces = bundle.instructions.map((f) => f.surface);
    expect(surfaces).toContain("session");
    expect(surfaces).toContain("agent");
    expect(surfaces).toContain("skill");
    expect(bundle.instructions.length).toBeGreaterThanOrEqual(3);
  });

  test("buildInjection returns tool bindings for memory.search, memory.read, memory.write", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const capabilities = bundle.toolBindings.map((b) => b.capability);
    expect(capabilities).toContain("memory.search");
    expect(capabilities).toContain("memory.read");
    expect(capabilities).toContain("memory.write");
  });

  test("tool bindings reference the engram MCP server", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    for (const binding of bundle.toolBindings) {
      expect(binding.serverName).toBe("engram");
      expect(binding.toolNames.length).toBeGreaterThan(0);
    }
  });

  test("tool bindings use only memory_* prefixed names (no generic aliases)", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    // No generic aliases like "read", "write", "search" that could collide
    // with built-in runtime tools
    for (const binding of bundle.toolBindings) {
      for (const toolName of binding.toolNames) {
        expect(toolName).toMatch(/^memory_/);
      }
    }
  });

  test("fragments contain auxiliary-memory policy stating OpenSpec remains authoritative", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    for (const fragment of bundle.instructions) {
      // Fragment content must state that memory is auxiliary and OpenSpec is authoritative
      const lowerMarkdown = fragment.markdown.toLowerCase();
      expect(lowerMarkdown).toContain("auxiliary");
      expect(
        lowerMarkdown.includes("openspec") || lowerMarkdown.includes("spec registry"),
      ).toBe(true);
    }
  });

  test("fragments contain memory safety policy prohibiting secrets and sensitive data", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    for (const fragment of bundle.instructions) {
      const lowerMarkdown = fragment.markdown.toLowerCase();
      // Safety policy must mention secrets/credentials/sensitive
      expect(
        lowerMarkdown.includes("secrets") || lowerMarkdown.includes("credentials") || lowerMarkdown.includes("sensitive"),
      ).toBe(true);
      // Must prohibit storing such data
      expect(lowerMarkdown).toContain("never store");
    }
  });

  test("fragments do not contain unsupported-provider rejection patterns", () => {
    // REQ-AMI-003: Provider content must not assert it is the only memory system or
    // claim to replace core artifacts. These patterns would indicate broken guidance.
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const rejectionPatterns = [
      "replace openspec",
      "replace spec registry",
      "only memory system",
      "authoritative source",
      "source of truth",
    ];

    for (const fragment of bundle.instructions) {
      const lowerMarkdown = fragment.markdown.toLowerCase();
      for (const pattern of rejectionPatterns) {
        expect(lowerMarkdown).not.toContain(pattern);
      }
    }
  });

  test("fragments are labeled as experimental", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    for (const fragment of bundle.instructions) {
      expect(fragment.markdown).toContain("Experimental");
    }
  });

  test("buildInjection with no teamId context returns all fragments", () => {
    const bundle = provider.buildInjection({});

    // Without a teamId filter, fragments without teamId restriction should appear
    // All developer-team fragments have teamId set, so they should still be included
    // since we're not filtering them out
    expect(bundle.instructions.length).toBeGreaterThanOrEqual(3);
  });

  test("buildInjection with developer-team teamId returns matching fragments", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    // All fragments have teamId: "developer-team", so all should be included
    expect(bundle.instructions.length).toBeGreaterThanOrEqual(3);

    for (const fragment of bundle.instructions) {
      expect(fragment.teamId).toBe("developer-team");
    }
  });

  test("buildInjection with non-matching teamId returns no fragments", () => {
    const bundle = provider.buildInjection({ teamId: "other-team" });

    // No fragments match "other-team" teamId
    expect(bundle.instructions).toHaveLength(0);
  });

  test("fragments include Engram MCP tool usage instructions with memory_* prefix", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const sessionFragment = bundle.instructions.find((f) => f.surface === "session");
    expect(sessionFragment).toBeDefined();
    expect(sessionFragment!.markdown).toContain("memory_search");
    expect(sessionFragment!.markdown).toContain("memory_read");
    expect(sessionFragment!.markdown).toContain("memory_write");
  });

  test("fragments do not reference generic tool aliases (read, write, search) in command listings", () => {
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    // The session fragment commands section should only list memory_* names
    const sessionFragment = bundle.instructions.find((f) => f.surface === "session");
    expect(sessionFragment).toBeDefined();
    // Should not use bare "search", "read", "write" as command aliases
    const lines = sessionFragment!.markdown.split("\n").filter((l) => l.trim().startsWith("- `"));
    for (const line of lines) {
      // Each command listing should use memory_* prefix, not generic names
      expect(line).not.toMatch(/ `- search`/);
      expect(line).not.toMatch(/ `- read`/);
      expect(line).not.toMatch(/ `- write`/);
    }
  });
});

describe("Engram provider integration with resolveMemoryInjection", () => {
  test("provider exposes the Engram provider ID", () => {
    expect(createEngramMemoryProvider().id).toBe("engram");
  });

  test("resolveMemoryInjection accepts Engram provider", () => {
    const provider = createEngramMemoryProvider();
    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: [provider.id],
      buildContext: { teamId: "developer-team" },
    });

    expect(diagnostics).toHaveLength(0);
    expect(bundle).toBeDefined();
    expect(bundle!.instructions.length).toBeGreaterThan(0);
  });

  test("resolveMemoryInjection rejects an unsupported provider object even if buildInjection succeeds", () => {
    const unsupported = {
      id: "unknown-provider",
      displayName: "Unknown",
      buildInjection: () => ({
        instructions: [{ surface: "session" as const, markdown: "Injected by unknown provider", teamId: "developer-team" }],
        toolBindings: [],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: unsupported,
      supportedProviderIds: ["engram"],
      buildContext: { teamId: "developer-team" },
    });
    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unsupported_memory_provider");
    expect(diagnostics[0].providerId).toBe("unknown-provider");
  });
});