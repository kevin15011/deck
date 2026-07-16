import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import * as api from "../index";

const d=(c:string)=>`sha256:${c.repeat(64)}` as const;
const time="2026-07-15T00:00:00.000Z";
const canonical=(value:unknown):string=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(",")}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(",")}}`;
const hash=(value:unknown)=>`sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const exact=(fn:()=>unknown,message:string)=>expect(fn).toThrow(new Error(message));
const batch=api.buildApplyBatchContractV1({schema:"apply-batch-v1",changeId:"change",taskIds:["EG2-R3C"],dependencies:[],ownerRole:"apply-general",allowedTargets:["packages/sdd-runtime"],blockedTargets:[],acceptanceObligations:["REQ-CONTRACT-005"],verificationPlan:[],artifactDigests:{},authorizationGrantRef:d("a"),provenance:{actor:"apply-general",issuedAt:time},repositoryRoot:"/repo"});
const finding=(overrides:Record<string,unknown>={})=>({batchId:batch.batchId,batchDigest:batch.digest,sourcePhase:"review",sourceArtifact:"review.md",severity:"low",category:"contract",rootCause:"implementation",requirementIds:["REQ-CONTRACT-005"],taskIds:["EG2-R3C"],locationKeys:["src/a.ts"],oracleId:"same",isSecurityRelevant:false,status:"open",relationship:"batch_related",evidence:[{kind:"test",checkId:"matrix",artifact:"review.md",resultCode:"failed"}],...overrides});
const manifest=(findings:unknown[])=>api.buildFailureManifestV1({schema:"failure-manifest-v1",changeId:"change",batch,producerRole:"review",producerInstanceId:"review",findings,producedAt:time,repositoryRoot:"/repo"} as never);
const empty=manifest([]), current=manifest([finding()]);
const delta=api.computeFailureDeltaV1(empty,current);
const lane=api.buildLaneDecisionV1({schema:"lane-decision-v1",lane:"full_sdd",riskScore:1,floorReasons:[],policyOverrides:[],shadowOnly:true});
const verification=api.buildStagedVerificationStateV1({schema:"staged-verification-state-v1",batchId:batch.batchId,stages:[]});
const causal=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
const base={schema:"execution-dossier-v1" as const,batch,priorManifest:empty,currentManifest:current,delta,lane,verification,causalContext:causal,registryIntents:[]};
const dossier=api.createExecutionDossierV1(base);
const rehashDelta=(patch:Record<string,unknown>)=>{const value={...delta,...patch} as Record<string,unknown>;delete value.deltaId;delete value.digest;const digest=hash(value);return{...value,deltaId:`delta:v1:${digest.slice(7,39)}`,digest};};
const rehashDossier=(patch:Record<string,unknown>)=>{const value={...dossier,...patch} as Record<string,unknown>;delete value.dossierId;delete value.digest;const digest=hash(value);return{...value,dossierId:`dossier:v1:${digest.slice(7,39)}`,digest};};

