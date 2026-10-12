import { describe, expect, test } from "bun:test";
import { IdleMonitor, IDLE_SHUTDOWN_MS } from "../idle-monitor";
import { FakeClock } from "./test-helpers";

function make(over: { busy?: () => boolean; clients?: () => number; idleMs?: number } = {}) {
  const clock = new FakeClock();
  let fired = 0;
  const monitor = new IdleMonitor({ clock, idleMs: over.idleMs, pollMs: 10_000, isBusy: over.busy ?? (() => false), clientCount: over.clients ?? (() => 0), onIdle: () => { fired++; } });
  monitor.start();
  return { clock, monitor, fired: () => fired };
}

describe("idle shutdown (XR-3.1)", () => {
  test("defaults to 30 minutes", () => { expect(IDLE_SHUTDOWN_MS).toBe(30 * 60 * 1000); });

  test("fires after the idle period with no work and no clients", () => {
    const { clock, fired } = make();
    clock.advance(IDLE_SHUTDOWN_MS - 10_000);
    expect(fired()).toBe(0);
    clock.advance(20_000);
    expect(fired()).toBe(1);
  });

  test("an attached client keeps it alive; the idle window restarts when it leaves", () => {
    let clients = 1;
    const { clock, fired } = make({ clients: () => clients });
    clock.advance(IDLE_SHUTDOWN_MS * 2);
    expect(fired()).toBe(0);
    clients = 0;
    clock.advance(IDLE_SHUTDOWN_MS - 10_000);
    expect(fired()).toBe(0);
    clock.advance(20_000);
    expect(fired()).toBe(1);
  });

  test("running work keeps it alive, and finishing starts a fresh window", () => {
    let busy = true;
    const { clock, fired } = make({ busy: () => busy });
    clock.advance(IDLE_SHUTDOWN_MS * 3);
    expect(fired()).toBe(0);
    busy = false;
    clock.advance(IDLE_SHUTDOWN_MS - 10_000);
    expect(fired()).toBe(0);
    clock.advance(20_000);
    expect(fired()).toBe(1);
  });

  test("activity inside the window resets it", () => {
    let clients = 0;
    const { clock, fired } = make({ clients: () => clients, idleMs: 60_000 });
    clock.advance(50_000);
    clients = 1;
    clock.advance(10_000);
    clients = 0;
    clock.advance(50_000);
    expect(fired()).toBe(0);
    clock.advance(20_000);
    expect(fired()).toBe(1);
  });

  test("fires once and stop() cancels polling", () => {
    const { clock, monitor, fired } = make({ idleMs: 20_000 });
    clock.advance(100_000);
    expect(fired()).toBe(1);
    monitor.stop();
    expect(clock.pending).toBe(0);
  });
});
