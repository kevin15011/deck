import { expect, test } from "bun:test";
import { authenticate } from "./session-mcp-authenticate";

// Protects request correlation and requires a valid successful tool result.
const fake = `
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let pos;
  while ((pos = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
    const msg = JSON.parse(line);
    if (!msg.id) continue;
    if (process.env.MODE === 'mismatch') { console.log(JSON.stringify({jsonrpc:'2.0', id:msg.id + 1, result:{content:[{type:'text'}]}})); continue; }
    const result = msg.method === 'initialize' ? {} : process.env.MODE === 'bad' ? {} : {content:[{type:'text',text:'ok'}]};
    console.log(JSON.stringify({jsonrpc:'2.0', id:msg.id, result}));
  }
});`;

test("authenticates only matching responses with tool content", async () => {
  expect(await authenticate(process.execPath, ["-e", fake], { MODE: "good" }, 300)).toBe("verified");
  expect(await authenticate(process.execPath, ["-e", fake], { MODE: "bad" }, 300)).toBe("failed");
  const start = Date.now();
  expect(await authenticate(process.execPath, ["-e", fake], { MODE: "mismatch" }, 300)).toBe("failed");
  expect(Date.now() - start).toBeLessThan(2000);
});
