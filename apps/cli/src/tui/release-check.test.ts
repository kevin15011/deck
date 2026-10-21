import { expect, test } from "bun:test";
import { runReleaseCheckWithTimeout } from "./release-check";

const offline = () => ({ kind: "network-error" as const, error: "local fixture" });

test("deadline cancels deferred work instead of starting it after returning", async () => {
  let calls = 0;
  const state = await runReleaseCheckWithTimeout(1, {
    delayMs: 30,
    fetchImpl: () => { calls++; return offline(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(state).toEqual({ kind: "network-error", error: "Release check timed out after 1ms" });
  expect(calls).toBe(0);
});

test("preabort prevents fetching and cancellation reaches an active transport", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  expect((await runReleaseCheckWithTimeout(5000, {
    signal: controller.signal,
    fetchImpl: () => { calls++; return offline(); },
  })).kind).toBe("network-error");
  expect(calls).toBe(0);

  let aborted = false;
  const state = await runReleaseCheckWithTimeout(10, {
    fetchImpl: (signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve(offline()); }, { once: true });
    }),
  });
  expect(aborted).toBe(true);
  expect(state).toEqual({ kind: "network-error", error: "Release check timed out after 10ms" });
});

test("external cancellation settles even an uncooperative async injection", async () => {
  const controller = new AbortController();
  const check = runReleaseCheckWithTimeout(5000, {
    signal: controller.signal,
    fetchImpl: () => new Promise(() => {}),
  });
  controller.abort();
  expect(await check).toEqual({ kind: "network-error", error: "Release check cancelled" });
});
