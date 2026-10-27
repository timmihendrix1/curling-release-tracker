// Adopted independent S6b regression witnesses; original assertions retained.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {evaluateInstallationTransferDomainsV3} from '../installationTransferSemantics';
import {encodeInstallationTransferV3} from '../installationTransferV3';
import {TRANSFER_SPORTING_SUFFIXES,TRANSFER_IDENTITY_KEYS,TRANSFER_LEGACY_KEY} from '../installationTransferInventory';
import * as scoped from '../profileScopedSportingPersistence';
import {createDefaultHistoryFilters} from '../../historyAnalysis';
import {createTestRun,abandonTestRun} from '../../assessment/__tests__/testHelpers';
import {transitionAssessmentRun} from '../../assessment/run';
import type {RemovableStorageAdapter} from '../types';
type Evaluation=Awaited<ReturnType<typeof evaluateInstallationTransferDomainsV3>>;
type Report=Extract<Evaluation,{ok:true}>['value'];
const id='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const key=(i:number)=>`curling.sporting.profile.v1.${id}.${TRANSFER_SPORTING_SUFFIXES[i]}`;
async function wire(raws:Record<string,string>){const names=[...TRANSFER_IDENTITY_KEYS,TRANSFER_LEGACY_KEY,...TRANSFER_SPORTING_SUFFIXES.map((_,i)=>key(i))].sort();const r=await encodeInstallationTransferV3(JSON.stringify({schemaVersion:3,transferId:'30000000-0000-4000-8000-000000000003',snapshotId:'40000000-0000-4000-8000-000000000004',sourceBuild:{version:'independent',build:'1'},catalogContractId:'independent',listing:{schemaVersion:1,keys:Object.keys(raws).sort()},observations:names.map(k=>Object.hasOwn(raws,k)?{key:k,state:'present',raw:raws[k]}:{key:k,state:'absent'}),sourceControl:{domain:'absent',credential:'excluded'},snapshotState:'synthetic_frozen'}));if(!r.ok)throw Error('archive refused '+r.code);return r.value.wire;}
async function evaluate(raws:Record<string,string>){const r=await evaluateInstallationTransferDomainsV3(await wire(raws));if(!r.ok)throw Error('eval refused '+r.code);return r.value;}
const sync=()=>({schemaVersion:6,entries:[] as unknown[],teamEntries:[],teamEligibilitySnapshots:[],activeTeamExerciseDraft:null,teamExerciseResults:[]});
const find=(r:Report,name:string)=>r.profiles[0].domains.find(d=>d.domain===name)!;
const originalFactory=scoped.createProfileScopedSportingRepositories;
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([1,2,3,4,5,6])('does not classify a coerced hash array as supported sync schema%d',async version=>{const s:Record<string,unknown>={schemaVersion:version,entries:[{recordKind:'training_session',recordId:other,schemaVersion:1,payload:'synthetic',contentSha256:['a'.repeat(64)],recordedAt:'2026-10-01T00:00:00Z',desired:'present',status:'synced'}]};if(version>=2)s.teamEntries=[];if(version>=3)s.teamEligibilitySnapshots=[];if(version>=4)s.activeTeamExerciseDraft=null;if(version>=5)s.teamExerciseResults=[];expect(find(await evaluate({[key(12)]:JSON.stringify(s)}),'cloud_sync').status).toBe('preserved_unusable');});
it('preserves unrelated domains after an ordinary known-key remove failure',async()=>{vi.spyOn(scoped,'createProfileScopedSportingRepositories').mockImplementation((p,a)=>{const actual=originalFactory(p,a);return {...actual,historyFilters:{...actual.historyFilters,async load(){await (a as RemovableStorageAdapter).remove(key(2));return actual.historyFilters.load();}}};});const r=await evaluate({[key(2)]:JSON.stringify(createDefaultHistoryFilters()),[key(4)]:'{"schemaVersion":2,"plans":[]}',[key(7)]:'true'});expect(find(r,'history_filters').status).toBe('preserved_unusable');expect(find(r,'training_plans').status).toBe('preserved_candidate');expect(find(r,'show_introduction').status).toBe('preserved_candidate');});
it('rejects a history-dropping inherited JSON hook rather than accepting corrupted overlay ACKs',async()=>{const started=transitionAssessmentRun(createTestRun(),'warmup');if(!started.ok)throw null;const run=abandonTestRun(started.value),encoded=await wire({[key(3)]:JSON.stringify({schemaVersion:1,history:[run]})});let seen:string|null=null;vi.spyOn(scoped,'createProfileScopedSportingRepositories').mockImplementation((p,a)=>{const actual=originalFactory(p,a);return {...actual,assessment:{...actual.assessment,async loadState(){const value=await actual.assessment.loadState();const read=await a!.get(key(11));if(read.status==='value')seen=read.value;return value;}}};});const previous=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');let result:Evaluation|undefined;try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value:function(this:Record<string,unknown>){return this.schemaVersion===1&&Array.isArray(this.history)?{schemaVersion:1,history:[]}:this;}});result=await evaluateInstallationTransferDomainsV3(encoded);}finally{if(previous)Object.defineProperty(Object.prototype,'toJSON',previous);else Reflect.deleteProperty(Object.prototype,'toJSON');}expect(seen).toBe('{"schemaVersion":1,"history":[]}');expect(result?.ok).toBe(true);if(!result||!result.ok)throw Error("synthetic evaluation refused");expect(find(result.value,'assessment').status).toBe('preserved_unusable');});
it('controls genuine empty sync and ordinary combined Assessment recovery',async()=>{const r=await evaluate({[key(12)]:JSON.stringify(sync()),[key(3)]:'{"schemaVersion":1,"history":[]}'});expect(find(r,'cloud_sync').status).toBe('preserved_candidate');expect(find(r,'assessment').status).toBe('recovery_required');});
it.each(['session','bundle'])('rejects a coerced Team %s hash without changing opaque payload policy',async mode=>{const sessionId='50000000-0000-4000-8000-000000000005',teamId='60000000-0000-4000-8000-000000000006',execution='70000000-0000-4000-8000-000000000007',result='80000000-0000-4000-8000-000000000008';const parent:Record<string,unknown>={entryKind:'team_exercise_session',sessionId,teamId,schemaVersion:1,coordinationPayload:'opaque',startedAt:'2026-10-01T00:00:00Z',completedAt:'2026-10-01T01:00:00Z',participantProfileIds:[id],trainingAthleteProfileIds:[id],executionIds:[execution],contentSha256:'a'.repeat(64),status:'pending'};const child:Record<string,unknown>={entryKind:'team_exercise_bundle',bundleId:other,sessionId,athleteProfileId:id,schemaVersion:1,resultPayload:'opaque',recordedAt:'2026-10-01T00:30:00Z',resultIds:[result],executionIds:[execution],contentSha256:'b'.repeat(64),status:'pending'};const s:Record<string,unknown>={...sync(),teamEntries:[parent,child]};expect(find(await evaluate({[key(12)]:JSON.stringify(s)}),'cloud_sync').status).toBe('preserved_candidate');(mode==='session'?parent:child).contentSha256=['a'.repeat(64)];expect(find(await evaluate({[key(12)]:JSON.stringify(s)}),'cloud_sync').status).toBe('preserved_unusable');});
it('rejects corrupted shadow recovery writes behind a genuine full split',async()=>{const started=transitionAssessmentRun(createTestRun(),'warmup');if(!started.ok)throw null;const history=[abandonTestRun(started.value)],encoded=await wire({[key(3)]:JSON.stringify({schemaVersion:1,history}),[key(10)]:'{"schemaVersion":1}',[key(11)]:'{"schemaVersion":1,"history":[]}'});const previous=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');let r:Evaluation|undefined;try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value:function(this:Record<string,unknown>){return this.schemaVersion===1&&Array.isArray(this.history)?{schemaVersion:1,history:[]}:this;}});r=await evaluateInstallationTransferDomainsV3(encoded);}finally{if(previous)Object.defineProperty(Object.prototype,'toJSON',previous);else Reflect.deleteProperty(Object.prototype,'toJSON');}expect(r?.ok).toBe(true);if(!r||!r.ok)throw Error("synthetic evaluation refused");expect(find(r.value,'assessment').status).toBe('preserved_unusable');});
it('does not reject a valid full split merely because an unused global toJSON exists',async()=>{const encoded=await wire({[key(10)]:'{"schemaVersion":1}',[key(11)]:'{"schemaVersion":1,"history":[]}'});const previous=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON');let r:Evaluation|undefined;try{Object.defineProperty(Object.prototype,'toJSON',{configurable:true,value:function(){throw Error('not required')}});r=await evaluateInstallationTransferDomainsV3(encoded);}finally{if(previous)Object.defineProperty(Object.prototype,'toJSON',previous);else Reflect.deleteProperty(Object.prototype,'toJSON');}expect(r?.ok).toBe(true);if(!r||!r.ok)throw Error("synthetic evaluation refused");expect(find(r.value,'assessment').status).toBe('preserved_candidate');});

function terminal() {
  const started=transitionAssessmentRun(createTestRun(),'warmup'); if(!started.ok)throw null;
  return abandonTestRun(started.value);
}
async function withHook(encoded:string, prototype:object, hook:(this:Record<string,unknown>)=>unknown) {
  const previous=Object.getOwnPropertyDescriptor(prototype,'toJSON'); let result:Evaluation;
  try { Object.defineProperty(prototype,'toJSON',{configurable:true,value:hook}); result=await evaluateInstallationTransferDomainsV3(encoded); }
  finally { if(previous)Object.defineProperty(prototype,'toJSON',previous);else Reflect.deleteProperty(prototype,'toJSON'); }
  expect(result.ok).toBe(true);if(!result.ok)throw null;return result.value;
}
it.each(['draft','history'])('rejects history-dropping hooks with a partial exact %s half',async half=>{
  const history=[terminal()],raws:Record<string,string>={[key(3)]:JSON.stringify({schemaVersion:1,history})};
  if(half==='draft')raws[key(10)]='{"schemaVersion":1}';else raws[key(11)]=JSON.stringify({schemaVersion:1,history});
  const encoded=await wire(raws);
  const report=await withHook(encoded,Object.prototype,function(){return this.schemaVersion===1&&Array.isArray(this.history)?{schemaVersion:1,history:[]}:this;});
  expect(find(report,'assessment').status).toBe('preserved_unusable');
});
it('rejects an inherited array hook that corrupts actual recovery bytes',async()=>{
  const encoded=await wire({[key(3)]:JSON.stringify({schemaVersion:1,history:[terminal()]})});
  const report=await withHook(encoded,Array.prototype,function(){return [];});
  expect(find(report,'assessment').status).toBe('preserved_unusable');
});
it('does not clear an unequal duplicate merely because a hook makes both runs stringify alike',async()=>{
  const run=terminal(),changed={...run,notes:'a different synthetic observation'};
  const encoded=await wire({[key(10)]:JSON.stringify({schemaVersion:1,currentRun:changed}),[key(11)]:JSON.stringify({schemaVersion:1,history:[run]})});
  const report=await withHook(encoded,Object.prototype,function(){return this.id===run.id?{id:run.id}:this;});
  expect(find(report,'assessment').status).toBe('preserved_unusable');
});
it('accepts property order and full Unicode through genuine partial recovery',async()=>{
  const run=terminal();run.notes='synthetic \0\b\t\n\f\r"\\ 🥌 \ud800 \udc00';
  const history=[run],draft=JSON.stringify({schemaVersion:1,currentRun:undefined});
  const report=await evaluate({[key(3)]:JSON.stringify({history,schemaVersion:1}),[key(10)]:draft});
  expect(find(report,'assessment').status).toBe('recovery_required');
});
it('rejects a recovery write that loses numeric negative zero',async()=>{
  const run=terminal();
  const raw=JSON.stringify({schemaVersion:1,history:[run]}).replace('"interruptionCount":0','"interruptionCount":-0');
  expect(raw).toContain('"interruptionCount":-0');
  expect(find(await evaluate({[key(3)]:raw}),'assessment').status).toBe('preserved_unusable');
});
it('accepts repeated acyclic references in owned loader state',async()=>{
  const first=terminal(),second=terminal();
  vi.spyOn(scoped,'createProfileScopedSportingRepositories').mockImplementation((profile,adapter)=>{
    const actual=originalFactory(profile,adapter);
    return {...actual,assessment:{...actual.assessment,async loadState(){const loaded=await actual.assessment.loadState();if(loaded.status==='value'&&loaded.value.state.history.length===2)loaded.value.state.history[1].templateSnapshot=loaded.value.state.history[0].templateSnapshot;return loaded;}}};
  });
  expect(find(await evaluate({[key(3)]:JSON.stringify({schemaVersion:1,history:[first,second]})}),'assessment').status).toBe('recovery_required');
});
it('rejects an accessor in the owned serialization input without invoking it as a JSON hook',async()=>{
  const run=terminal();run.notes='synthetic';let reads=0;
  vi.spyOn(scoped,'createProfileScopedSportingRepositories').mockImplementation((profile,adapter)=>{
    const actual=originalFactory(profile,adapter);
    return {...actual,assessment:{...actual.assessment,async loadState(){const loaded=await actual.assessment.loadState();if(loaded.status==='value')Object.defineProperty(loaded.value.state.history[0],'notes',{enumerable:true,get(){reads++;return 'synthetic';}});return loaded;}}};
  });
  const report=await evaluate({[key(3)]:JSON.stringify({schemaVersion:1,history:[run]})});
  expect(find(report,'assessment').status).toBe('preserved_unusable');expect(reads).toBe(2);
});
it('bounds escaped output before primitive encoding of a large lone-surrogate string',async()=>{
  const run=terminal();run.notes='placeholder';
  const raw=JSON.stringify({schemaVersion:1,history:[run]}).replace('"notes":"placeholder"','"notes":"'+'\ud800'.repeat(180_000)+'"');
  expect(raw.length).toBeLessThan(1_048_576);
  expect(find(await evaluate({[key(3)]:raw}),'assessment').status).toBe('preserved_unusable');
});
