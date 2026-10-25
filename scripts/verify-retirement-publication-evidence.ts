/** Read-only CI gate: no runner processes, installation, planning writes or credentials. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { publishedMatrixGaps } from './retirement-publication-contract';
const argument=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const runner=argument('runner'),base=argument('base'),selected=argument('selected');
if(!runner||!base||!selected)throw Error('Provide --runner, --base and --selected evidence paths');
const read=(path:string)=>{try{return JSON.parse(readFileSync(path,'utf8'));}catch{throw Error(`Evidence file is missing or invalid: ${path}`);}};
const pins=read(join(import.meta.dir,'fixtures/retirement-releases.json'));
const gaps=publishedMatrixGaps(pins.rows,read(base).results,read(selected).results,runner);
const expectedBun=readFileSync(join(import.meta.dir,'../.bun-version'),'utf8').trim();
for(const path of [base,selected])if(read(join(dirname(path),'runtime.json')).bun!==expectedBun)gaps.push('Evidence does not use the pinned Bun runtime');
for(const gap of gaps)console.error(gap);
console.log(`${runner}: ${gaps.length} publication evidence gaps; unsupported inventory combinations remain explicit`);
if(gaps.length)process.exitCode=1;
