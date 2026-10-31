/** Private, one-request stdio protocol. No listening socket or caller-selected executable. */
import type { CommandOutcome } from './protocol';
export const GIT_READER_COMMAND = 'internal-git-reader-v1';
export const MAX_REQUEST = 32 * 1024;
export const MAX_RESPONSE = 4 * 1024 * 1024;
export const MAX_FILE_RESPONSE = 12 * 1024 * 1024;
export async function runGitReaderProcess(): Promise<void> {
 let bytes=0;const chunks:Buffer[]=[];
 for await(const chunk of process.stdin) {
  bytes+=chunk.length;if(bytes>MAX_REQUEST)throw Error('Request limit');
  chunks.push(Buffer.from(chunk));
 }
 const request=JSON.parse(Buffer.concat(chunks).toString());
 const token=process.env.DECK_GIT_READER_TOKEN;
 delete process.env.DECK_GIT_READER_TOKEN;
 if(!token || token.length!==64 || request.token!==token || request.version!==1 ||
    typeof request.projectRoot!=='string' || request.projectRoot.length>4096 ||
    (request.selection!==undefined && (!request.selection || typeof request.selection.path!=='string' || typeof request.selection.section!=='string' || (request.selection.content!==undefined && typeof request.selection.content!=='boolean'))))throw Error('Invalid internal request');
 // Native code is loaded only after the private pipe request is validated.
 const reader=await import('./git-diff-reader');
 const result:CommandOutcome=await (request.browse
  ? (await import('./project-files-reader')).browseProject(request.projectRoot,request.browse)
  : request.selection
  ? (request.selection.content ? reader.readGitContent : reader.readGitDiff)(request.projectRoot,request.selection.section,request.selection.path)
  : reader.listGitChanges(request.projectRoot));
 const output=JSON.stringify({version:1,token,result});
 if(Buffer.byteLength(output)>(request.browse?MAX_FILE_RESPONSE:MAX_RESPONSE))throw Error('Response limit');
 await new Promise<void>((resolve,reject)=>process.stdout.write(output,error=>error?reject(error):resolve()));
}
if(import.meta.main)runGitReaderProcess().then(()=>process.exit(0),()=>process.exit(1));
