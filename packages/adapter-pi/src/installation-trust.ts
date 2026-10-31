import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { assertNoContributionSymlink } from '../../core/src/runner-contributions';
import { ROLE_TOOL_POLICY } from '@deck/core/session/role-tool-policy';
import { canonicalJson, matchesOwnedHash, parsePiManifest } from './pi-manifest';
import { parseAgentMarkdown } from './pi-extensions/subagents/agents';
import { piReadOnlyToolAllowlist, DECK_PI_MCP_SERVER_IDS } from './pi-mcp-catalog';

/** Authenticate executable inputs, independently of the current bundled generation. */
export function verifyPiInstallation(root: string): void {
 const read=(path:string)=>{assertNoContributionSymlink(path);return readFileSync(path,'utf8');};
 const parsed=parsePiManifest(read(join(root,'deck/manifest.json')));
 if(!parsed.ok)throw new Error('Pi ownership manifest is invalid; restore the Deck installation receipt.');
 const checked=new Map<string,string>();
 const owned=(rel:string)=>{
  const cached=checked.get(rel);if(cached!==undefined)return cached;
  if(!resolve(root,rel).startsWith(resolve(root)+sep))throw new Error('Pi executable path escapes its installation');
  const content=read(join(root,rel));
  if(!matchesOwnedHash(rel,parsed.manifest.files[rel],content))throw new Error(`Pi blocked: ${rel} is edited or unreceipted. Preserve your changes elsewhere and restore the owned file before launching.`);
  checked.set(rel,content);
  return content;
 };
 owned('deck/package/package.json');
 const policy=JSON.parse(owned('deck/package/role-policy.json'));
 if(canonicalJson(policy)!==canonicalJson(ROLE_TOOL_POLICY))throw new Error('Pi role policy is incompatible; refresh the owned policy before launching.');
 const walk=(rel:string)=>{
  assertNoContributionSymlink(join(root,rel));
  for(const entry of readdirSync(join(root,rel),{withFileTypes:true})) {
   const path=`${rel}/${entry.name}`;
   if(entry.isDirectory())walk(path);else owned(path);
  }
 };
 for(const path of Object.keys(parsed.manifest.files))if(path.startsWith('deck/package/extensions/'))owned(path);
 for(const name of ['deck-tool-policy','deck-subagents','deck-memory','developer-team-execution']) {
  owned(`deck/package/extensions/${name}/index.js`); owned(`deck/package/extensions/${name}/impl.js`);
 }
 walk('deck/package/extensions');
 const allowed=new Set(piReadOnlyToolAllowlist(DECK_PI_MCP_SERVER_IDS));
 for(const id of ROLE_TOOL_POLICY.readOnlyRoles){
  const role=parseAgentMarkdown(id,read(join(root,`deck/package/agents/${id}.md`)));
  for(const tool of role.tools)if(!allowed.has(tool))throw new Error(`Pi blocked: ${id} grants ${tool}; remove this permission from the read-only role.`);
 }
}
