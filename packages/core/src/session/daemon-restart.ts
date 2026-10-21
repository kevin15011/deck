/** Device-only Web lifecycle contract. No executable paths, argv or native authority cross this API. */
export type RestartChannel='stable'|'canary';
export type RestartReceipt={requestId:string;state:'pending'|'committed'|'restarted'|'failed'|'aborted';force:boolean;code?:string;version:string;channel:RestartChannel};
export type RestartPreflight={available:boolean;token?:string;current:{version:string;channel:RestartChannel};target?:{version:string;channel:RestartChannel;build:'same'|'different'};work?:{tasks:number;approvals:number;questions:number;busy:boolean};latest?:RestartReceipt;code?:string;recoveryCommand:string};
export type RestartRequest={requestId:string;token:string;force:boolean};
