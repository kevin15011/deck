import {test,expect} from 'bun:test';
import {runnerSummary} from './runners';

test('runner summary reflects current observations and assignments',()=>{
 const base={historical:false,observation:{ready:true},selected:null,candidate:{installed:false},open_code:{assignment:{runner:'claude',model:'x'},ready:false}} as Parameters<typeof runnerSummary>[0];
 expect(runnerSummary(base)).toBe('Claude: Unavailable · Codex: Ready');
 expect(runnerSummary({...base!,historical:true})).toContain('Codex: Unknown');
 expect(runnerSummary(undefined)).toBe('Claude: Unknown · Codex: Unknown');
});
