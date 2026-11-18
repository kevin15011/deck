import {test,expect} from 'bun:test';
import {changes} from './change';
import {API,receipt} from './api';
// Runtime boundary: malformed or foreign check projections cannot be rendered
// as verified state. Oracle: lifecycle API requires attributable typed evidence.
const c={request:{id:'change',session:'session',intent:'Feature',acceptance:'Required examples',scope:['source.py'],check:'checks.py',command_source:'project.json'},revision:1,owner:'lead',roots:[],completion:'incomplete',reviews:[],findings:[],artifacts:[]};
test('typed lifecycle projection accepts pending intent and refuses untyped evidence',()=>{
 expect(changes({api:API,changes:[c]})[0]?.completion).toBe('incomplete');
 for(const value of [null,{api:API-1,changes:[]},{api:API,changes:[{...c,request:{}}]},{api:API,changes:[{...c,reviews:[{exit_code:0}]}]},{api:API,changes:[{...c,findings:[{severity:'major'}]}]}])expect(()=>changes(value)).toThrow();
});
