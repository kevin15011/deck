// Invoked in an isolated subprocess by release-check-transport.test.ts; never contacts GitHub.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchReleaseDescriptor, fetchReleaseDescriptorAsync } from "../../github-release";
import { runReleaseCheckWithTimeout } from "../../../tui/release-check";

const root = process.env.RELEASE_PROBE_ROOT!;
const mode = process.env.RELEASE_PROBE_MODE!;
const descriptor = { schemaVersion: 1, version: "99.0.0", tag_name: "v99.0.0", channel: "stable", published_at: "2026-01-01T00:00:00.000Z", items: [] };
if (process.argv[2] === "curl") {
  const api = process.argv.some((arg) => arg.includes("api.github.com"));
  appendFileSync(join(root, "children.jsonl"), JSON.stringify({ pid: process.pid, api }) + "\n");
  if ((mode === "hold" || mode === "cancel") || (mode === "asset-abort" && !api)) {
    setInterval(() => {}, 1000);
  } else if (mode === "api-error" && api) {
    process.stdout.write("forbidden\n403");
  } else if (api) {
    process.stdout.write(JSON.stringify({ tag_name: "v99.0.0", target_commitish: "abcdef1234567", assets: mode === "missing" ? [] : [{ name: "release.json", browser_download_url: "unused" }] }) + "\n200");
  } else {
    process.stdout.write(mode === "invalid" ? "{}" : mode === "mismatch" ? JSON.stringify({ ...descriptor, version: "98.0.0" }) : JSON.stringify(descriptor));
  }
} else {
  const quoted = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "curl"), `#!/bin/sh\nexec ${quoted(process.execPath)} ${quoted(import.meta.path)} curl "$@"\n`, { mode: 0o700 });
  process.env.PATH = join(root, "bin") + ":" + process.env.PATH;
  delete process.env.DECK_RELEASE_CHECK_FIXTURE;
  const cachePath = join(root, "cache.json");
  let beats = 0;
  const heartbeat = setInterval(() => { beats++; }, 25);
  const controller = new AbortController();
  const started = performance.now();
  let cancelTimer: ReturnType<typeof setInterval> | undefined;
  if (mode === "preabort") controller.abort();
  if (mode === "cancel" || mode === "asset-abort") {
    // Cancel at an observed transport boundary, not a guessed startup delay.
    cancelTimer = setInterval(() => {
      try {
        const calls = readFileSync(join(root, "children.jsonl"), "utf8");
        if (mode === "cancel" || calls.includes('"api":false')) controller.abort();
      } catch { /* Wait for the controlled child to start. */ }
    }, 10);
  }
  const state = mode === "sync"
    ? fetchReleaseDescriptor({ cachePath })
    : mode === "hold" || mode === "cancel" || mode === "preabort"
      ? await runReleaseCheckWithTimeout(undefined, { signal: controller.signal, currentVersion: () => "1.0.0" })
      : await fetchReleaseDescriptorAsync({ signal: controller.signal, cachePath, etag: "local-etag" }).catch(() => ({ kind: "cancelled" }));
  clearInterval(heartbeat);
  if (cancelTimer) clearInterval(cancelTimer);
  writeFileSync(join(root, "result.json"), JSON.stringify({ state, beats, elapsedMs: performance.now() - started }));
}
