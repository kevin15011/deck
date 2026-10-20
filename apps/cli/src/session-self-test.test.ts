import { describe, expect, test } from "bun:test";
import { SESSION_COMMAND_SCHEMA, SESSION_EVENT_SCHEMA, SESSION_SCHEMA_DIGEST } from "@deck/core/session/schema.generated";
import { computeSchemaDigest, formatSelfTest, runSessionSelfTest } from "./session-self-test";
import { createHash } from 'node:crypto';

describe("deck session self-test (XR-10.3)", () => {
  test("passes on the embedded schemas and reports the build version", () => {
    const report = runSessionSelfTest({ env: { HOME: "/home/u", XDG_STATE_HOME: "/home/u/state" } });
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual(["web-assets-digest", "web-assets-complete", "schema-digest-manifest", "schema-matches-validators", "validators-accept-samples", "state-dir-resolvable"]);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.version).toMatch(/\d/);
  });

  test("the digest formula matches the generator's embedded digest", () => {
    expect(computeSchemaDigest(SESSION_EVENT_SCHEMA, SESSION_COMMAND_SCHEMA)).toBe(SESSION_SCHEMA_DIGEST);
  });

  test("a tampered manifest digest is detected", () => {
    const report = runSessionSelfTest({ schemas: { event: SESSION_EVENT_SCHEMA, command: SESSION_COMMAND_SCHEMA, digest: "0".repeat(64) }, env: { HOME: "/h" } });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "schema-digest-manifest")).toMatchObject({ ok: false });
  });

  test("a tampered embedded schema (digest recomputed to hide it) no longer matches the validators", () => {
    const tampered = { ...SESSION_EVENT_SCHEMA, $id: "deck-session-event-v9" };
    const report = runSessionSelfTest({ schemas: { event: tampered, command: SESSION_COMMAND_SCHEMA, digest: computeSchemaDigest(tampered, SESSION_COMMAND_SCHEMA) }, env: { HOME: "/h" } });
    expect(report.checks.find((c) => c.id === "schema-digest-manifest")!.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "schema-matches-validators")).toMatchObject({ ok: false });
    expect(report.ok).toBe(false);
  });

  test("an unresolvable state directory fails the self-test instead of throwing", () => {
    const report = runSessionSelfTest({ env: { HOME: "relative", XDG_STATE_HOME: "relative" } });
    expect(report.checks.find((c) => c.id === "state-dir-resolvable")).toMatchObject({ ok: false });
  });

  test("formatSelfTest prints one line per check and a verdict", () => {
    const text = formatSelfTest(runSessionSelfTest({ env: { HOME: "/home/u" } }));
    expect(text).toContain("schema-digest-manifest");
    expect(text.trim().split("\n").at(-1)).toMatch(/self-test passed/i);
  });
});

test('binary web assets use canonical byte-array digest normalization and still detect tampering',()=>{
 const assets={'/index.html':{body:'<html></html>',contentType:'text/html'},'/app.js':{body:'export{}',contentType:'text/javascript'},'/app.css':{body:'body{}',contentType:'text/css'},'/icon.png':{body:new Uint8Array([137,80,78,71]),contentType:'image/png'}};
 const digest=createHash('sha256').update(JSON.stringify(Object.keys(assets).sort().map(path=>{const a=assets[path as keyof typeof assets];return[path,a.contentType,typeof a.body==='string'?a.body:Array.from(a.body)];}))).digest('hex');
 expect(runSessionSelfTest({web:{assets,digest},env:{HOME:'/h'}}).ok).toBe(true);
 assets['/icon.png'].body[3]=0;
 expect(runSessionSelfTest({web:{assets,digest},env:{HOME:'/h'}}).checks.find(c=>c.id==='web-assets-digest')?.ok).toBe(false);
});

 test("tampered web assets fail self-test", () => {
  const report=runSessionSelfTest({web:{assets:{"/index.html":{body:"tampered",contentType:"text/html"}},digest:"0".repeat(64)},env:{HOME:"/h"}});
  expect(report.ok).toBe(false);
  expect(report.checks.find(c=>c.id==="web-assets-digest")?.ok).toBe(false);
 });
