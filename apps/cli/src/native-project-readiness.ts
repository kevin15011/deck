import { preparationCapabilities } from "./preparation-capabilities";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCodebaseMemoryEnabled, type NormalizedDeckConfig, type RunnerLaunchPlan } from "@deck/core";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { ProjectPreparationService } from "../../../packages/sdd-runtime/src/execution/project-preparation";
import { composeSkillSessionStartContext } from "../../../packages/sdd-runtime/src/execution/session-start-context";

/** A launch owns the coordinator until all native children have exited. The transport
 * only returns observations for the fixed root/runner; it cannot grant repair authority. */
export async function startNativeProjectReadiness(input: {
  projectRoot: string; runnerId: string; generation: string;
  config(): NormalizedDeckConfig;
  validateGeneration?(): void;
  onProjectRead?(path: string): void;
  prerequisites?(config: NormalizedDeckConfig): import("@deck/core/session/preparation").PreparationMember["capabilities"];
  registryProviders?: () => readonly import("@deck/core").SkillDiscoverySourceProviderV1[];
  codebaseAvailability?(): "ready" | "unavailable" | "unverified";
  nativeSessionStartContext?: RunnerLaunchPlan["nativeSessionStartContext"];
}) {
  const root = realpathSync(input.projectRoot), epoch = randomUUID(), sessionId = randomUUID();
  const service = new ProjectPreparationService({ onProjectRead: input.onProjectRead, registryProviders: input.registryProviders });
  const snapshot = async () => {
    input.validateGeneration?.();
    const config = input.config();
    const capabilities = { ...preparationCapabilities(config, input.runnerId), ...input.prerequisites?.(config), "codebase-memory": { enabled: isCodebaseMemoryEnabled(config, input.runnerId), availability: isCodebaseMemoryEnabled(config, input.runnerId) ? input.codebaseAvailability?.() ?? "unverified" as const : "unverified" as const } };
    const scope = { projectRoot: root, sessionId, epoch,
      policyDigest: createHash("sha256").update(JSON.stringify([input.generation, capabilities])).digest("hex"),
      members: DEVELOPER_TEAM_AGENTS.map(role => ({ memberId: role.id, runnerId: input.runnerId, bindingId: `${role.id}@${input.runnerId}`, capabilities })),
    };
    await service.prepareRegistryEvidence(scope, input.runnerId);
    input.validateGeneration?.();
    const preparation = service.status(scope);
    return { root, epoch, generation: input.generation, preparation, text: composeSkillSessionStartContext(preparation, input.runnerId) };
  };
  const initial = await snapshot(), token = randomUUID();
  const server = createServer(async (request, response) => {
    // Caller-supplied role, roster, root, and component data are never used.
    if (request.method !== "POST" || !["/readiness", "/codex-root"].includes(request.url ?? "") || request.headers.authorization !== `Bearer ${token}` || request.headers["transfer-encoding"] || Number(request.headers["content-length"] ?? 0) !== 0) {
      response.writeHead(403).end(); return;
    }
    try {
      if (request.url === "/codex-root") {
        input.validateGeneration?.();
        const sessionId = request.headers["x-deck-native-session"], source = request.headers["x-deck-native-source"];
        const rootContext = input.runnerId === "codex" && typeof sessionId === "string" && typeof source === "string"
          ? input.nativeSessionStartContext?.({ sessionId, source }) : undefined;
        response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }).end(rootContext ?? ""); return;
      }
      const body = JSON.stringify(await snapshot());
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(body);
    }
    catch { response.writeHead(503).end(); }
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  let directory: string | undefined;
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("native-readiness-address-unavailable");
    directory = mkdtempSync(join(tmpdir(), "deck-native-readiness-"));
    const path = join(directory, "context.json");
    const raw = JSON.stringify({ ...initial, refresh: { endpoint: `http://127.0.0.1:${address.port}/readiness`, token } });
    writeFileSync(path, raw, { mode: 0o600, flag: "wx" });
    return {
      environment: { DECK_SESSION_START_CONTEXT: path, DECK_SESSION_START_DIGEST: createHash("sha256").update(raw).digest("hex"), DECK_SESSION_START_EPOCH: epoch, DECK_SESSION_START_GENERATION: input.generation },
      close() { server.closeAllConnections(); server.close(); if (directory) rmSync(directory, { recursive: true, force: true }); },
    };
  } catch (error) { server.close(); if (directory) rmSync(directory, { recursive: true, force: true }); throw error; }
}

/** Attach after runner verification. Lifecycle references are cleared before publication. */
export function withNativeProjectReadiness(plan: RunnerLaunchPlan, runnerId: string, config: () => NormalizedDeckConfig, codebaseAvailability?: () => "ready" | "unavailable" | "unverified", prerequisites?: import("@deck/core").RunnerAdapter["readPreparationCapabilities"], readGeneration?: () => string): RunnerLaunchPlan {
  const previous = plan.launchLifecycle;
  let context: Awaited<ReturnType<typeof startNativeProjectReadiness>> | undefined;
  let generationRevoked = false;
  return { ...plan, launchLifecycle: {
    async beforeSpawn(environment, signal) {
      for (const key of Object.keys(environment)) if (key.startsWith("DECK_SESSION_START_")) delete environment[key];
      await previous?.beforeSpawn(environment, signal);
      signal?.throwIfAborted();
      try {
        const generation = readGeneration ? createHash("sha256").update(readGeneration()).digest("hex") : plan.generationReference?.selectionHash ?? randomUUID();
        const adapters = (await import("./runner-adapters")).createDefaultAdapterRegistry().list();
        context = await startNativeProjectReadiness({ registryProviders: () => adapters.flatMap(a => a.skillDiscovery ? [a.skillDiscovery] : []), projectRoot: plan.cwd, runnerId, config, codebaseAvailability, prerequisites,
          nativeSessionStartContext: runnerId === "codex" ? plan.nativeSessionStartContext : undefined, validateGeneration: () => {
          try { if (readGeneration && createHash("sha256").update(readGeneration()).digest("hex") !== generation) generationRevoked = true; }
          catch { generationRevoked = true; }
          const reference = plan.generationReference;
          try { if (reference && createHash("sha256").update(readFileSync(reference.selectionPath)).digest("hex") !== reference.selectionHash) generationRevoked = true; }
          catch { generationRevoked = true; }
          if (generationRevoked) throw new Error("native-generation-changed");
        }, generation });
        Object.assign(environment, context.environment);
      } catch {
        // Unavailable read-only evidence cannot disable ordinary roles. Verification
        // above is deliberately outside this catch and remains fail-closed.
        process.stderr.write("deck-preparation: native-snapshot-unavailable\n");
      }
    },
    afterExit() { try { context?.close(); } finally { previous?.afterExit(); } },
  } };
}
