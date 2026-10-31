import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOpenCodeDeveloperTeamInstallPlan } from "./developer-team-install";

test("native review roles deny every unlisted tool in both tool and permission maps", () => {
  const root = mkdtempSync(join(tmpdir(), "deck-opencode-policy-"));
  try {
    const plan = buildOpenCodeDeveloperTeamInstallPlan(root, { configDir: root });
    for (const id of ["deck-quality", "deck-investigate"]) {
      const entry = plan.agentEntries[id]!;
      expect(entry.tools).toMatchObject({ "*": false, bash: false, edit: false, write: false, read: true });
      expect(entry.permission).toMatchObject({ "*": "deny", read: "allow" });
      for (const name of ["user_shell", "codebase-memory_index_repository", "codebase-memory_delete_project", "serena_find_symbol", "context-mode_ctx_execute"]) {
        expect(entry.tools?.[name] ?? entry.tools?.["*"]).toBe(false);
        expect(entry.permission?.[name] ?? entry.permission?.["*"]).toBe("deny");
      }
      for (const name of ["context7_query-docs", "codebase-memory_search_graph", "web-search_tavily_search"]) {
        expect(entry.tools?.[name]).toBe(true); expect(entry.permission?.[name]).toBe("allow");
      }
    }
    expect(plan.agentEntries["deck-apply-deep"]?.tools?.bash).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
