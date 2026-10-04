import { expect, test } from "bun:test";
import { BackgroundJobs } from "./jobs";
import { parseAgentMarkdown } from "./agents";
import { validateClarification } from "./clarification";

const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply");
test("clarifications are bounded text, not control payloads", () => {
  for (const message of [undefined, {}, "", " \n", "x".repeat(4001), "bad\u0000text"]) expect(() => validateClarification(message)).toThrow();
  expect(() => validateClarification("x".repeat(4000))).not.toThrow();
});
test("controller rejects foreign, queued, terminal, cancelling and stale attempt delivery without spawning", async () => {
  const requests: any[] = [], finishes: (() => void)[] = [];
  const jobs = new BackgroundJobs({ run: request => new Promise<any>(resolve => { requests.push(request); finishes.push(() => resolve({ failed: false, text: "done" })); request.signal?.addEventListener("abort", finishes.at(-1)!); }), killAll() {} }, {
    persist() {}, notify() {}, changed() {}, childFile: id => `/private/${id}.jsonl`, validateChild() {},
  });
  jobs.open("parent", []);
  const ids = jobs.accept("parallel", Array.from({ length: 5 }, () => ({ agent, task: "work", cwd: "/tmp" })));
  await Bun.sleep(0);
  try {
    await expect(jobs.clarify("foreign", "hi")).rejects.toThrow("Unknown task");
    await expect(jobs.clarify(ids[4]!, "hi")).rejects.toThrow("running child");
    await expect(jobs.clarify(ids[0]!, "hi")).rejects.toThrow("not ready");
    let deliveries = 0;
    requests[0].onClarifyReady(async () => { deliveries++; return { delivery: "accepted", clarificationId: "receipt" }; });
    expect(await jobs.clarify(ids[0]!, "clarify")).toMatchObject({ delivery: "accepted" });
    expect(deliveries).toBe(1);
    let acknowledge: (r: any) => void = () => {};
    requests[0].onClarifyReady(() => new Promise(resolve => { acknowledge = resolve; }));
    const inflight = jobs.clarify(ids[0]!, "late");
    const cancellation = jobs.cancel(ids[0]!);
    await expect(jobs.clarify(ids[0]!, "cancelled")).rejects.toThrow("running child");
    acknowledge({ delivery: "accepted", clarificationId: "late" });
    await expect(inflight).rejects.toThrow("settled or changed");
    await cancellation;
    jobs.resume(ids[0]!, agent);
    finishes[1]!(); await Bun.sleep(0);
    // Attempt 1 cannot restore a callback into attempt 2.
    requests[0].onClarifyReady(async () => { throw new Error("stale callback used"); });
    await expect(jobs.clarify(ids[0]!, "new attempt")).rejects.toThrow("not ready");
    expect(requests.at(-1).attempt).toBe(2);
    await expect(jobs.clarify(ids[1]!, "terminal")).rejects.toThrow("running child");
    await jobs.close(); jobs.open("other-parent", []);
    await expect(jobs.clarify(ids[0]!, "foreign parent")).rejects.toThrow("Unknown task");
  } finally { await jobs.close(); }
});