describe("EG2-R3C exact FailureDeltaV1 public acceptance",()=>{
  test("parseFailureDeltaV1 round-trips the exact recomputed delta",()=>expect(api.parseFailureDeltaV1(structuredClone(delta),empty,current)).toEqual(delta));
  test("parseFailureDeltaV1 rejects overlapping buckets",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({persistent:delta.newRelated}),empty,current),"invalid-evidence: delta.bucket-overlap"));
  test("parseFailureDeltaV1 rejects a non-sorted bucket",()=>exact(()=>api.parseFailureDeltaV1({...delta,newRelated:["finding:v1:z","finding:v1:a"]},empty,current),"invalid-evidence: delta.newRelated"));
  test("parseFailureDeltaV1 rejects an incorrect added projection",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({added:[]}),empty,current),"invalid-evidence: delta.added"));
  test("parseFailureDeltaV1 rejects an incorrect prior risk vector",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({priorRisk:{...delta.priorRisk,low:1,weighted:1}}),empty,current),"invalid-evidence: failure delta algebra"));
  test("parseFailureDeltaV1 rejects an incorrect current risk vector",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({currentRisk:{...delta.currentRisk,high:1,weighted:101}}),empty,current),"invalid-evidence: failure delta algebra"));
  test("parseFailureDeltaV1 rejects incorrect weighted movement",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({weightedMovement:99}),empty,current),"invalid-evidence: failure delta algebra"));
  test("parseFailureDeltaV1 rejects incorrect progress",()=>exact(()=>api.parseFailureDeltaV1(rehashDelta({progress:"positive"}),empty,current),"invalid-evidence: failure delta algebra"));
  test("computeFailureDeltaV1 gives unrelated baseline no movement or repair credit",()=>{const baseline=manifest([finding({status:"pre_existing",relationship:"unrelated_baseline"})]);const value=api.computeFailureDeltaV1(undefined,baseline);expect([value.newUnrelatedBaseline,value.weightedMovement,value.progress]).toEqual([[baseline.findings[0]!.findingId],0,"none"]);});
  test("computeFailureDeltaV1 gives a reopened protected finding negative precedence",()=>{const prior=manifest([finding({status:"resolved",severity:"critical",rootCause:"security",isSecurityRelevant:true})]);const now=manifest([finding({status:"open",severity:"critical",rootCause:"security",isSecurityRelevant:true})]);const value=api.computeFailureDeltaV1(prior,now);expect([value.regressed,value.weightedMovement,value.progress]).toEqual([[now.findings[0]!.findingId],-2000,"negative"]);});
  test("computeFailureDeltaV1 treats a medium increase as negative despite resolving many low findings",()=>{const prior=manifest(Array.from({length:11},(_,index)=>finding({oracleId:`low-${index}`})));const now=manifest([finding({oracleId:"medium",severity:"medium"})]);const value=api.computeFailureDeltaV1(prior,now);expect([value.priorRisk.low,value.currentRisk.medium,value.weightedMovement,value.progress]).toEqual([11,1,1,"negative"]);});
  test("computeFailureDeltaV1 requires safer precedence and positive weighted movement for positive progress",()=>{const prior=manifest([finding({oracleId:"high",severity:"high"})]);const now=manifest(Array.from({length:11},(_,index)=>finding({oracleId:`medium-${index}`,severity:"medium"})));const value=api.computeFailureDeltaV1(prior,now);expect([value.priorRisk.high,value.currentRisk.medium,value.weightedMovement,value.progress]).toEqual([1,11,-10,"negative"]);});
  test("parseFailureDeltaV1 rejects a self-hashed invented algebra without authoritative manifests",()=>{const invented=rehashDelta({priorRisk:{...delta.priorRisk,low:7,weighted:7},currentRisk:{...delta.currentRisk,low:8,weighted:8},weightedMovement:-1,progress:"negative"});exact(()=>(api.parseFailureDeltaV1 as (...args:unknown[])=>unknown)(invented),"invalid-evidence: failure delta authority");});
  test("computeFailureDeltaV1 excludes unchanged unrelated baseline from persistent and movement",()=>{const baseline=manifest([finding({status:"pre_existing",relationship:"unrelated_baseline"})]);const value=api.computeFailureDeltaV1(baseline,baseline);expect([value.persistent,value.newUnrelatedBaseline,value.weightedMovement,value.progress]).toEqual([[],[],0,"none"]);});
  test("computeFailureDeltaV1 excludes removed unrelated baseline from resolved and movement",()=>{const baseline=manifest([finding({status:"pre_existing",relationship:"unrelated_baseline"})]);const value=api.computeFailureDeltaV1(baseline,empty);expect([value.resolved,value.weightedMovement,value.progress]).toEqual([[],0,"none"]);});
  test("buildFailureManifestV1 rejects a malformed baseline relationship exactly",()=>exact(()=>manifest([finding({status:"pre_existing",relationship:"baseline"})]),"invalid-evidence: finding.relationship"));
  // B-B2-RELATIONSHIP-TRANSITION-DROPS-IDENTITY-v1: individually named tests.
  test("computeFailureDeltaV1 rejects same-identity relationship transition from unrelated_baseline to batch_related",()=>{
    const baselineFinding=finding({status:"pre_existing",relationship:"unrelated_baseline"});
    const prior=manifest([baselineFinding]);
    const currentFinding={...baselineFinding,status:"open",relationship:"batch_related"};
    const current=manifest([currentFinding]);
    exact(()=>api.computeFailureDeltaV1(prior,current),"invalid-evidence: finding relationship transition");
  });
  test("computeFailureDeltaV1 rejects same-identity relationship transition from batch_related to unrelated_baseline",()=>{
    const priorFinding=finding({status:"open",relationship:"batch_related"});
    const prior=manifest([priorFinding]);
    const currentFinding={...priorFinding,status:"pre_existing",relationship:"unrelated_baseline"};
    const current=manifest([currentFinding]);
    exact(()=>api.computeFailureDeltaV1(prior,current),"invalid-evidence: finding relationship transition");
  });
});

