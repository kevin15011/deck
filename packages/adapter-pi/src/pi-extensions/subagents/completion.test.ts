import { expect, test } from "bun:test";
import { BackgroundJobs } from "./jobs";
import { parseAgentMarkdown } from "./agents";
const agent = parseAgentMarkdown("deck-investigate", "---\nname: deck-investigate\n---\nInvestigate");
function setup() {
  const saved: any[] = [], delivered: any[] = [], pending: any[] = [];
  const fault = { render: false, persist: false, notify: false, busy: false };
  const jobs = new BackgroundJobs({ run: request => new Promise<any>(finish => { pending.push({ request, finish }); request.signal?.addEventListener("abort", () => finish({ failed: true, text: "" })); }), killAll() {} }, {
    persist: s => { if (fault.persist) throw Error("storage unavailable"); saved.push(structuredClone(s)); },
    changed: () => { if (fault.render) throw Error("renderer unavailable"); },
    notify: (text, outcomes) => { if (fault.busy) return false; delivered.push({ text, outcomes }); if (fault.notify) throw Error("admission unavailable"); },
    childFile: () => "/tmp/child", validateChild() {},
  });
  jobs.open("parent", []);
  const accept = (count = 1) => jobs.accept(count > 1 ? "parallel" : "single", Array.from({ length: count }, () => ({ agent, task: "work", title: "Review source", cwd: "/tmp" })));
  return { jobs, saved, delivered, pending, fault, accept };
}
test("terminal evidence survives UI/storage failure; actual admission is separate from integration", async () => {
  const h = setup(); h.accept(); await Bun.sleep(0); h.fault.render = h.fault.persist = true;
  h.pending[0].finish({ text: "UNTRUSTED_EVIDENCE", failed: false }); await h.jobs.settled();
  const j = h.jobs.records[0]!;
  expect(j.state).toBe("completed"); expect(h.delivered).toHaveLength(1);
  expect(h.delivered[0].text).not.toContain("UNTRUSTED_EVIDENCE");
  expect(h.jobs.persistencePending).toBe(true);
  h.jobs.acknowledge([j.outcomeId!]);
  expect(j.admitted).toBe(true); expect(j.integration).toBe("pending");
  h.fault.persist = false; h.jobs.deliverPending(); expect(h.jobs.persistencePending).toBe(false);
  expect(() => h.jobs.resolve(j.id, j.outcomeId!, "integrated", "without review")).toThrow("Review");
  h.jobs.review(j.id); expect(j.integration).toBe("reviewing");
  expect(() => h.jobs.resolve(j.id, "obsolete", "integrated", "verified")).toThrow("outcome");
  h.jobs.resolve(j.id, j.outcomeId!, "integrated", "verified against source");
  h.jobs.deliverPending(Date.now() + 10000); expect(h.delivered).toHaveLength(1);
  expect(h.saved.at(-1).jobs[0].integrationNote).toBe("verified against source");
  await h.jobs.close();
});
test("burst results coalesce; progress never wakes Lead or leaks raw reports into notifications", async () => {
  const h = setup(); h.accept(3); await Bun.sleep(0);
  for (const p of h.pending) { for (let n = 0; n < 30; n++) p.request.onActivity({ kind: "report", text: "RAW_REPORT" }); }
  expect(h.delivered).toHaveLength(0);
  for (const p of h.pending) p.finish({ text: "FINAL_REPORT", failed: false });
  await h.jobs.settled(); expect(h.delivered).toHaveLength(1);
  expect(h.delivered[0].outcomes).toHaveLength(3);
  expect(h.delivered[0].text).not.toMatch(/RAW_REPORT|FINAL_REPORT/);
  await h.jobs.close();
});
test("retry is bounded and exact-session restore never adopts another parent's pending results", async () => {
  const h = setup(); h.fault.notify = true; h.accept(); await Bun.sleep(0);
  h.pending[0].finish({ text: "evidence", failed: false }); await h.jobs.settled();
  for (let n = 1; n < 10; n++) h.jobs.deliverPending(Date.now() + n * 10000);
  expect(h.delivered).toHaveLength(3); expect(h.jobs.records[0]!.deliveryBlocked).toBe(true);
  const snapshot = h.saved.at(-1); await h.jobs.close();
  h.jobs.open("other", [snapshot]); h.jobs.deliverPending(); expect(h.delivered).toHaveLength(3);
  h.jobs.open("parent", [snapshot]); h.jobs.deliverPending(); expect(h.delivered).toHaveLength(4);
  expect(h.pending).toHaveLength(1); await h.jobs.close();
});
test("unavailable/busy delivery consumes no retry budget; one follow-through reminder then visible pending work", async () => {
  const h = setup(); h.fault.busy = true; h.accept(); await Bun.sleep(0);
  h.pending[0].finish({ text: "evidence", failed: false }); await h.jobs.settled();
  for (let n = 1; n < 10; n++) h.jobs.deliverPending(Date.now() + n * 10000);
  expect(h.delivered).toHaveLength(0);
  h.fault.busy = false; h.jobs.deliverPending(); expect(h.delivered).toHaveLength(1);
  const j = h.jobs.records[0]!; h.jobs.acknowledge([j.outcomeId!]);
  for (let n = 1; n < 10; n++) h.jobs.deliverPending(Date.now() + n * 10000);
  expect(h.delivered).toHaveLength(2); expect(j.integration).toBe("pending"); expect(j.reminded).toBe(true);
  h.jobs.resolve(j.id, j.outcomeId!, "blocked", "Needs a product decision");
  h.jobs.deliverPending(Date.now() + 200000); expect(h.delivered).toHaveLength(2);
  h.jobs.review(j.id); h.jobs.resolve(j.id, j.outcomeId!, "integrated", "Decision received; evidence reviewed");
  expect(j.integration).toBe("integrated"); expect(h.pending).toHaveLength(1);
  await h.jobs.close();
});
test("explicit continuation fences old results and admission without replaying work", async () => {
  const h = setup(); h.accept(); await Bun.sleep(0);
  h.pending[0].finish({ text: "failure", errorMessage: "command timeout", failed: true }); await h.jobs.settled();
  const j = h.jobs.records[0]!, old = j.outcomeId!;
  h.jobs.resume(j.id, agent); await Bun.sleep(0);
  expect(j.attempt).toBe(2); expect(j.outcomeId).toBeUndefined(); expect(j.output).toBe("");
  h.jobs.acknowledge([old]); expect(j.admitted).not.toBe(true);
  h.pending[0].request.onActivity({ kind: "report", text: "OBSOLETE_ATTEMPT" });
  expect(j.activity.some(a => a.text === "OBSOLETE_ATTEMPT")).toBe(false);
  expect(() => h.jobs.resolve(j.id, old, "integrated", "stale result")).toThrow();
  h.pending[1].finish({ text: "recovered", failed: false }); await h.jobs.settled();
  expect(j.outcomeId).not.toBe(old); expect(h.delivered[1].outcomes[0].attempt).toBe(2);
  await h.jobs.close();
});
test("storage rejection before acceptance never leaves a ghost task eligible to run later", async () => {
  const h = setup(); h.fault.persist = true;
  expect(() => h.accept()).toThrow(); expect(h.jobs.records).toHaveLength(0);
  h.fault.persist = false; h.accept(); await Bun.sleep(0); expect(h.pending).toHaveLength(1);
  await h.jobs.close();
});
