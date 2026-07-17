import type {ApplyBatchContractV1,BatchId} from "./apply-batch"; import {assertBatchReferenceV1} from "./apply-batch";
import {assertDigest,assertExactKeys,assertId,assertNoUnsafeDiagnosticContent,assertSafeDiagnosticString,cloneCanonical,codeValue,deepFreeze,denseArray,enumValue,repositoryPath,redactBoundedText,sha256Digest,stringArray,stringValue,timestampValue,type RepositoryPathContextV1,type Sha256Digest} from "./canonical";
import type {RepairIncident} from "./repair-incident";
export type FindingId=`finding:v1:${string}`; export type FailureSeverity="critical"|"high"|"medium"|"low"; export type FailureRootCause="implementation"|"environment"|"transport"|"capability"|"oracle"|"requirement"|"architecture"|"batch_shape"|"authorization"|"security"|"git_safety"|"unknown"; export type FailureRelationshipV1="batch_related"|"unrelated_baseline";
export interface SafeEvidenceRefV1{kind:string;checkId:string;artifact:string;excerpt?:string;resultCode?:string}
export interface FailureFindingV1{findingId:FindingId;fingerprint:Sha256Digest;batchId:BatchId;batchDigest:Sha256Digest;sourcePhase:"apply"|"verify"|"review";sourceArtifact:string;severity:FailureSeverity;category:string;rootCause:FailureRootCause;requirementIds:readonly string[];taskIds:readonly string[];locationKeys:readonly string[];oracleId:string;isSecurityRelevant:boolean;status:"open"|"resolved"|"pre_existing"|"out_of_scope";relationship?:FailureRelationshipV1;evidence:readonly SafeEvidenceRefV1[];remediationCode?:string;summary?:string}
export interface FailureManifestV1{schema:"failure-manifest-v1";manifestId:`manifest:v1:${string}`;digest:Sha256Digest;changeId:string;batchId:BatchId;batchDigest:Sha256Digest;producerRole:"apply"|"verify"|"review";producerInstanceId:string;findings:readonly FailureFindingV1[];producedAt:string}
export type FailureFindingInputV1=Omit<FailureFindingV1,"findingId"|"fingerprint"|"relationship">&{relationship?:FailureRelationshipV1};
export interface FailureManifestInputV1{schema:"failure-manifest-v1";changeId:string;batch:ApplyBatchContractV1;producerRole:"apply"|"verify"|"review";producerInstanceId:string;findings:readonly FailureFindingInputV1[];producedAt:string;repositoryRoot?:string}
const findingKeys=["batchId","batchDigest","sourcePhase","sourceArtifact","severity","category","rootCause","requirementIds","taskIds","locationKeys","oracleId","isSecurityRelevant","status","relationship","evidence","remediationCode","summary"];
function evidence(raw:unknown,ctx:RepositoryPathContextV1):SafeEvidenceRefV1[]{const byTuple=new Map<string,{value:SafeEvidenceRefV1;digest:Sha256Digest}>();for(const [i,item] of denseArray(raw,"evidence").entries()){assertExactKeys(item,["kind","checkId","artifact","excerpt","resultCode"],"evidence fields");const value={kind:codeValue(item.kind,`evidence[${i}].kind`),checkId:codeValue(item.checkId,`evidence[${i}].checkId`),artifact:repositoryPath(item.artifact,ctx,`evidence[${i}].artifact`),...(item.excerpt===undefined?{}:{excerpt:redactBoundedText(stringValue(item.excerpt,`evidence[${i}].excerpt`,1024))}),...(item.resultCode===undefined?{}:{resultCode:codeValue(item.resultCode,`evidence[${i}].resultCode`)})};const tuple=`${value.kind}\0${value.checkId}\0${value.artifact}`,full=sha256Digest(value),prior=byTuple.get(tuple);if(prior&&prior.digest!==full)throw new Error("invalid-evidence: evidence-collision");if(!prior)byTuple.set(tuple,{value,digest:full});}return [...byTuple.values()].sort((a,b)=>a.digest.localeCompare(b.digest)).map(x=>x.value);}
function buildFinding(raw: unknown, batch: ApplyBatchContractV1, ctx: RepositoryPathContextV1): FailureFindingV1 {
  assertExactKeys(raw, findingKeys, "failure finding fields");
  denseArray(raw.evidence, "evidence").forEach((item) => assertExactKeys(item, ["kind", "checkId", "artifact", "excerpt", "resultCode"], "evidence fields"));
  try { assertNoUnsafeDiagnosticContent(raw, "failure finding"); } catch { throw new Error("unsafe-diagnostic-content: failure finding"); }
  assertBatchReferenceV1({ batchId: stringValue(raw.batchId, "finding.batchId"), batchDigest: stringValue(raw.batchDigest, "finding.batchDigest") }, batch);
  const status = enumValue(raw.status, ["open", "resolved", "pre_existing", "out_of_scope"], "finding.status");
  const relationship = raw.relationship === undefined ? "batch_related" : enumValue(raw.relationship, ["batch_related", "unrelated_baseline"], "finding.relationship");
  if (relationship === "unrelated_baseline" && status !== "pre_existing") throw new Error("invalid-evidence: finding.relationship");
  const ev = evidence(raw.evidence, ctx); if (relationship === "unrelated_baseline" && !ev.length) throw new Error("invalid-evidence: finding.relationship");
  const requirementIds = stringArray(raw.requirementIds, "finding.requirementIds", true), taskIds = stringArray(raw.taskIds, "finding.taskIds", true);
  const locationKeys = denseArray(raw.locationKeys, "finding.locationKeys").map((v, i) => stringValue(v, `finding.locationKeys[${i}]`)).map((v, i) => v.includes(":") && !/^[A-Za-z]:[\\/]/.test(v) ? v : repositoryPath(v, ctx, `finding.locationKeys[${i}]`)).sort();
  const category = codeValue(raw.category, "finding.category").toLowerCase(), oracleId = codeValue(raw.oracleId, "finding.oracleId"), sourceArtifact = repositoryPath(raw.sourceArtifact, ctx, "finding.sourceArtifact");
  const identity = { batchDigest: batch.digest, requirementIds, taskIds, category, locationKeys, oracleId }, fingerprint = sha256Digest(identity);
  const result = { findingId: `finding:v1:${fingerprint.slice(7, 39)}` as FindingId, fingerprint, batchId: batch.batchId, batchDigest: batch.digest, sourcePhase: enumValue(raw.sourcePhase, ["apply", "verify", "review"], "finding.sourcePhase"), sourceArtifact, severity: enumValue(raw.severity, ["critical", "high", "medium", "low"], "finding.severity"), category, rootCause: enumValue(raw.rootCause, ["implementation", "environment", "transport", "capability", "oracle", "requirement", "architecture", "batch_shape", "authorization", "security", "git_safety", "unknown"], "finding.rootCause"), requirementIds, taskIds, locationKeys, oracleId, isSecurityRelevant: typeof raw.isSecurityRelevant === "boolean" ? raw.isSecurityRelevant : (() => { throw new Error("invalid-evidence: finding.isSecurityRelevant"); })(), status, relationship, evidence: ev, ...(raw.remediationCode === undefined ? {} : { remediationCode: codeValue(raw.remediationCode, "finding.remediationCode") }), ...(raw.summary === undefined ? {} : { summary: redactBoundedText(stringValue(raw.summary, "finding.summary", 1024)) }) };
  return cloneCanonical(result);
}
export function buildFailureManifestV1(input: FailureManifestInputV1): FailureManifestV1 {
  if (input?.schema !== "failure-manifest-v1") throw new Error("unsupported-contract-version");
  assertExactKeys(input, ["schema", "changeId", "batch", "producerRole", "producerInstanceId", "findings", "producedAt", "repositoryRoot"], "failure manifest input");
  const ctx = { repositoryRoot: input.repositoryRoot ?? "." }, findings = denseArray(input.findings, "findings").map(v => buildFinding(v, input.batch, ctx)).sort((a, b) => a.findingId.localeCompare(b.findingId));
  for (let i = 1; i < findings.length; i++) if (findings[i]!.findingId === findings[i - 1]!.findingId) throw new Error(findings[i]!.fingerprint === findings[i - 1]!.fingerprint ? "invalid-evidence: duplicate-finding-identity" : "invalid-evidence: finding-id-collision");
  const payload = { schema: "failure-manifest-v1" as const, changeId: codeValue(input.changeId, "manifest.changeId"), batchId: input.batch.batchId, batchDigest: input.batch.digest, producerRole: enumValue(input.producerRole, ["apply", "verify", "review"], "manifest.producerRole"), producerInstanceId: codeValue(input.producerInstanceId, "manifest.producerInstanceId"), findings, producedAt: timestampValue(input.producedAt, "manifest.producedAt") }, digest = sha256Digest(payload);
  return deepFreeze({ ...payload, manifestId: `manifest:v1:${digest.slice(7, 39)}`, digest }) as FailureManifestV1;
}
export function parseFailureManifestV1(value: unknown, batch: ApplyBatchContractV1): FailureManifestV1 {
  assertExactKeys(value, ["schema", "manifestId", "digest", "changeId", "batchId", "batchDigest", "producerRole", "producerInstanceId", "findings", "producedAt"], "failure manifest");
  assertId(value.manifestId, "manifest:v1:", "manifest.manifestId");
  assertDigest(value.digest, "manifest.digest");
  if (value.batchId !== batch.batchId || value.batchDigest !== batch.digest) throw new Error("batch-reference-mismatch");
  const rawFindings = denseArray(value.findings, "findings").map((raw, index) => {
    assertExactKeys(raw, [...findingKeys, "findingId", "fingerprint"], `findings[${index}]`);
    assertId(raw.findingId, "finding:v1:", `findings[${index}].findingId`);
    assertDigest(raw.fingerprint, `findings[${index}].fingerprint`);
    const { findingId, fingerprint, ...input } = raw;
    return { input, findingId, fingerprint };
  });
  const parsed = buildFailureManifestV1({
    schema: value.schema as "failure-manifest-v1",
    changeId: value.changeId as string,
    batch,
    producerRole: value.producerRole as "apply" | "verify" | "review",
    producerInstanceId: value.producerInstanceId as string,
    findings: rawFindings.map((entry) => entry.input) as FailureFindingInputV1[],
    producedAt: value.producedAt as string,
  });
  for (let index = 0; index < parsed.findings.length; index++) {
    const expected = parsed.findings[index]!;
    const supplied = rawFindings.find((entry) => entry.findingId === expected.findingId);
    if (!supplied || supplied.fingerprint !== expected.fingerprint) throw new Error("invalid-evidence: failure finding identity");
  }
  if (value.digest !== parsed.digest || value.manifestId !== parsed.manifestId) throw new Error("invalid-evidence: failure manifest digest");
  return parsed;
}
export function adaptRepairIncidentToFailureManifestV1(incident:RepairIncident,batch:ApplyBatchContractV1,producedAt:string):FailureManifestV1{return buildFailureManifestV1({schema:"failure-manifest-v1",changeId:incident.changeId,batch,producerRole:"apply",producerInstanceId:"legacy-repair-incident",producedAt,findings:incident.failures.map(f=>({batchId:batch.batchId,batchDigest:batch.digest,sourcePhase:f.sourcePhase,sourceArtifact:f.evidence.artifact,severity:f.nextAction==="escalate"||f.nextAction==="block"?"high":"medium",category:f.errorClass,rootCause:f.errorClass==="environment"?"environment":"implementation",requirementIds:f.requirementIds??[f.failingContract],taskIds:[f.taskGroup],locationKeys:f.changedFiles?.length?f.changedFiles:[f.failingContract],oracleId:f.failingContract,isSecurityRelevant:false,status:f.status==="resolved"?"resolved":f.status==="pre_existing"?"pre_existing":f.status==="out_of_scope"?"out_of_scope":"open",relationship:"batch_related",evidence:[{kind:"legacy-repair-incident",checkId:f.id,artifact:f.evidence.artifact,excerpt:f.evidence.excerpt,resultCode:f.evidence.latestResult}],remediationCode:`LEGACY_${f.nextAction.toUpperCase()}`}))});}
