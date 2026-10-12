// Test entry standing in for `deck internal session-mcp`.
import { runSessionMcpBridge } from "../../mcp-bridge";
await runSessionMcpBridge({ input: process.stdin, write: (line) => { process.stdout.write(line); }, env: process.env, version: "test" });
process.exit(0);
