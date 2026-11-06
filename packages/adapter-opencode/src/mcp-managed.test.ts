import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeOpenCodeMcpConfig } from './opencode-mcp-config';

// Protects generic shared names: user entries survive and required installation fails visibly.
test('generic MCP collision is preserved without a false success or receipt', () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-mcp-collision-'))),path=join(root,'opencode.json');
 try {
  const before=JSON.stringify({mcp:{context7:{type:'remote',url:'https://personal.invalid',headers:{Authorization:'private'}}},provider:{custom:true}});
  writeFileSync(path,before);
  const result=writeOpenCodeMcpConfig({configPath:path,serverName:'context7',type:'local',command:['npx','-y','@upstash/context7-mcp@4.1.1']});
  expect(result.ok).toBe(false); expect(result.code).toBe('mcp-config-conflict');
  expect(readFileSync(path,'utf8')).toBe(before); expect(existsSync(join(root,'deck/manifest.json'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Protects exact historical recognition and receipt-bound repair while preserving unrelated JSONC bytes.
test('known Context7 history reconciles and later edited receipt slot repairs without losing comments', () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-mcp-history-'))),path=join(root,'opencode.json');
 try {
  const before='// personal header\n{ "provider": {"private": "keep"}, "mcp": {"personal": {"command": ["mine"]}, "context7": {"type":"local", "command":["npx","-y","@upstash/context7-mcp"], "enabled":true}}}\n';
  writeFileSync(path,before);
  const options={configPath:path,serverName:'context7',type:'local' as const,command:['npx','-y','@upstash/context7-mcp@4.1.1']};
  expect(writeOpenCodeMcpConfig(options).ok).toBe(true);
  const canonical=readFileSync(path,'utf8');
  expect(canonical).toContain('// personal header');expect(canonical).toContain('"provider": {"private": "keep"}');expect(canonical).toContain('"personal": {"command": ["mine"]}');
  writeFileSync(path,canonical.replace('@upstash/context7-mcp@4.1.1','edited-untrusted').replace('"enabled":true', '"enabled":true, /* keep comment */ "obsoleteOne":1, "obsoleteTwo":2'));
  expect(writeOpenCodeMcpConfig(options).ok).toBe(true);
  expect(readFileSync(path,'utf8')).toContain('/* keep comment */');
  expect(readFileSync(path,'utf8')).not.toContain('obsoleteOne');
  const repaired=readFileSync(path,'utf8');
  expect(writeOpenCodeMcpConfig(options).ok).toBe(true);
  expect(readFileSync(path,'utf8')).toBe(repaired);
 }finally{rmSync(root,{recursive:true,force:true});}
});
