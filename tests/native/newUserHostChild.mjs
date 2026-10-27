// Synthetic-only fresh OS-process evidence for tagged new-user startup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { webcrypto, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const load = createRequire(import.meta.url), ts = load('typescript');
Module._extensions['.ts'] = (entry, file) => entry._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
 fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const statePath = process.argv[2], data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
assert.equal(data.syntheticOnly, true); assert.notEqual(process.pid, data.parentPid);
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN = 'https://native-api.example.invalid';
let legacyAccess = 0;
const source = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
 legacyAccess++;
 if (!data.allowEmptySource) throw Error('Synthetic forbidden legacy fallback');
 return { get length() { return source.size; }, key: i => [...source.keys()][i] ?? null, getItem: key => source.get(key) ?? null,
   setItem() { throw Error('Synthetic source write forbidden'); }, removeItem() { throw Error('Synthetic source removal forbidden'); } };
} });
const worker = `
import sys,json,sqlite3
c=None
for line in sys.stdin:
 try:
  r=json.loads(line);k=r['kind'];v={}
  if k=='open':c=sqlite3.connect(sys.argv[1],isolation_level=None);c.row_factory=sqlite3.Row
  elif k=='close':
   if c is not None:c.close();c=None
  elif k=='query':v={'values':[dict(x) for x in c.execute(r['sql'],r.get('values',[]))]}
  elif k in ['execute','run']:
   if r.get('transaction'):c.execute('BEGIN')
   try:
    q=c.execute(r['sql'],r.get('values',[]));v={'changes':{'changes':max(0,q.rowcount)}}
    if k=='run':v['changes'].update({'lastId':q.lastrowid,'values':[]})
    if r.get('transaction'):c.execute('COMMIT')
   except:
    if r.get('transaction'):c.execute('ROLLBACK')
    raise
  elif k in ['begin','commit','rollback']:c.execute(k.upper());v={'changes':{'changes':0}}
  print(json.dumps({'ok':True,'value':v}),flush=True)
 except:print(json.dumps({'ok':False}),flush=True)
`;
const child = spawn('python3', ['-u', '-c', worker, data.file], { stdio: ['pipe', 'pipe', 'ignore'] });
const lines = createInterface({ input: child.stdout }), pending = [];
let stopped = false, host;
lines.on('line', raw => { const waiter = pending.shift(), reply = JSON.parse(raw); if (waiter) { if (reply.ok) waiter.resolve(reply.value); else waiter.reject(Error('Synthetic SQLite refused')); } });
const stop = () => { stopped = true; while (pending.length) pending.shift().reject(Error('Synthetic SQLite worker ended')); };
child.on('error', stop); child.on('exit', stop);
const io = (kind, sql, values, transaction) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ kind, sql, values, transaction }) + '\n'); });

const values = new Map(data.protectedValues), requests = [];
const persist = result => { data.protectedValues = [...values]; data.result = { pid: process.pid, legacyAccess, requests, ...result }; fs.writeFileSync(statePath, JSON.stringify(data)); };
let bootstrapIntercepted = false;
const connection = { open: async () => { await io('open'); }, close: async () => { await io('close'); }, query: (sql, args) => io('query', sql, args),
 execute: (sql, transaction) => io('execute', sql, [], transaction),
 run: async (sql, args, transaction) => {
   const result = await io('run', sql, args, transaction);
   if (data.interrupt === 'before_commit' && !bootstrapIntercepted && args?.[0] === 'q') { bootstrapIntercepted = true; persist({ interrupted: 'before_commit' }); process.exit(0); }
   return result;
 },
 beginTransaction: () => io('begin'), rollbackTransaction: () => io('rollback'),
 commitTransaction: async () => {
   const result = await io('commit');
   const observed = await io('query', "SELECT value FROM curling_credential_meta WHERE slot='q'", []);
   const phase = observed.values.length ? JSON.parse(observed.values[0].value).phase : null;
   if ((data.interrupt === 'after_commit' || data.interrupt === 'phase_' + phase) && !bootstrapIntercepted) { bootstrapIntercepted = true; persist({ interrupted: data.interrupt }); process.exit(0); }
   return result;
 } };
const binding = { failedWriteMayLosePreviousValue: true, configure: async () => {}, inventory: async () => ({ kind: 'complete', keys: [...values.keys()].sort() }),
 read: async key => values.has(key) ? { kind: 'value', value: values.get(key) } : { kind: 'established_absent' },
 write: async (key, value) => { values.set(key, value); if (data.interrupt === 'after_manifest' && key.startsWith('m1.')) { persist({ interrupted: 'after_manifest' }); process.exit(0); } }, remove: async key => ({ kind: values.delete(key) ? 'deleted' : 'nothing_to_delete' }) };
