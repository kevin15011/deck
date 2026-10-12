import { expect, test } from "bun:test";
import * as host from "../index";

test("public surface used by the CLI composition is exported", () => {
  for (const name of [
    "runChildAnchor", "runSessionMcpBridge", "runSessionDaemon", "startDaemon", "ensureDaemon", "spawnDetachedDaemon", "EventLog", "Ledger",
    "loadLedger", "Supervisor", "ApprovalBroker", "ControlServer", "ControlClient", "recoverAllSessions", "resolveStatePaths", "sessionMcpServerSpec", "SessionManager", "createDriverSpawn",
  ]) expect(typeof (host as Record<string, unknown>)[name]).toBe("function");
});

test("test-only stubs are not part of the public surface", () => {
  expect(Object.keys(host).some((k) => /stub|fake/i.test(k))).toBe(false);
});
