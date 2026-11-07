import type {DictationModelId} from '@deck/core/session/dictation';
export type ModelArtifact={id:DictationModelId;label:string;file:string;bytes:number;sha256:string;url:string};
const revision='5359861c739e955e79d9a303bcbc70fb988958b1';
export const MODEL_CATALOG:readonly ModelArtifact[]=[
 {id:'large-v3-turbo-q5_0',label:'Large v3 Turbo · Q5_0',bytes:574041195,sha256:'394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'},
].map(m=>({...m,id:m.id as DictationModelId,file:`ggml-${m.id}.bin`,url:`https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-${m.id}.bin`}));
