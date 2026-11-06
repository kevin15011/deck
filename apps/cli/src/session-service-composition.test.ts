import { expect, test } from "bun:test";
import { resolveStatePaths, type DaemonServices } from "@deck/session-host";
import { createCrossSessionService } from "./session-service";

test("session composition supplies its state root to project preparation", async () => {
  // Protects production backup placement; oracle: the daemon's resolved state root.
  const paths = resolveStatePaths({ env: { HOME: "/private/tmp/deck-composition-test" } });
  const broker = { setGrantProvider() {}, setSessionKeyProvider() {} };
  const services = { paths, broker, logger: { error() {}, warn() {} }, supervisor: {} } as unknown as DaemonServices;
  const manager = createCrossSessionService(services, { adapters: () => [], configStore: { read: () => ({}) } as never });
  const composed = manager as unknown as { options: { projectPreparation: { options: { stateRoot: string } } } };
  expect(composed.options.projectPreparation.options.stateRoot).toBe(paths.root);
  await manager.close();
});
