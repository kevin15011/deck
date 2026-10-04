import { expect, test } from "bun:test";
import { BackgroundJobs } from "./jobs";
import { parseAgentMarkdown } from "./agents";

const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply");
const result = (text = "done", failed = false) => ({ text, failed, errorMessage: failed ? "failed" : undefined });
function setup() {
  const pending: Array<{ request: any; finish: (r: any) => void }> = [];
  const messages: string[] = [];
  const saved: any[] = [];
  const jobs = new BackgroundJobs({ run: (request: any) => new Promise<any>(finish => { pending.push({ request, finish }); request.signal.addEventListener("abort", () => finish(result("", true))); }), killAll() {} }, {
    persist: data => saved.push(structuredClone(data)), notify: message => { messages.push(message); }, changed() {},
    childFile: id => `/private/${id}.jsonl`, validateChild() {},
  });
  jobs.open("parent-a", []);
  return { jobs, pending, messages, saved };
}
const item = (task = "work") => ({ agent, task, cwd: "/tmp" });
test("acceptance is immediate; session-wide four slots across parallel/single/chain", async () => {
  const { jobs, pending } = setup();
  const ids = jobs.accept("parallel", Array.from({ length: 8 }, () => item()));
  jobs.accept("single", [item()]);
  const chain = jobs.accept("chain", [item("first"), item("review {previous}")]);
  await Bun.sleep(0);
  expect(ids).toHaveLength(8);
  expect(pending).toHaveLength(4);
  for (let i = 0; i < 10; i++) { pending[i]!.finish(result(`output${i}`)); await Bun.sleep(0); }
  expect(pending).toHaveLength(11);
  expect(pending[10]!.request.task).toBe("review output9");
  pending[10]!.finish(result());
  await jobs.settled();
  expect(jobs.records.every(j => j.state === "completed")).toBe(true);
});
test("actual events bounded, reports distinct, completion not per-tool notifications", async () => {
  const { jobs, pending, messages } = setup();
  jobs.accept("single", [item()]);
  await Bun.sleep(0);
  for (let i = 0; i < 100; i++) pending[0]!.request.onActivity({ kind: "tool", text: "read started" });
  pending[0]!.request.onActivity({ kind: "report", text: "important finding" });
  expect(jobs.records[0]!.activity).toHaveLength(24);
  expect(messages).toHaveLength(0);
  pending[0]!.finish(result("verified report")); await jobs.settled();
  expect(messages).toHaveLength(1);
});
test("session switch settles and fences late callbacks; old records restore with no child auto-start", async () => {
  const { jobs, pending, messages, saved } = setup();
  jobs.accept("single", [item()]);
  await Bun.sleep(0);
  await jobs.close();
  const snapshot = saved.at(-1);
  jobs.open("parent-b", [snapshot]);
  pending[0]!.request.onActivity({ kind: "report", text: "late" });
  expect(jobs.records).toHaveLength(0); expect(messages).toHaveLength(0);
  jobs.open("parent-a", [snapshot]);
  expect(jobs.records[0]!.state).toBe("interrupted"); expect(pending).toHaveLength(1);
  jobs.resume(jobs.records[0]!.id, agent);
  await Bun.sleep(0);
  expect(pending[1]!.request.sessionFile).toBe(pending[0]!.request.sessionFile);
  expect(pending[1]!.request.task).toContain("Inspect previous effects");
  expect(() => jobs.resume(jobs.records[0]!.id, agent)).toThrow();
  await jobs.close();
});
test("cancel queued/running chain does not launch dependents; failure skips later steps", async () => {
  const { jobs, pending } = setup();
  const ids = jobs.accept("chain", [item(), item()]);
  await Bun.sleep(0);
  jobs.cancel(ids[0]!); await jobs.settled();
  expect(pending).toHaveLength(1); expect(jobs.records[1]!.state).toBe("cancelled");
});
test("session-wide record limit rejects overflow instead of growing storage without bound", async () => {
  const { jobs, pending } = setup();
  for (let n = 0; n < 4; n++) jobs.accept("parallel", Array.from({ length: 8 }, () => item()));
  expect(() => jobs.accept("single", [item()])).toThrow("limit");
  await Bun.sleep(0); expect(pending).toHaveLength(4); await jobs.close();
});
test("never-started chain successor resolves predecessor output on explicit continuation", async () => {
  const { jobs, pending, saved } = setup();
  const ids = jobs.accept("chain", [item("first"), item("review {previous}")]);
  await Bun.sleep(0); await jobs.close(); jobs.open("parent-a", [saved.at(-1)]);
  jobs.resume(ids[0]!, agent); await Bun.sleep(0);
  pending[1]!.finish(result("recovered evidence")); await jobs.settled();
  jobs.resume(ids[1]!, agent); await Bun.sleep(0);
  expect(pending[2]!.request.task).toBe("review recovered evidence");
  pending[2]!.finish(result()); await jobs.settled();
});
test("progress remains inspectable without chat delivery, including the final assistant report", async () => {
  const { jobs, pending, messages } = setup();
  jobs.accept("single", [item()]); await Bun.sleep(0);
  for (const text of ["first finding", "superseded finding", "latest important finding", "terminal result"]) pending[0]!.request.onActivity({ kind: "report", text });
  expect(messages).toHaveLength(0);
  expect(jobs.records[0]!.activity.at(-1)?.text).toBe("terminal result");
  pending[0]!.finish(result("terminal result")); await jobs.settled();
  expect(messages).toHaveLength(1); expect(messages[0]).not.toContain("terminal result");
  expect(jobs.records[0]!.output).toBe("terminal result");
  await jobs.close();
});
test("untrusted records cannot supply execution policy/path or change parent identity", () => {
  const { jobs } = setup();
  jobs.open("parent-a", [{ parent: "parent-a", jobs: [{ id: "../../escape", state: "interrupted", agent: "deck-apply-fast" }] }]);
  expect(jobs.records).toHaveLength(0);
});
