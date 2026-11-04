import { forwardCodexTrustedHook } from "./developer-team-execution";

// The installed SessionStart command is standalone: it must not resolve an older
// `deck` executable from PATH or depend on a separate launch transport.
try {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error("invalid-evidence");
  }
  const input = JSON.parse(raw);
  const output = await forwardCodexTrustedHook(input);
  process.stdout.write(JSON.stringify(output) + "\n");
} catch {
  process.stderr.write("deck-preparation: session-start-context-unverified\n");
  process.stdout.write("{}\n");
}
