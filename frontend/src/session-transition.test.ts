import {test,expect} from 'bun:test';
import {transitionPreview,transitionCommand,transitionedSession} from './session-transition';
import type {Session} from './api';
// Protects explicit new relay authority and exact source/target retry identity.
// Oracle: runtime116 transition contract. Fails if foreign preview, source identity,
// elevated authority, changed assignment or mismatched acknowledgement can be accepted.
test('transition preserves source identity and requires exact relay acknowledgement',()=>{
 const source:Session={id:'old',title:'History',project:{id:'project',root:'/fixture',identity:null},native:null};
 const preview={api:7,source_session:'old',source_digest:'a'.repeat(64),approvals:'relay',native_context_copied:false};
 expect(transitionPreview(preview,'old')).toBe(preview.source_digest);
 for(const c of [{source_session:'other'},{approvals:'yolo'},{native_context_copied:true},{source_digest:'invalid'}])expect(()=>transitionPreview({...preview,...c},'old')).toThrow();
 const body={api:7,expected_source_digest:preview.source_digest,session:{api:7,id:'new',title:'New',project_id:'project',members:{lead:{runnerId:'fixture',modelId:'model'}},approvals:'relay'}};
 const command=transitionCommand(body,source);
 for(const c of [{id:'old'},{project_id:'foreign'},{approvals:'yolo'},{members:{}},{title:''}])expect(()=>transitionCommand({...body,session:{...body.session,...c}},source)).toThrow();
 const response={id:'new',title:'New',project:source.project,native:null,contract:{version:1,revision:1,generation:1,leadTask:'lead-new',members:body.session.members,approvals:'relay'}};
 expect(transitionedSession(response,command).id).toBe('new');
 for(const c of [{id:'other'},{project:{...source.project,id:'foreign'}},{contract:{...response.contract,approvals:'yolo'}},{contract:{...response.contract,members:{lead:{runnerId:'other',modelId:'model'}}}}])expect(()=>transitionedSession({...response,...c},command)).toThrow();
 expect(source.native).toBeNull();
});
