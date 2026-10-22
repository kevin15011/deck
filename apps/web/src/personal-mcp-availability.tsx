import type { PersonalMcpAvailability, PersonalMcpByMember } from '../../../packages/core/src/session/personal-mcp';
import { SecondaryInfo } from './secondary-info';
const reasonText: Record<string,string> = {
    'managed-name-conflict': 'Conflicts with the selected Deck server', 'limit-exceeded': 'Additional servers are not listed in this summary', reserved: 'Reserved for Deck', 'managed-copy': 'Provided by Deck', 'namespace-conflict': 'Tool name conflict', shadowed: 'Replaced by a narrower scope', disabled: 'Disabled in native settings', 'project-trust-pending': 'Project execution trust is pending', 'project-untrusted': 'Project source has no verified approval', 'invalid-config': 'Invalid configuration', 'unsupported-config': 'Native configuration cannot be relocated safely', 'plugin-requires-execution': 'Plugin MCP discovery requires executing the plugin', 'managed-policy': 'Controlled by managed policy', unreadable: 'Configuration unavailable', 'not-connected': 'Connection unavailable',
};
type Props={ entries?: readonly PersonalMcpAvailability[]; runnerId?:string; members?:PersonalMcpByMember };
export function PersonalMcpAvailabilityContent({ entries, runnerId, members }:Props) {
    const groups=[...(entries?.length ? [{label:`Lead${runnerId ? ` · ${runnerId}` : ''}`,servers:entries}] : []),...Object.entries(members??{}).map(([memberId,snapshot])=>({label:`${memberId} · ${snapshot.runnerId}`,servers:snapshot.servers}))];
    if (!groups.some(group=>group.servers.length)) return null;
    const selected=groups.flatMap(group=>group.servers).filter(server=>server.status==='active'||server.status==='configured').length;
    return <><p className="secondary-info-kicker">Availability</p><p className="secondary-info-primary">{selected}<span> selected</span></p><p className="secondary-info-note">Configured servers connect when a turn starts; Active reflects the last check. Role permissions still apply.</p>{groups.map(group=><section className="secondary-info-section" key={group.label} aria-label={group.label}><h3>{group.label}</h3><ul className="secondary-info-servers">{group.servers.map((entry,index)=><li key={`${entry.id}:${entry.source}:${index}`}><div><strong>{entry.id}</strong><span className="secondary-info-status" data-status={entry.status}>{entry.status==='configured'?'Configured':entry.status==='active'?'Active':entry.status==='conflicting'?'Conflicting':'Unavailable'}</span></div><p>{entry.source}{entry.reason&&` · ${reasonText[entry.reason]??'Unavailable'}`}</p></li>)}</ul></section>)}</>;
}
export function PersonalMcpAvailabilityView(props:Props) {
    if(!props.entries?.length&&!Object.values(props.members??{}).some(snapshot=>snapshot.servers.length))return null;
    return <SecondaryInfo title="MCP servers" label="MCP servers" className="session-mcp-availability" resetKey={props.runnerId}><PersonalMcpAvailabilityContent {...props}/></SecondaryInfo>;
}