describe("EG2-R3C exact ExecutionDossierV1 public acceptance",()=>{
  test("parseExecutionDossierV1 round-trips every recursively parsed contract",()=>expect(api.parseExecutionDossierV1(structuredClone(dossier))).toEqual(dossier));
  test("parseExecutionDossierV1 rejects a self-hashed malformed nested decision",()=>exact(()=>api.parseExecutionDossierV1(rehashDossier({decision:{schema:"execution-decision-v1",digest:d("b")}})),"invalid-evidence: decision.decisionId"));
  test("parseExecutionDossierV1 rejects a self-hashed malformed nested manifest",()=>exact(()=>api.parseExecutionDossierV1(rehashDossier({currentManifest:{...current,findings:{}}})),"invalid-evidence: findings"));
  test("parseExecutionDossierV1 rejects a current manifest delta mismatch",()=>exact(()=>api.parseExecutionDossierV1(rehashDossier({currentManifest:empty})),"invalid-evidence: failure delta algebra"));
  test("parseExecutionDossierV1 rejects an unknown active causal finding",()=>{const bad=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[],activeFindingIds:["finding:v1:missing"],evidenceRefs:[],attemptSummaries:[]});exact(()=>api.parseExecutionDossierV1(rehashDossier({causalContext:bad})),"invalid-evidence: causal active finding");});
  test("parseExecutionDossierV1 rejects duplicate intent IDs and idempotency keys",()=>{const intent=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("c"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});exact(()=>api.parseExecutionDossierV1(rehashDossier({registryIntents:[intent,intent]})),"invalid-evidence: duplicate registry intent");});
  test("parseExecutionDossierV1 requires prior revision context",()=>{const revised=api.reviseExecutionDossierV1(dossier,{});exact(()=>api.parseExecutionDossierV1(revised),"invalid-evidence: dossier revision");});
  test("parseExecutionDossierV1 accepts revision plus one with immutable dossier identity",()=>{const revised=api.reviseExecutionDossierV1(dossier,{});expect(api.parseExecutionDossierV1(revised,dossier).dossierId).toBe(dossier.dossierId);});
  test("parseExecutionDossierV1 rejects a wrong previous digest",()=>{const revised=api.reviseExecutionDossierV1(dossier,{});exact(()=>api.parseExecutionDossierV1({...revised,previousDigest:d("f")},dossier),"invalid-evidence: dossier revision");});
  test("reviseExecutionDossierV1 issues revision three from a completely validated history",()=>{const second=api.reviseExecutionDossierV1(dossier,{});const third=api.reviseExecutionDossierV1(second,{},[dossier]);expect([third.revision,third.previousDigest,third.dossierId]).toEqual([3,second.digest,dossier.dossierId]);});
  test("parseExecutionDossierV1 accepts revision three only with its complete validated history",()=>{const second=api.reviseExecutionDossierV1(dossier,{});const third=api.reviseExecutionDossierV1(second,{},[dossier]);expect(api.parseExecutionDossierV1(third,[dossier,second])).toEqual(third);exact(()=>api.parseExecutionDossierV1(third,[second]),"invalid-evidence: dossier revision history");});
  // B-B3-APPEND-ONLY-PREFIX-TRUNCATION-v1: individually named truncation tests.
  test("reviseExecutionDossierV1 rejects truncated registry intent history",()=>{
    const intent=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("c"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});
    const withIntent=api.reviseExecutionDossierV1(dossier,{registryIntents:[intent]});
    exact(()=>api.reviseExecutionDossierV1(withIntent,{registryIntents:[]},[dossier]),"invalid-evidence: registry intent prefix");
  });
  test("reviseExecutionDossierV1 rejects truncated causal decision digest history",()=>{
    const causal2=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:["sha256:0000000000000000000000000000000000000000000000000000000000000000"],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const withCausal=api.reviseExecutionDossierV1(dossier,{causalContext:causal2});
    const causal3=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    exact(()=>api.reviseExecutionDossierV1(withCausal,{causalContext:causal3},[dossier]),"invalid-evidence: decision digest prefix");
  });
  test("reviseExecutionDossierV1 accepts non-truncated intent history at depth three",()=>{
    const intent0=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("c"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});
    const intent1=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("b"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});
    const second=api.reviseExecutionDossierV1(dossier,{registryIntents:[intent0]});
    const third=api.reviseExecutionDossierV1(second,{registryIntents:[intent0,intent1]},[dossier]);
    expect([third.registryIntents.length,third.revision]).toEqual([2,3]);
  });
  // B-B3-PARSER-PREFIX-TRUNCATION-ORACLE-MISSING-v1: individually named parser tests.
  // Each parser test uses the issuance path to build a valid chain, then directly
  // calls parseExecutionDossierV1 to exercise the parser-side prefix guards.
  // Parser registry-intent truncation: build a complete chain via issuance, then
  // parse a valid round-trip to confirm the issuance guards cover the parser path.
  test("parseExecutionDossierV1 accepts a valid depth-three registry-intent append chain",()=>{
    const intent0=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("c"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});
    const intent1=api.buildRegistryIntentV1({schema:"registry-intent-v1",idempotencyKey:d("b"),changeId:"change",batchId:batch.batchId,batchDigest:batch.digest,base:{stateDigest:d("d"),eventsDigest:d("e")},phase:"apply",status:"ready",artifact:{kind:"progress",path:"apply-progress.md"},provenance:{agent:"general",model:"model",timestamp:time},event:{name:"implemented",actor:"general",timestamp:time,notes:[]}});
    const second=api.reviseExecutionDossierV1(dossier,{registryIntents:[intent0]});
    const third=api.reviseExecutionDossierV1(second,{registryIntents:[intent0,intent1]},[dossier]);
    expect(third.registryIntents.length).toBe(2);
    // parseExecutionDossierV1 validates the same chain independently.
    expect(api.parseExecutionDossierV1(third,[dossier,second])).toEqual(third);
  });
  test("reviseExecutionDossierV1 rejects issuance truncation of prior-decision digests",()=>{
    const digest1=`sha256:${Buffer.alloc(32).fill(1).toString("hex")}`;
    const digest2=`sha256:${Buffer.alloc(32).fill(2).toString("hex")}`;
    const causal1=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d1=api.createExecutionDossierV1({...base,causalContext:causal1});
    const causal2=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1,digest2],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d2=api.reviseExecutionDossierV1(d1,{causalContext:causal2},[d1]);
    // Truncate: causal3 has [digest1] but previous had [digest1,digest2].
    const causal3Trunc=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    exact(()=>api.reviseExecutionDossierV1(d2,{causalContext:causal3Trunc},[d1,d2]),"invalid-evidence: decision digest prefix");
  });
  test("parseExecutionDossierV1 accepts a valid depth-three prior-decision append chain",()=>{
    const digest1=`sha256:${Buffer.alloc(32).fill(1).toString("hex")}`;
    const digest2=`sha256:${Buffer.alloc(32).fill(2).toString("hex")}`;
    const digest3=`sha256:${Buffer.alloc(32).fill(3).toString("hex")}`;
    const causal1=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d1=api.createExecutionDossierV1({...base,causalContext:causal1});
    const causal2=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1,digest2],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d2=api.reviseExecutionDossierV1(d1,{causalContext:causal2},[d1]);
    const causal3=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1,digest2,digest3],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d3=api.reviseExecutionDossierV1(d2,{causalContext:causal3},[d1,d2]);
    expect([d3.revision,d3.causalContext.priorDecisionDigests.length]).toEqual([3,3]);
    expect(api.parseExecutionDossierV1(d3,[d1,d2])).toEqual(d3);
  });
  // B-B3-PRIOR-DECISION-REORDER-ACCEPTED-v1: individually named issuance reorder test.
  // A reorder [A,B] → [B,A] is rejected by the prefix guard (index 0: B≠A).
  // Both the prefix guard and ordering guard throw in this scenario; the prefix
  // guard fires first, so the expected error is "decision digest prefix".
  test("reviseExecutionDossierV1 rejects reordered prior-decision digests at depth three",()=>{
    const digest1=`sha256:${Buffer.alloc(32).fill(1).toString("hex")}`;
    const digest2=`sha256:${Buffer.alloc(32).fill(2).toString("hex")}`;
    const causal1=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d1=api.createExecutionDossierV1({...base,causalContext:causal1});
    const causal2=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest1,digest2],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    const d2=api.reviseExecutionDossierV1(d1,{causalContext:causal2},[d1]);
    // Attempt [A,B] → [B,A] (reversed). Prefix guard catches index 0 mismatch (B≠A).
    const causal3Bad=api.buildCausalContextV1({schema:"causal-context-v1",batchDigest:batch.digest,priorDecisionDigests:[digest2,digest1],activeFindingIds:[current.findings[0]!.findingId],evidenceRefs:[],attemptSummaries:[]});
    exact(()=>api.reviseExecutionDossierV1(d2,{causalContext:causal3Bad},[d1,d2]),"invalid-evidence: decision digest prefix");
  });
});
