import type {ReviewDocument} from './api';

type Preview = {text:string; deleted:boolean};
type Presentation = {mode:'preview'; preview:Preview} | {mode:'code'|'diff'; preview?:Preview};

export function isMarkdownPath(path:string):boolean {
 return /\.(md|markdown|mkd|mdx)$/i.test(path);
}

export function resolveReviewPresentation(document:ReviewDocument, preference:string):Presentation {
 const mode = document.before ? 'diff' : 'code';
 if (!isMarkdownPath(document.entry.path)) return {mode};

 const {before,after} = document;
 const side = after.kind === 'absent' ? before : after;
 if (side?.kind !== 'text') return {mode};

 const preview = {text:side.text, deleted:after.kind === 'absent'};
 return preference === 'preview' ? {mode:'preview',preview} : {mode,preview};
}
