import { describe, expect, test } from "bun:test";

import {
  buildSupermemoryConversationIngest,
  boundSupermemoryRetrievalItems,
  classifySupermemoryMigrationInventory,
  OFFICIAL_SUPERMEMORY_TRANSPORT_CAPABILITIES,
  redactSupermemoryConversationContent,
} from "./conversation";

describe("Supermemory conversation contract", () => {
  test("uses one stable customId, canonical containerTag, and dynamic dreaming for production conversation turns", () => {
    const first = buildSupermemoryConversationIngest({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "session-123",
      turn: { role: "user", content: "Please implement the change." },
    });
    const second = buildSupermemoryConversationIngest({
      canonicalScope: "sm_project_v1_kevin15011_deck",
      sessionId: "session-123",
      turn: { role: "assistant", content: "Done." },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.request.containerTag).toBe("sm_project_v1_kevin15011_deck");
      expect(second.request.containerTag).toBe("sm_project_v1_kevin15011_deck");
      expect(first.request.customId).toBe(second.request.customId);
      expect(first.request.dreaming).toBe("dynamic");
      expect(second.request.dreaming).toBe("dynamic");
    }
  });

  test("rejects or redacts credentials before any provider call", () => {
    const redacted = redactSupermemoryConversationContent([
      "Authorization: Basic dXNlcjpwYXNz",
      "{\"headers\":{\"Authorization\":\"Bearer header-secret\"}}",
      "AWS_SECRET_ACCESS_KEY=very-secret-cloud-key",
      "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
      "{\"OPENAI_API_KEY\":\"sk-live-secret-value\"}",
      "PATH=/usr/bin\nHOME=/home/user\nSUPERMEMORY_API_KEY=secret",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      "hello",
    ].join("\n"));

    expect(redacted.safe).toBe(false);
    for (const secret of ["dXNlcjpwYXNz", "header-secret", "very-secret-cloud-key", "AKIA1234567890ABCDEF", "sk-live-secret-value", "PATH=/usr/bin", "HOME=/home/user", "SUPERMEMORY_API_KEY=secret", "abc"]) {
      expect(redacted.content).not.toContain(secret);
      expect(redacted.diagnostics.join(" ")).not.toContain(secret);
    }
  });

  test("rejects invalid canonical scope at the executing ingest boundary", () => {
    const result = buildSupermemoryConversationIngest({
      canonicalScope: "sm_project_default",
      sessionId: "session-1",
      turn: { role: "user", content: "hello" },
    });

    expect(result.ok).toBe(false);
  });

  test("bounds retrieval to five items and a 1500 token default budget without rerank or rewrite", () => {
    const bounded = boundSupermemoryRetrievalItems({
      items: Array.from({ length: 8 }, (_, index) => ({ id: String(index), content: "word ".repeat(100) })),
    });

    expect(bounded.items).toHaveLength(5);
    expect(bounded.maxTokens).toBe(1500);
    expect(bounded.rerank).toBe(false);
    expect(bounded.rewriteQuery).toBe(false);
  });

  test("migration inventory is deterministic, dry-run only, and offers no remote deletion", () => {
    const inventory = classifySupermemoryMigrationInventory({
      destinationScope: "sm_project_v1_kevin15011_deck",
      records: [
        { id: "1", sourceContainerTag: "sm_project_kevin15011-deck", content: "Deck memory", sourceIdentity: "doc:1" },
        { id: "2", sourceContainerTag: "other", content: "Unrelated", sourceIdentity: "doc:2" },
        { id: "3", sourceContainerTag: "sm_project_kevin15011-deck", content: "Deck memory", sourceIdentity: "doc:1" },
        { id: "4", sourceContainerTag: "sm_project_deck", content: "Maybe deck", sourceIdentity: "doc:4" },
      ],
    });

    expect(inventory.dryRun).toBe(true);
    expect(inventory.remoteDeletionAvailable).toBe(false);
    expect(inventory.summary).toEqual({ confirmed: 1, unrelated: 1, duplicate: 1, ambiguous: 1 });
    expect(JSON.stringify(inventory)).not.toContain("Unrelated");
    expect(JSON.stringify(inventory)).not.toContain("doc:1");
    expect(inventory.copyAvailable).toBe(false);
  });

  test("migration validates canonical destination scope and hashes normalized content", () => {
    expect(() => classifySupermemoryMigrationInventory({ destinationScope: "sm_project_default", records: [] })).toThrow("canonical destination scope");
    const one = classifySupermemoryMigrationInventory({ destinationScope: "sm_project_v1_kevin15011_deck", records: [{ id: "A", sourceContainerTag: "sm_project_kevin15011-deck", content: "Line one\r\n\r\nLine two" }] });
    const two = classifySupermemoryMigrationInventory({ destinationScope: "sm_project_v1_kevin15011_deck", records: [{ id: "B", sourceContainerTag: "sm_project_kevin15011-deck", content: " line one\nline two " }] });
    expect(one.examples[0]?.contentHash).toBe(two.examples[0]?.contentHash);
    expect(one.examples[0]?.id).not.toBe("A");
  });

  test("documents the selected provider-native capability spike from official evidence", () => {
    expect(OFFICIAL_SUPERMEMORY_TRANSPORT_CAPABILITIES).toMatchObject({
      stableCustomId: "supported",
      dynamicDreaming: "supported",
      immutableContainerScope: "supported",
      profileRetrieval: "supported",
      hybridSearch: "supported",
      migrationEnumeration: "not-locally-proven",
      oauthDelegation: "runner-native-only",
    });
  });
});