const facts = data.facts;
const account = { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.invalid', aud: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} };
const session = () => ({ access_token: 'SYNTHETIC_HOST_ACCESS', refresh_token: 'SYNTHETIC_HOST_REFRESH', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: account });
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
const fetch = async request => {
 assert.equal(request.credentials,'omit'); assert.equal(request.redirect,'error'); const name = new URL(request.url).pathname.split('/').pop(); requests.push(name);
 if (name === 'get_current_legal_documents') return response([
 { id: facts.current_terms_document_id, kind: 'terms_of_service', version_label: facts.current_terms_version_label, document_url:'https://legal.example.invalid/terms',effective_at:'2026-01-01T00:00:00Z' },
 { id: facts.current_privacy_document_id, kind: 'privacy_notice', version_label: facts.current_privacy_version_label, document_url:'https://legal.example.invalid/privacy',effective_at:'2026-01-01T00:00:00Z' }]);
 if(name==='otp') return response({}); if(name==='verify'||name==='token')return response(session());
 if(name==='logout')return new Response(null,{status:204});
 assert.equal(request.headers.get('Authorization'),'Bearer SYNTHETIC_HOST_ACCESS');
 if(name==='ensure_my_profile')return response({id:facts.profile_id,display_name:'Synthetic Athlete'});
 if(name==='get_my_account_deletion_control')return response({profile_id:facts.profile_id,revision:0,pending:null});
 return response(facts);
};
try {
 const config = load(path.join(process.cwd(),'src/lib/supabase/nativeProviderConfiguration.ts'));
 const prepared = await config.prepareNativeProviderConfiguration(data.config); assert.equal(prepared.ok,true);
 const hostModule = load(path.join(process.cwd(),'src/lib/supabase/supabaseAuthService.ts'));
 const made = await hostModule.createConfiguredNewUserNativeSportingIdentityHost(prepared.value, {
  migration: { sqlite: { databaseName: data.databaseName, detectPlatform:()=> 'ios', engine:{createConnection:async()=>connection,closeConnection:async()=>{await io('close');}} },
    protectedBinding: binding, detectPlatform:()=> 'ios', generateUuid:randomUUID,now:()=> '2026-10-27T00:00:00Z',
    limits:{checkpointBatchKeyLimit:20,latchWriteAttemptLimit:1,maxPlansPerRun:100,protocolStepLimit:100,faultWriteAttemptLimit:1} },
  fetch,callbackUrlAccess:{readCurrentUrl:()=> 'https://app.example.invalid/',replaceCurrentUrl:()=>{}} });
 assert.equal(made.ok,true);host=made.host; const started=await host.start();
 if(data.expectWaiting){assert.equal(started.outcome,'waiting');assert.equal(requests.length,0);persist({waiting:started.code,cleanup:await host.dispose()});}
 else {
  assert.equal(started.outcome,'ready');const runtime=started.runtime;
  const startup=await runtime.startUpOnce();
  if(data.freshOtp){
   assert.equal(startup.verdict.kind,'signed_out');assert.equal((await runtime.coordinator.requestEmailOtp(account.email)).kind,'otp_requested');
   const verified=await runtime.coordinator.verifyEmailOtp(account.email,'123456');assert.equal(verified.kind,'resolved');assert.equal(verified.gate.kind,'ready_online');
  } else assert.equal(startup.verdict.kind,'ready_online');
  const scope=runtime.createLocalSportingScope(facts.profile_id);assert.ok(scope);assert.equal(runtime.createLocalSportingScope('99999999-9999-4999-8999-999999999999'),null);
  const current=await scope.repositories.session.loadCurrent();
  if(data.expectSession){assert.equal(current.status,'value');assert.equal(current.value.id,data.expectSession);}
  let savedId=null;
  if(data.writeSession){const value=load(path.join(process.cwd(),'src/lib/sessionMigration.ts')).createNewSession();value.title='Synthetic fresh-process training';assert.deepEqual(await scope.repositories.session.saveCurrent(value),{ok:true});savedId=value.id;}
  const cleanup=await host.dispose();assert.deepEqual(cleanup,{ok:true});
  if(!data.allowEmptySource)assert.equal(legacyAccess,0);
  persist({startup:startup.verdict.kind,readSession:current.status==='value'?current.value.id:null,savedId,cleanup});
 }
} finally {
 if(host)await host.dispose();lines.close();child.stdin.end();if(!stopped)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
}
