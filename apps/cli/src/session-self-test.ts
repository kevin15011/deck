/**
 * `deck session self-test` (XR-10.3): verifies the embedded session contract assets without
 * network or repository access, including the desktop web assets.
 */
import { createHash } from "node:crypto";
import { resolveStatePaths } from "@deck/session-host";
import { validateSessionCommand } from "@deck/core/session/commands";
import { validateSessionEvent } from "@deck/core/session/events";
import { buildSessionSchemas } from "@deck/core/session/schema";
import { SESSION_COMMAND_SCHEMA, SESSION_EVENT_SCHEMA, SESSION_SCHEMA_DIGEST } from "@deck/core/session/schema.generated";
import { WEB_ASSETS, WEB_ASSETS_DIGEST } from "./runtime/web-assets.generated";
import { getBuildInfo } from "./runtime/build-info";

export type SelfTestCheck = { id: string; ok: boolean; detail?: string };
export type SelfTestReport = { ok: boolean; version: string; target: string; checks: SelfTestCheck[] };
export type SelfTestOptions = {
  web?: { assets: Readonly<Record<string, {body:string|Uint8Array;contentType:string}>>; digest:string };
  schemas?: { event: unknown; command: unknown; digest: string };
  env?: Readonly<Record<string, string | undefined>>;
};

/** Same formula as `scripts/generate-session-schemas.ts`. */
export function computeSchemaDigest(event: unknown, command: unknown): string {
  return createHash("sha256").update(JSON.stringify(event, null, 2)).update("\n").update(JSON.stringify(command, null, 2)).digest("hex");
}

const SAMPLE_EVENT = { v: 1, sessionId: "self-test", seq: 1, ts: "2026-01-01T00:00:00.000Z", kind: "session.created", source: {}, data: {} };
const SAMPLE_COMMAND = { v: 1, commandId: "00000000-0000-4000-8000-000000000000", type: "session.stop" };

export function runSessionSelfTest(options: SelfTestOptions = {}): SelfTestReport {
  const schemas = options.schemas ?? { event: SESSION_EVENT_SCHEMA, command: SESSION_COMMAND_SCHEMA, digest: SESSION_SCHEMA_DIGEST };
  const checks: SelfTestCheck[] = [];
  const web = options.web ?? {assets: WEB_ASSETS, digest: WEB_ASSETS_DIGEST};
  const webDigest = createHash("sha256").update(JSON.stringify(Object.keys(web.assets).sort().map(path => { const asset=web.assets[path]!;return [path,asset.contentType,typeof asset.body==='string'?asset.body:Array.from(asset.body)]; }))).digest("hex");
  checks.push({id: "web-assets-digest", ok: webDigest === web.digest, detail: webDigest === web.digest ? web.digest.slice(0,12) : "embedded web assets do not match their manifest digest"});
  checks.push({id: "web-assets-complete", ok: ["/index.html", "/app.js", "/app.css"].every(path => Boolean(web.assets[path]?.body))});

  const embedded = computeSchemaDigest(schemas.event, schemas.command);
  checks.push({
    id: "schema-digest-manifest", ok: embedded === schemas.digest,
    detail: embedded === schemas.digest ? schemas.digest.slice(0, 12) : "embedded schemas do not match their manifest digest",
  });

  const built = buildSessionSchemas();
  const fresh = computeSchemaDigest(built.event, built.command);
  checks.push({
    id: "schema-matches-validators", ok: fresh === embedded,
    detail: fresh === embedded ? undefined : "embedded schemas differ from the schemas derived from the validators in this build",
  });

  const samplesOk = validateSessionEvent(SAMPLE_EVENT).ok && validateSessionCommand(SAMPLE_COMMAND).ok
    && !validateSessionEvent({ ...SAMPLE_EVENT, kind: "nope" }).ok && !validateSessionCommand({ ...SAMPLE_COMMAND, commandId: "x" }).ok;
  checks.push({ id: "validators-accept-samples", ok: samplesOk, detail: samplesOk ? undefined : "validators rejected a valid sample or accepted an invalid one" });

  try {
    const paths = resolveStatePaths({ env: options.env ?? process.env });
    checks.push({ id: "state-dir-resolvable", ok: true, detail: paths.root });
  } catch (error) {
    checks.push({ id: "state-dir-resolvable", ok: false, detail: (error as Error).message });
  }

  const info = getBuildInfo();
  return { ok: checks.every((c) => c.ok), version: info.version, target: info.target, checks };
}

export function formatSelfTest(report: SelfTestReport): string {
  const lines = [`deck ${report.version} (${report.target}) session self-test`];
  for (const c of report.checks) lines.push(`${c.ok ? "ok  " : "FAIL"} ${c.id}${c.detail ? `  ${c.detail}` : ""}`);
  lines.push(report.ok ? "self-test passed" : "self-test FAILED");
  return `${lines.join("\n")}\n`;
}
