/** Per-browser-device display accounting, independent of decisions and execution authority. */
export type LeadReply = {
  replyId: string;
  sessionId: string;
  taskId: string;
  attempt: number;
  messageSeq: number;
  completedSeq: number;
  ts: number;
  summary: string;
};
export type LeadReplyDisplay = LeadReply & {displayMessageSeq:number};
export type LeadReplyPage = { replies: LeadReply[]; total: number; nextCursor?: number; syncing?: boolean };
export const validReplyId = (value: unknown): value is string => typeof value === 'string' && /^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(value) && value.length <= 48;
