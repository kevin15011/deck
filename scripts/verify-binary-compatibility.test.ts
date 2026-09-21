import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyCurrentSource, downloadOfficial, isolatedEnvironment, nativeTarget, provisionNode, runCompatibility, runProcess, sha256, verifyArchive, NODE_HOOK_FIXTURE, type Command } from "./verify-binary-compatibility";

const roots: string[] = [];
const temp = () => { const root = mkdtempSync(join(tmpdir(), "deck-compat-test-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const put = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const identity = { version: "0.4.0", commit: "a".repeat(40), channel: "dev", target: `${process.platform}-${process.arch}` };
const versionOutput = () => `deck ${identity.version}\ncommit: ${identity.commit}\ndate: 2026-09-20\ntarget: ${identity.target}\nchannel: dev\n`;
function candidate(root: string) {
  const archive = join(root, "candidate.tar.gz");
  put(archive, "archive fixture");
  const checksums = join(root, "checksums.txt");
  put(checksums, `${sha256(archive)}  candidate.tar.gz\n`);
  const hook = join(root, "hook.generated.js");
  put(hook, "export const forwardCodexTrustedHook = () => {};");
  return { archive, checksums, hook, node: "/fixture/node", major: 20, ...identity };
}
function fakeRunner(calls: Command[], mutate?: (command: Command, output: string) => string) {
  return async (command: Command) => {
    calls.push(command);
    const args = command.argv;
    let output = "";
    if (args[0] === "/usr/bin/uname") output = process.arch === "arm64" ? "aarch64\n" : "x86_64\n";
    else if (args[0] === "/usr/sbin/sysctl") output = process.arch === "arm64" ? "1\n" : "0\n";
    else if (args.includes("-tzf")) output = "deck\n";
    else if (args.includes("-tvzf")) output = "-rwxr-xr-x owner/group 12 date deck\n";
    else if (args.includes("-xzf")) put(join(args[args.indexOf("-C") + 1], "deck"), "binary");
    else if (args.includes("version")) output = versionOutput();
    else if (args.includes("--version")) output = "v20.20.0\n";
    else if (args.some(arg => arg.endsWith("node-hook-fixture.mjs"))) output = JSON.stringify({ ok: true, node: "v20.20.0", platform: process.platform, arch: process.arch, checks: ["capture", "recall", "denial", "invalid-input"] });
    return mutate ? mutate(command, output) : output;
  };
}

describe("binary compatibility contract", () => {
  test("Darwin build removes the inherited signature, signs and verifies before packaging; Linux is unchanged", async () => {
    const { signDarwinCandidate } = await import("./verify-binary-compatibility");
    const calls: { operation: string; argv: string[] }[] = [];
    const run = async (operation: string, argv: string[]) => { calls.push({ operation, argv }); return ""; };
    await signDarwinCandidate("linux-arm64", "/owned/deck", run);
    expect(calls).toHaveLength(0);
    for (const target of ["darwin-x64", "darwin-arm64"]) {
      calls.length = 0;
      await signDarwinCandidate(target, "/owned/deck", run);
      expect(calls.map(call => call.argv)).toEqual([
        ["/usr/bin/codesign", "--remove-signature", "/owned/deck"],
        ["/usr/bin/codesign", "--force", "--sign", "-", "/owned/deck"],
        ["/usr/bin/codesign", "--verify", "--strict", "/owned/deck"],
      ]);
    }
  });
  for (const failureAt of [0, 1, 2]) test(`Darwin signing failure at step ${failureAt} aborts the build`, async () => {
    const { signDarwinCandidate } = await import("./verify-binary-compatibility");
    let calls = 0;
    await expect(signDarwinCandidate("darwin-arm64", "/owned/deck", async () => {
      if (calls++ === failureAt) throw new Error("signing failed");
      return "";
    })).rejects.toThrow("signing failed");
    expect(calls).toBe(failureAt + 1);
  });
  test("rejects unsupported and non-native targets", () => {
    expect(nativeTarget()).toBe(identity.target);
    expect(() => nativeTarget("win32", "x64")).toThrow("Unsupported");
  });
  test("environment is allowlisted, with owned home and caches, not inherited credentials", () => {
    const root = temp();
    const env = isolatedEnvironment(root, "");
    expect(env.PATH).toBe("");
    for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "TMPDIR", "npm_config_cache", "BUN_INSTALL_CACHE_DIR"]) {
      expect(env[name].startsWith(root + "/")).toBe(true);
      expect(existsSync(env[name])).toBe(true);
    }
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(env).not.toHaveProperty("SUPERMEMORY_API_KEY");
  });
  test("copies modified and eligible untracked content, not links, secrets, caches or outputs", async () => {
    const root = temp(), source = join(root, "source"), dest = join(root, "copy");
    for (const name of ["package.json", "apps/cli/src/changed.ts", "packages/new.ts", ".env", ".github/workflows/release.yml", "apps/.env.test", "packages/token.pem", "packages/node_modules/x.ts", "dist/x.ts", ".git/config", "packages/secrets.json", "packages/out/generated.ts", "packages/__pycache__/module.pyc"]) put(join(source, name), name);
    symlinkSync(root, join(source, "packages/link"));
    await copyCurrentSource(source, dest, async () => ["package.json", "apps/cli/src/changed.ts", "packages/new.ts", ".env", ".github/workflows/release.yml", "apps/.env.test", "packages/token.pem", "packages/node_modules/x.ts", "dist/x.ts", ".git/config", "packages/secrets.json", "packages/link/outside.ts", "packages/out/generated.ts", "packages/__pycache__/module.pyc"].join("\0"));
    expect(readFileSync(join(dest, "apps/cli/src/changed.ts"), "utf8")).toBe("apps/cli/src/changed.ts");
    expect(existsSync(join(dest, "packages/new.ts"))).toBe(true);
    expect(existsSync(join(dest, ".github/workflows/release.yml"))).toBe(true);
    for (const name of [".env", "apps/.env.test", "packages/token.pem", "packages/node_modules", "dist", ".git", "packages/secrets.json", "packages/link", "packages/out", "packages/__pycache__"]) expect(existsSync(join(dest, name))).toBe(false);
  });
  test("source copy rejects traversal from the inventory", async () => {
    const root = temp();
    await expect(copyCurrentSource(root, join(root, "copy"), async () => "../outside.ts\0")).rejects.toThrow("path");
  });
  test("real Git inventory preserves working edits and untracked source but excludes ignored content", async () => {
    const root = temp(), source = join(root, "source"), copy = join(root, "copy");
    mkdirSync(source);
    const env = isolatedEnvironment(join(root, "env"), "/usr/bin:/bin");
    const git = (...args: string[]) => runProcess({ argv: ["/usr/bin/git", ...args], cwd: source, env });
    await git("init", "--quiet");
    put(join(source, "tracked.ts"), "old content");
    put(join(source, ".gitignore"), "ignored.ts\n");
    await git("add", "tracked.ts", ".gitignore");
    put(join(source, "tracked.ts"), "working modification");
    put(join(source, "new.ts"), "eligible untracked");
    put(join(source, "ignored.ts"), "ignored");
    await copyCurrentSource(source, copy, runProcess, env);
    expect(readFileSync(join(copy, "tracked.ts"), "utf8")).toBe("working modification");
    expect(readFileSync(join(copy, "new.ts"), "utf8")).toBe("eligible untracked");
    expect(existsSync(join(copy, "ignored.ts"))).toBe(false);
    expect(existsSync(join(copy, ".git"))).toBe(false);
  });
  test("sandbox rejects noncanonical Bun before any subprocess or download", async () => {
    const root = temp();
    put(join(root, ".github/workflows/release.yml"), 'bun-version: "0.0.1"');
    const calls: string[] = [];
    const result = await runCompatibility({ root }, { run: async () => { calls.push("run"); return ""; }, download: async () => { calls.push("download"); return Buffer.alloc(0); } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("canonical Bun 0.0.1");
    expect(calls).toHaveLength(0);
  });
  test("official Node provisioning compares SHA256 before extracting", async () => {
    const root = temp(), calls: Command[] = [], urls: string[] = [];
    const bytes = Buffer.from("official fixture");
    const name = `node-v20.20.0-${identity.target}.tar.gz`;
    const download = async (url: string) => { urls.push(url); return url.endsWith("SHASUMS256.txt") ? Buffer.from(`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`) : bytes; };
    const node = await provisionNode(20, identity.target, root, { download, run: async command => { calls.push(command); return ""; } });
    expect(node.path).toContain("/bin/node");
    expect(node.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(urls.every(url => url.startsWith("https://nodejs.org/dist/latest-v20.x/"))).toBe(true);
    expect(calls.some(command => command.argv.includes("-xzf"))).toBe(true);
  });
  test("bad Node checksum never extracts or runs the downloaded binary", async () => {
    const calls: Command[] = [];
    await expect(provisionNode(24, identity.target, temp(), { download: async url => Buffer.from(url.endsWith("SHASUMS256.txt") ? `${"0".repeat(64)}  node-v24.1.0-${identity.target}.tar.gz` : "corrupt"), run: async command => { calls.push(command); return ""; } })).rejects.toThrow("checksum");
    expect(calls).toHaveLength(0);
  });
  test("verifies digest, standalone empty-PATH identity and real Node hook evidence separately", async () => {
    const root = temp(), options = candidate(root), calls: Command[] = [];
    const evidence = await verifyArchive(options, join(root, "execution"), fakeRunner(calls));
    expect(evidence.sha256).toBe(sha256(options.archive));
    expect(evidence.nodeVersion).toBe("v20.20.0");
    expect(evidence.standalone).toBe(true);
    expect(evidence.hookChecks).toEqual(["capture", "recall", "denial", "invalid-input"]);
    const standalone = calls.find(command => command.argv.includes("version"))!;
    expect(standalone.env.PATH).toBe("");
    expect(standalone.cwd).not.toBe(root);
    expect(calls.find(command => command.argv.includes(options.node))?.env.PATH).not.toContain(process.env.PATH!);
  });
  test("executes an owned snapshot of the hashed archive, not a mutable caller path", async () => {
    const root = temp(), options = candidate(root), expected = sha256(options.archive);
    const run = fakeRunner([], (command, output) => {
      if (command.argv[0] === "/usr/bin/uname" || command.argv[0] === "/usr/sbin/sysctl") put(options.archive, "changed after snapshot");
      if (command.argv.includes("-tzf")) expect(sha256(command.argv[command.argv.indexOf("-tzf") + 1])).toBe(expected);
      return output;
    });
    const result = await verifyArchive(options, join(root, "execution"), run);
    expect(result.sha256).toBe(expected);
    expect(result.ok).toBe(true);
  });
  for (const [label, change] of [
    ["checksum mismatch", (options: ReturnType<typeof candidate>) => put(options.checksums, `${"0".repeat(64)}  candidate.tar.gz`)],
    ["foreign native target", (options: ReturnType<typeof candidate>) => { options.target = process.arch === "arm64" ? "linux-x64" : "darwin-arm64"; }],
  ] as const) test(`fails closed on ${label}`, async () => {
    const root = temp(), options = candidate(root), calls: Command[] = [];
    change(options);
    await expect(verifyArchive(options, join(root, "execution"), fakeRunner(calls))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  for (const failure of ["wrong-version", "wrong-commit", "wrong-channel", "wrong-node", "missing-hook-check", "unsafe-archive", "symlink-archive", "crash"] as const) {
    test(`fails closed on ${failure}`, async () => {
      const root = temp(), options = candidate(root);
      const run = fakeRunner([], (command, output) => {
        if (failure === "crash" && command.argv.includes("version")) throw new Error("signal SIGSEGV");
        if (failure === "wrong-version") return output.replace("deck 0.4.0", "deck 9.9.9");
        if (failure === "wrong-commit") return output.replace(identity.commit, "b".repeat(40));
        if (failure === "wrong-channel") return output.replace("channel: dev", "channel: stable");
        if (failure === "wrong-node") return output.replaceAll("v20.20.0", "v22.0.0");
        if (failure === "missing-hook-check" && output.startsWith("{")) return '{"ok":true}';
        if (failure === "unsafe-archive" && command.argv.includes("-tzf")) return "../deck\n";
        if (failure === "symlink-archive" && command.argv.includes("-tvzf")) return "lrwxrwxrwx deck -> /outside\n";
        return output;
      });
      await expect(verifyArchive(options, join(root, "execution"), run)).rejects.toThrow();
    });
  }
  test("a translated process architecture cannot masquerade as a native host", async () => {
    const root = temp(), options = candidate(root);
    const run = fakeRunner([], (command, output) => {
      if (command.argv[0] === "/usr/bin/uname") return process.arch === "arm64" ? "x86_64\n" : "aarch64\n";
      if (command.argv[0] === "/usr/sbin/sysctl") return process.arch === "arm64" ? "0\n" : "1\n";
      return output;
    });
    await expect(verifyArchive(options, join(root, "execution"), run)).rejects.toThrow("native host architecture");
  });
  test("returns and writes failure JSON rather than claiming an incomplete run passed", async () => {
    const root = temp(), options = candidate(root), report = join(root, "evidence.json");
    const result = await runCompatibility({ ...options, report }, { run: async () => { throw new Error("fixture failure"); } });
    expect(result.ok).toBe(false);
    expect(JSON.parse(readFileSync(report, "utf8")).ok).toBe(false);
    expect(result.limitations).toContain("Offline fixtures do not certify arbitrary upstream npm installations or all OS versions.");
  });
  test("existing archive requires absolute Node selection, without resolving from caller cwd", async () => {
    const root = temp(), options = candidate(root), calls: Command[] = [];
    const result = await runCompatibility({ ...options, node: "node" }, { run: fakeRunner(calls) });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  test("default composition extracts and executes a real fixture archive, retaining wrong-Node failure evidence", async () => {
    const root = temp(), options = candidate(root), staging = join(root, "staging");
    put(join(staging, "deck"), `#!/bin/sh\nprintf '%s' '${versionOutput()}'\n`);
    chmodSync(join(staging, "deck"), 0o755);
    const env = isolatedEnvironment(join(root, "fixture-env"), "/usr/bin:/bin");
    await runProcess({ argv: ["/usr/bin/tar", "-czf", options.archive, "-C", staging, "deck"], cwd: root, env });
    put(options.checksums, `${sha256(options.archive)}  candidate.tar.gz\n`);
    const node = join(root, "node");
    put(node, '#!/bin/sh\nprintf "v22.1.0\\n"\n');
    chmodSync(node, 0o755);
    const result = await runCompatibility({ ...options, node });
    expect(result.ok).toBe(false);
    expect(result.cases[0]).toMatchObject({ major: 20, sha256: sha256(options.archive), standalone: true, nodeVersion: "v22.1.0", error: "Actual Node version does not match requested major" });
  });
  for (const interruption of [undefined, "download", "provision", "cell"] as const) test(`local composition: ${interruption ?? "both majors succeed"}`, async () => {
    const root = temp(), source = join(root, "source"), calls: Command[] = [];
    const files = ["package.json", ".github/workflows/release.yml", "packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js", "apps/changed.ts"];
    put(join(source, files[0]), '{"version":"0.4.0"}');
    put(join(source, files[1]), `bun-version: "${Bun.version}"`);
    put(join(source, files[2]), "export const forwardCodexTrustedHook = () => {};");
    put(join(source, files[3]), "current uncommitted source");
    const archiveBytes = Buffer.from("official fixture");
    const urls: string[] = [];
    const listeners = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    let observedSignal: AbortSignal | undefined;
    const run = fakeRunner(calls, (command, output) => {
      if (command.argv.includes("ls-files")) return files.join("\0");
      if (command.argv.includes("rev-parse")) return identity.commit;
      if (command.argv.includes("--compile")) {
        expect(command.cwd).not.toBe(source);
        expect(readFileSync(join(command.cwd, "apps/changed.ts"), "utf8")).toBe("current uncommitted source");
        put(command.argv[command.argv.indexOf("--outfile") + 1], "binary");
      }
      if (command.argv.includes("-czf")) put(command.argv[command.argv.indexOf("-czf") + 1], "compiled archive");
      if ((interruption === "provision" && command.argv.includes("-xzf") && command.cwd.endsWith("node-20")) ||
          (interruption === "cell" && command.argv.some(arg => arg.endsWith("node-hook-fixture.mjs")))) {
        observedSignal = command.signal;
        process.emit("SIGTERM");
      }
      if (command.argv[0].includes("node-v24")) return output.replaceAll("v20.20.0", "v24.1.0");
      return output;
    });
    const result = await runCompatibility({ root: source }, { run, download: async (url, signal?: AbortSignal) => {
      urls.push(url);
      if (interruption === "download") {
        observedSignal = signal;
        // Interruption while an asynchronous transfer is pending, with no active child.
        await new Promise<void>(resolve => setImmediate(() => { process.emit("SIGINT"); resolve(); }));
        signal?.throwIfAborted();
      }
      const major = url.includes("latest-v20") ? 20 : 24;
      const version = major === 20 ? "20.20.0" : "24.1.0";
      return url.endsWith("SHASUMS256.txt") ? Buffer.from(`${createHash("sha256").update(archiveBytes).digest("hex")}  node-v${version}-${identity.target}.tar.gz\n`) : archiveBytes;
    } });
    expect(result.ok).toBe(!interruption);
    expect(result.cases.map(item => item.major)).toEqual(interruption ? [20] : [20, 24]);
    if (interruption) {
      expect(result.cancelled).toBe(true);
      expect(observedSignal?.aborted).toBe(true);
      expect(urls.some(url => url.includes("latest-v24"))).toBe(false);
      expect(result.stage).toBe(interruption === "download" ? "download-node" : interruption === "provision" ? "extract-node" : "node-hook");
    }
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(listeners);
    expect(new Set(result.cases.map(item => item.sha256)).size).toBe(1);
    expect(calls.filter(command => command.argv.includes("--compile"))).toHaveLength(1);
    const signSteps = calls.filter(command => command.argv[0] === "/usr/bin/codesign");
    expect(signSteps).toHaveLength(process.platform === "darwin" ? 3 : 0);
    if (process.platform === "darwin") {
      expect(calls.indexOf(signSteps[0])).toBeGreaterThan(calls.findIndex(command => command.argv.includes("--compile")));
      expect(calls.indexOf(signSteps[2])).toBeLessThan(calls.findIndex(command => command.argv.includes("-czf")));
    }
    expect(calls.find(command => command.argv.includes("install"))?.argv).toContain("--frozen-lockfile");
    for (const name of ["generate-runner-execution-assets.ts", "generate-build-info.ts", "generate-skill-bundle.ts"]) expect(calls.some(command => command.argv.some(arg => arg.endsWith(name)))).toBe(true);
    expect(readFileSync(join(source, "apps/changed.ts"), "utf8")).toBe("current uncommitted source");
    const copy = calls.find(command => command.argv.includes("--compile"))!.cwd;
    expect(existsSync(copy)).toBe(false);
    expect(existsSync(dirname(copy))).toBe(false);
  });
});

describe("production subprocess and hook fixture", () => {
  for (const phase of ["headers", "body"] as const) test(`official downloader cancels during ${phase} (fake fetch, no network)`, async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (_url: unknown, init: RequestInit) => {
      fetchSignal = init.signal!;
      if (phase === "headers") {
        return await new Promise<Response>((_resolve, reject) => {
          fetchSignal!.addEventListener("abort", () => reject(fetchSignal!.reason), { once: true });
          ready();
        });
      }
      return new Response(new ReadableStream({
        start(stream) { fetchSignal!.addEventListener("abort", () => stream.error(fetchSignal!.reason), { once: true }); },
        pull() { ready(); },
      }));
    }) as typeof fetch);
    try {
      const pending = downloadOfficial("https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt", controller.signal);
      const failure = pending.then(() => undefined, error => error);
      await started;
      controller.abort();
      expect((await failure)?.name).toBe("AbortError");
      expect(fetchSignal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  });
  test("failure report identifies the safe step without copying stderr or command data", async () => {
    const root = temp(), options = candidate(root), staging = join(root, "staging");
    put(join(staging, "deck"), '#!/bin/sh\nprintf "fixture-private-token" >&2\nexit 7\n');
    chmodSync(join(staging, "deck"), 0o755);
    await runProcess({ argv: ["/usr/bin/tar", "-czf", options.archive, "-C", staging, "deck"], cwd: root, env: isolatedEnvironment(root, "") });
    put(options.checksums, `${sha256(options.archive)}  candidate.tar.gz\n`);
    const result = await runCompatibility(options);
    expect(result.ok).toBe(false);
    expect(result.cases[0].stage).toBe("standalone-version");
    expect(result.cases[0].error).toContain("exit 7");
    expect(JSON.stringify(result)).not.toContain("fixture-private-token");
    expect(JSON.stringify(result)).not.toContain(options.archive);
  });
  test("explicit cancellation kills a real subprocess and rejects with AbortError", async () => {
    const root = temp(), controller = new AbortController();
    const pending = runProcess({ argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], cwd: root, env: isolatedEnvironment(root, ""), signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  test("pre-aborted subprocess never starts", async () => {
    const root = temp(), marker = join(root, "must-not-exist"), controller = new AbortController();
    controller.abort();
    await expect(runProcess({ argv: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`], cwd: root, env: isolatedEnvironment(root, ""), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(existsSync(marker)).toBe(false);
  });
  test("closes stdin and strips inherited environment in the default executor", async () => {
    const root = temp();
    const output = await runProcess({ argv: [process.execPath, "-e", 'let text="";for await (const chunk of process.stdin) text+=chunk;console.log(JSON.stringify({text,home:process.env.HOME,secret:process.env.NODE_OPTIONS}))'], cwd: root, env: isolatedEnvironment(root, "") });
    expect(JSON.parse(output)).toEqual({ text: "", home: join(root, "home") });
  });
  test("bounds output and kills a hanging owned process", async () => {
    const root = temp(), env = isolatedEnvironment(root, "");
    await expect(runProcess({ argv: [process.execPath, "-e", "setInterval(()=>{},1000)"], cwd: root, env, timeoutMs: 50 })).rejects.toThrow("timeout");
    await expect(runProcess({ argv: [process.execPath, "-e", 'console.log("x".repeat(100000))'], cwd: root, env, maxOutputBytes: 100 })).rejects.toThrow("output");
  });
  test("parent interruption stops its owned child instead of waiting for the timeout", async () => {
    const root = temp();
    const script = `import {runProcess} from ${JSON.stringify(join(import.meta.dir, "verify-binary-compatibility.ts"))};
      const pending=runProcess({argv:[process.execPath,"-e","setInterval(()=>{},1000)"],cwd:process.cwd(),env:{PATH:""},timeoutMs:500});
      setTimeout(()=>process.emit("SIGTERM"),20);
      try {await pending;} catch(error) {console.log(error.message);}`;
    const output = await runProcess({ argv: [process.execPath, "-e", script], cwd: root, env: isolatedEnvironment(root, "") });
    expect(output.trim()).toBe("subprocess interrupted (SIGTERM)");
  });
  test("real generated hook passes the offline protocol fixture without a provider", async () => {
    const root = temp();
    const hook = join(root, "hook.mjs"), fixture = join(root, "node-hook-fixture.mjs");
    put(hook, readFileSync(join(import.meta.dir, "../packages/adapter-codex/assets/codex/hooks/developer-team-execution.generated.js"), "utf8"));
    put(fixture, NODE_HOOK_FIXTURE);
    // This is a fixture contract test on the host runtime, NOT a Node 20/24 certification.
    const output = await runProcess({ argv: [process.execPath, fixture, hook], cwd: root, env: isolatedEnvironment(root, "") });
    expect(JSON.parse(output).checks).toEqual(["capture", "recall", "denial", "invalid-input"]);
  });
});
