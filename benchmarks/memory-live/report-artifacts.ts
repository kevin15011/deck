import { privateWrite } from './security';

// Only the evaluator's mutable reports use this effect. Immutable response/case
// artifacts and authority receipts retain their independent filesystem boundary.
// The default always executes the secure writer; no runtime storage selector.
export const reportArtifacts = {
    write: privateWrite,
};
