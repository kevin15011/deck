import { describe, expect, test } from "bun:test";
import { createOpenCodeDiscoveryCoordinator, getOpenCodeDiscoveryAction } from "./opencode-discovery";

type DiscoveryState = { kind: "loading" | "empty" | "blocked" };

describe("DeckApp OpenCode discovery coordination", () => {
  test("applies only the latest deferred result and rejects a changed project identity", async () => {
    let resolveFirst!: (value: DiscoveryState) => void;
    let resolveSecond!: (value: DiscoveryState) => void;
    const first = new Promise<DiscoveryState>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<DiscoveryState>((resolve) => { resolveSecond = resolve; });
    const applied: string[] = [];
    let active = { runtime: "opencode" as const, projectRoot: "/fixture-a" };
    let calls = 0;
    const coordinator = createOpenCodeDiscoveryCoordinator<DiscoveryState>({
      discover: () => calls++ === 0 ? first : second,
      getActiveIdentity: () => active,
      loadingState: { kind: "loading" },
    });
    const apply = (state: DiscoveryState) => applied.push(state.kind);

    const firstRequest = coordinator.start({ runtime: "opencode", projectRoot: "/fixture-a", mode: "prefer-cache" }, apply);
    const secondRequest = coordinator.start({ runtime: "opencode", projectRoot: "/fixture-a", mode: "rescan" }, apply);
    resolveSecond({ kind: "empty" });
    await expect(secondRequest).resolves.toBe(true);
    resolveFirst({ kind: "blocked" });
    await expect(firstRequest).resolves.toBe(false);
    expect(applied).toEqual(["loading", "loading", "empty"]);

    active = { runtime: "opencode", projectRoot: "/fixture-b" };
    const projectRequest = coordinator.start({ runtime: "opencode", projectRoot: "/fixture-a", mode: "rescan" }, apply);
    await expect(projectRequest).resolves.toBe(false);
    expect(applied).toEqual(["loading", "loading", "empty", "loading"]);
  });

  test("rejects an older completion that resolves before the latest request", async () => {
    let resolveFirst!: (value: DiscoveryState) => void;
    let resolveSecond!: (value: DiscoveryState) => void;
    const first = new Promise<DiscoveryState>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<DiscoveryState>((resolve) => { resolveSecond = resolve; });
    const applied: string[] = [];
    let calls = 0;
    const coordinator = createOpenCodeDiscoveryCoordinator<DiscoveryState>({
      discover: () => calls++ === 0 ? first : second,
      getActiveIdentity: () => ({ runtime: "opencode" as const, projectRoot: "/fixture" }),
      loadingState: { kind: "loading" },
    });
    const apply = (state: DiscoveryState) => applied.push(state.kind);

    const firstRequest = coordinator.start({ runtime: "opencode", projectRoot: "/fixture", mode: "prefer-cache" }, apply);
    const secondRequest = coordinator.start({ runtime: "opencode", projectRoot: "/fixture", mode: "rescan" }, apply);
    resolveFirst({ kind: "blocked" });
    await expect(firstRequest).resolves.toBe(false);
    resolveSecond({ kind: "empty" });
    await expect(secondRequest).resolves.toBe(true);
    expect(applied).toEqual(["loading", "loading", "empty"]);
  });

  test("keeps successful empty discovery actionable through Retry and Back", () => {
    expect(getOpenCodeDiscoveryAction({ kind: "loading" }, 0)).toBe("wait");
    expect(getOpenCodeDiscoveryAction({ kind: "empty" }, 0)).toBe("retry");
    expect(getOpenCodeDiscoveryAction({ kind: "empty" }, 1)).toBe("back");
  });
});
