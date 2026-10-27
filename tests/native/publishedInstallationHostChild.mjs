// Synthetic-only real fresh-process SDK/SQLite probe. No actual device or account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { webcrypto, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const load = createRequire(import.meta.url);
const ts = load('typescript');
Module._extensions['.ts'] = (entry, file) => entry._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const dataPath = process.argv[2], data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
assert.equal(data.syntheticOnly, true);
assert.notEqual(process.pid, data.parentPid);
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
// Test configuration only, never a configured value read from the environment.
process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN = 'https://native-api.example.invalid';
let legacyAccess = 0;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { legacyAccess++; throw Error('Synthetic legacy access forbidden'); } });
const uiEnvironment = data.ui ? (await import('./publishedInstallationAppUi.mjs')).setupPublishedUiEnvironment(load) : null;
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
let stopped = false, host, publishedOwner;
lines.on('line', raw => { const waiter = pending.shift(), reply = JSON.parse(raw); if (waiter) { if (reply.ok) waiter.resolve(reply.value); else waiter.reject(Error('Synthetic SQLite refused')); } });
const stop = () => { stopped = true; while (pending.length) pending.shift().reject(Error('Synthetic SQLite worker ended')); };
child.on('error', stop); child.on('exit', stop);
const io = (kind, sql, values, transaction) => new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ kind, sql, values, transaction }) + '\n'); });
const wrongProfileIo = [];
const sportingPrefix = 'curling.sporting.profile.v1.', selectedProfile = data.currentProfile ?? data.facts.profile_id;
const originalForeignCopies = new Map(); let publicationCopies = 0;
if (data.importUi) {
  const { encodeTransferCodeUnits } = load(path.join(process.cwd(), 'src/lib/persistence/installationTransferCodeUnits.ts'));
  for (const [key, raw] of Object.entries(data.expectedImportRaws ?? {})) if (key.startsWith(sportingPrefix) && key.slice(sportingPrefix.length, sportingPrefix.length + 36) !== selectedProfile) originalForeignCopies.set(key, encodeTransferCodeUnits(raw));
}
const observeProfileIo = (sql, values) => {
  if (!data.ui || !sql.includes('installation_transfer_live_v1')) return;
  for (const value of values ?? []) if (typeof value === 'string' && value.startsWith(sportingPrefix) && value.slice(sportingPrefix.length, sportingPrefix.length + 36) !== selectedProfile) {
    // Initial publication MUST copy every original Profile. Admit only one exact
    // original key/value INSERT, never reads, later writes or arbitrary values.
    if (data.importUi && sql === 'INSERT INTO installation_transfer_live_v1 (key,value_ascii) VALUES (?,?)' && values.length === 2 && values[0] === value && originalForeignCopies.get(value) === values[1]) { originalForeignCopies.delete(value); publicationCopies++; }
    else wrongProfileIo.push('foreign-profile');
  }
};
let domainFault = false, physicalCloses = 0, uiReadHeld = false, enterUiRead, releaseUiRead;
const enteredUiRead = new Promise(resolve => { enterUiRead = resolve; }), heldUiRead = new Promise(resolve => { releaseUiRead = resolve; });
const connection = { open: async () => { await io('open'); }, close: async () => { physicalCloses++; await io('close'); },
  query: (sql, values) => { observeProfileIo(sql, values); if (domainFault && sql.includes('installation_transfer_live_v1') && sql.includes('WHERE key=?')) throw Error('Synthetic issued domain read failure'); const actual = io('query', sql, values); if (data.uiCloseDuringHydration && !uiReadHeld && sql.includes('installation_transfer_live_v1') && sql.includes('WHERE key=?')) { uiReadHeld = true; return actual.then(async value => { enterUiRead(); await heldUiRead; return value; }); } return actual; }, execute: (sql, transaction) => io('execute', sql, [], transaction), run: (sql, values, transaction) => { observeProfileIo(sql, values); return io('run', sql, values, transaction); },
  beginTransaction: () => io('begin'), commitTransaction: () => io('commit'), rollbackTransaction: () => io('rollback') };
const values = new Map(data.protectedValues);
const persist = () => { data.protectedValues = [...values]; fs.writeFileSync(dataPath, JSON.stringify(data)); };
let credentialFault = false, protectedWrites = 0, initializing = false, initHeld = false;
let enterInit, releaseInit;
const enteredInit = new Promise(resolve => { enterInit = resolve; }), heldInit = new Promise(resolve => { releaseInit = resolve; });
const binding = { failedWriteMayLosePreviousValue: true, configure: async () => {}, inventory: async () => ({ kind: 'complete', keys: [...values.keys()].sort() }),
  read: async key => { if (data.closeDuringInit && initializing && !initHeld && key.startsWith('m1.')) { initHeld = true; enterInit(); await heldInit; } if (credentialFault) throw Error('Synthetic issued credential failure'); return values.has(key) ? { kind: 'value', value: values.get(key) } : { kind: 'established_absent' }; },
  write: async (key, value) => { protectedWrites++; values.set(key, value); persist(); }, remove: async key => { const deleted = values.delete(key); persist(); return { kind: deleted ? 'deleted' : 'nothing_to_delete' }; } };
const profile = data.currentProfile ?? data.facts.profile_id, account = data.currentAccount ?? '11111111-1111-4111-8111-111111111111';
const facts = { ...data.facts, profile_id: profile };
let revision = data.revision ?? 0, pendingDeletion = null;
const deletionRow = { request_id: "77777777-7777-4777-8777-777777777777", profile_id: profile, requested_at: "2026-10-27T00:00:00Z", finalize_after: "2026-11-26T00:00:00Z" };
if (data.pendingControl) pendingDeletion = deletionRow;
const requests = [];
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } });
const session = () => ({ access_token: 'SYNTHETIC_HOST_ACCESS', refresh_token: 'SYNTHETIC_HOST_REFRESH', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: account, email: 'synthetic@example.invalid', aud: 'authenticated', created_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} } });
const fetch = async request => {
  assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
  const name = new URL(request.url).pathname.split('/').pop(); requests.push(name);
  if (name === 'get_current_legal_documents') return response([
    { id: facts.current_terms_document_id, kind: 'terms_of_service', version_label: facts.current_terms_version_label, document_url: 'https://legal.example.invalid/terms', effective_at: '2026-01-01T00:00:00Z' },
    { id: facts.current_privacy_document_id, kind: 'privacy_notice', version_label: facts.current_privacy_version_label, document_url: 'https://legal.example.invalid/privacy', effective_at: '2026-01-01T00:00:00Z' }]);
  if (name === 'token' || name === 'verify') return response(session());
  if (name === 'otp') return response({});
  if (name === 'logout') return new Response(null, { status: 204 });
  assert.equal(request.headers.get('Authorization'), 'Bearer SYNTHETIC_HOST_ACCESS');
  if (name === 'ensure_my_profile') return response({ id: profile, display_name: 'Synthetic Athlete' });
  if (name === 'complete_personal_onboarding' && data.completedFacts) { Object.assign(facts, { ...data.completedFacts, profile_id: profile }); return response(facts); }
  if (name === 'get_my_account_deletion_control') return response({ profile_id: profile, revision, pending: pendingDeletion });
  if (name === 'request_my_account_deletion') { pendingDeletion = deletionRow; revision++; return response([deletionRow]); }
  if (name === 'cancel_my_account_deletion') { pendingDeletion = null; revision++; return response(true); }
  if (name === 'abort_my_uncommitted_account_deletion') return response(++revision);
  return response(pendingDeletion ? { ...facts, profile_id: null, display_name: null } : facts);
};
async function run() {
  let cacheRoundtrip; if (uiEnvironment) { uiEnvironment.importSdk(); cacheRoundtrip = await uiEnvironment.verifyPublicCache(); }
  const config = load(path.join(process.cwd(), 'src/lib/supabase/nativeProviderConfiguration.ts'));
  const sdk = load('@supabase/supabase-js');
  let expectedSdkErrors = 0;
  if (data.closeDuringInit) {
    for (const level of ['warn', 'error']) {
      const report = console[level];
      console[level] = (...args) => {
        const error = args[0];
        if (args.length === 1 && error instanceof sdk.AuthRetryableFetchError && error.message === 'Credential storage unavailable' && error.status === 503) { expectedSdkErrors++; return; }
        Reflect.apply(report, console, args);
      };
    }
  }
  let initializes = 0, disposes = 0;
  const initialize = sdk.AuthClient.prototype.initialize, dispose = sdk.AuthClient.prototype.dispose;
  sdk.AuthClient.prototype.initialize = function (...args) { initializes++; initializing = true; return Promise.resolve(Reflect.apply(initialize, this, args)).finally(() => { initializing = false; }); };
  sdk.AuthClient.prototype.dispose = function (...args) { disposes++; if (data.failTerminalSdk && disposes > 1) return Promise.reject(Error('Synthetic terminal SDK failure')); return Reflect.apply(dispose, this, args); };
  if (data.failStop) sdk.AuthClient.prototype.stopAutoRefresh = async function () { throw Error('Synthetic stop failure'); };
  if (data.refusePublishedGuard || data.guardedRecovery) {
    const owners = load(path.join(process.cwd(), 'src/lib/persistence/installationPublishedOwner.ts')), create = owners.createPublishedInstallationOwner;
    owners.createPublishedInstallationOwner = (...args) => { const actual = create(...args); publishedOwner = actual; if (!data.refusePublishedGuard) return actual; return { ...actual, sourceGuardRepository() { if (data.refusePublishedGuard === 'throw') throw Error('Synthetic hook refusal'); return null; } }; };
  }
  const configured = await config.prepareNativeProviderConfiguration(data.config); assert.equal(configured.ok, true);
  const hostModule = load(path.join(process.cwd(), 'src/lib/supabase/supabaseAuthService.ts'));
  const hostOptions = {
    migration: { sqlite: { databaseName: data.databaseName, engine: { createConnection: async () => connection, closeConnection: async () => { physicalCloses++; await io('close'); } }, detectPlatform: () => 'ios' },
      protectedBinding: binding, detectPlatform: () => 'ios', generateUuid: randomUUID, now: () => new Date().toISOString(), limits: data.limits },
    fetch, callbackUrlAccess: { readCurrentUrl: () => 'https://app.example.invalid/', replaceCurrentUrl: () => {} },
  };
  if (data.importUi || data.openUi) {
    const { runInstallationTransferUi } = await import('./installationTransferAppUi.mjs');
    const result = await runInstallationTransferUi({ load, configured: configured.value, hostOptions, data, profile, requests, environment: uiEnvironment });
    assert.equal(initializes, 1); uiEnvironment.check(); uiEnvironment.checkUnmounted(); assert.deepEqual(wrongProfileIo, []);
    if (result.imported) assert.equal(originalForeignCopies.size, 0);
    data.childResult = { pid: process.pid, initializes, disposes, requests, protectedWrites, cacheRoundtrip, foreignProfileIo: wrongProfileIo.length, publicationCopies, ...result }; persist();
    process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n'); return;
  }
  const created = await hostModule.createConfiguredPublishedInstallationIdentityHost(configured.value, hostOptions);
  assert.equal(created.ok, true); host = created.host;
  const starting = host.start();
  if (data.closeDuringInit) {
    await enteredInit; let closed = false; const closing = host.dispose(); void closing.then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false);
    releaseInit(); assert.deepEqual(await starting, { outcome: 'closed' });
    const cleanup = await closing; assert.deepEqual(cleanup, { ok: false, reason: 'evidence_held' }); assert.ok(expectedSdkErrors > 0);
    data.childResult = { pid: process.pid, initializes, disposes, cleanup, requests, protectedWrites, legacyAccess }; persist();
    process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n'); return;
  }
  const started = await starting;
  if (data.expectWait) {
    assert.deepEqual(started, { outcome: 'waiting', code: data.expectWait }); assert.equal(initializes, data.expectedInitializes ?? 0);
    const cleanup = await host.dispose(); assert.deepEqual(cleanup, data.expectedCleanup ?? (data.expectedHeld ? { ok: false, reason: 'evidence_held' } : { ok: true }));
    data.childResult = { pid: process.pid, initializes, disposes, cleanup, requests, protectedWrites, legacyAccess }; persist();
    process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n'); return;
  }
  assert.equal(started.outcome, 'ready');
  const runtime = started.runtime;
  const registry = load(path.join(process.cwd(), 'src/lib/persistence/nativeTrackerRegistry.ts'));
  assert.equal(registry.authenticateNativeTrackerRuntime(runtime), true);
  assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
  assert.equal(runtime.createLocalSportingScope(profile), null);
  if (data.ui) {
    const { runPublishedAppUi } = await import('./publishedInstallationAppUi.mjs');
    const uiResult = await runPublishedAppUi({ load, runtime, host, data, profile, requests, environment: uiEnvironment, failCredential() { credentialFault = true; }, failDomain() { domainFault = true; }, hydration: { entered: enteredUiRead, release: () => releaseUiRead(), closes: () => physicalCloses } });
    const beforeCleanup = host.health(); const cleanup = await host.dispose(); assert.deepEqual(cleanup, data.uiCredentialFault || data.uiCloseDuringHydration || data.uiGuardLowControl || data.uiDomainFault ? { ok: false, reason: 'evidence_held' } : { ok: true }, JSON.stringify({ beforeCleanup, afterCleanup: host.health() }));
    assert.equal(initializes, 1); uiEnvironment.check(); uiEnvironment.checkUnmounted(); assert.deepEqual(wrongProfileIo, []);
    data.childResult = { pid: process.pid, initializes, disposes, cleanup, requests, protectedWrites, cacheRoundtrip, cleanupDomain: host.health().runtime?.domain, cleanupCredential: host.health().runtime?.credential, cleanupStorageFailed: host.health().storageFailed, foreignProfileIo: wrongProfileIo.length, ...uiResult }; persist();
    process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n'); return;
  }
  const initial = await runtime.startUpOnce();
  if (data.guardedRecovery) {
    // Existing startup may present its still-current cached OTHER Profile. It
    // must never admit the newly requested guarded Profile from that cache.
    if (initial.verdict.kind === 'ready_online') assert.notEqual(initial.verdict.session.profileId, profile);
    assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
    assert.equal((await runtime.coordinator.requestEmailOtp('synthetic@example.invalid')).kind, 'otp_requested');
    const blocked = await runtime.coordinator.verifyEmailOtp('synthetic@example.invalid', '123456');
    assert.equal(blocked.kind, 'resolved');
    if (blocked.gate.kind === 'ready_online') { const guard = await publishedOwner.sourceGuardRepository(() => true).load(profile); throw Error('Synthetic guarded gate: actualProfile=' + blocked.gate.session.profileId + ',requested=' + profile + ',guard=' + guard.status + ',resolved=' + guard.resolved + ',calls=' + requests.join(',')); }
    assert.equal(blocked.gate.kind, 'identity_unconfirmed');
    if (data.pendingControl) {
      assert.deepEqual(await runtime.accountDeletion.getState(), { ok: true, value: { requestId: deletionRow.request_id, profileId: profile, requestedAt: deletionRow.requested_at, finalizeAfter: deletionRow.finalize_after } });
      assert.equal(requests.includes('abort_my_uncommitted_account_deletion'), false); assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
      const cleanup = await host.dispose(); assert.deepEqual(cleanup, { ok: true });
      data.childResult = { pid: process.pid, initializes, disposes, cleanup, requests, protectedWrites, legacyAccess }; persist();
      process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n'); return;
    }
    if (data.lowControl) {
      assert.deepEqual(await runtime.accountDeletion.getState(), { ok: false, error: 'unavailable' });
      assert.equal(requests.includes('abort_my_uncommitted_account_deletion'), false); revision = 8;
    }
    assert.deepEqual(await runtime.accountDeletion.getState(), { ok: true, value: null, recoveredProfileId: profile });
    assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
    assert.equal((await runtime.coordinator.requestEmailOtp('synthetic@example.invalid')).kind, 'otp_requested');
    const recovered = await runtime.coordinator.verifyEmailOtp('synthetic@example.invalid', '123456');
    assert.equal(recovered.kind, 'resolved'); assert.equal(recovered.gate.kind, 'ready_online');
  } else assert.equal(initial.verdict.kind, data.needFreshOtp ? data.expectedStartup ?? 'signed_out' : 'ready_online');
  if (!data.guardedRecovery && (data.needFreshOtp || data.renewWithOtp)) {
    if (data.needFreshOtp) assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
    assert.equal((await runtime.coordinator.requestEmailOtp('synthetic@example.invalid')).kind, 'otp_requested');
    const verified = await runtime.coordinator.verifyEmailOtp('synthetic@example.invalid', '123456'); assert.equal(verified.kind, 'resolved'); assert.equal(verified.gate.kind, 'ready_online');
  }
  const scope = runtime.createLocalSportingScope(profile); assert.ok(scope);
  assert.equal(runtime.createLocalSportingScope('99999999-9999-4999-8999-999999999999'), null);
  const before = await scope.repositories.session.loadCurrent();
  if (data.expectSessionId) assert.equal(before.status === 'value' && before.value.id, data.expectSessionId);
  else assert.equal(before.status, 'absent');
  const migration = load(path.join(process.cwd(), 'src/lib/sessionMigration.ts'));
  const training = load(path.join(process.cwd(), 'src/lib/trainingBlocks.ts'));
  const value = migration.createNewSession(); value.id = data.writeSessionId;
  value.blocks = [training.createTrainingBlock({ name: 'Synthetic block', mode: 'fixed', measurementMode: 'back-hog', targetTime: 3.75 })]; value.activeBlockId = value.blocks[0].id;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  const tracker = registry.bindNativeTrackerRuntime(runtime, profile); assert.ok(tracker);
  await tracker.application.sync.initialize();
  const who = {}; tracker.tracker.attach(who); tracker.tracker.context(who, 'train', false);
  assert.equal(tracker.tracker.commit(who, value, 1), true);
  assert.equal((await tracker.tracker.persistCurrent(tracker.tracker.prepareCurrent(who, value, 1))).result.ok, true);
  if (data.credentialContinuation) {
    credentialFault = true; await runtime.coordinator.revalidateGateFacts();
    assert.equal(host.health().runtime.credential, 'failed'); assert.equal(tracker.tracker.getSnapshot().mode, 'continuing');
    const next = { ...value, blocks: [...value.blocks, training.createTrainingBlock({ name: 'Another block', mode: 'fixed', measurementMode: 'back-hog', targetTime: 3.75 })] };
    assert.equal(tracker.tracker.commit(who, next, 2), true);
    assert.equal((await tracker.tracker.persistCurrent(tracker.tracker.prepareCurrent(who, next, 2))).result.ok, true);
    assert.equal(tracker.tracker.commit(who, { ...next, id: 'different-session' }, 3), false);
    assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null);
  }
  assert.equal(legacyAccess, 0); assert.equal(initializes, 1);
  if (data.accountRequest) {
    const service = runtime.accountDeletion; assert.ok(service);
    assert.deepEqual(await service.request(profile, async () => (await runtime.coordinator.invalidateIdentity()).kind === 'identity_invalidated'), { ok: true, value: { requestId: deletionRow.request_id, profileId: profile, requestedAt: deletionRow.requested_at, finalizeAfter: deletionRow.finalize_after } });
    assert.equal(registry.bindNativeTrackerRuntime(runtime, profile), null); assert.equal((await scope.repositories.session.saveCurrent(value)).ok, false);
    assert.equal((await service.getState()).ok, true); assert.equal((await service.cancel(deletionRow.request_id)).ok, true);
    assert.equal((await service.getState()).ok, true); assert.equal(runtime.createLocalSportingScope(profile), null);
  }
  const cleanup = await host.dispose(); assert.deepEqual(cleanup, data.credentialContinuation ? { ok: false, reason: 'evidence_held' } : data.failTerminalSdk ? { ok: false, reason: 'cleanup_unconfirmed' } : { ok: true });
  assert.ok(disposes >= 2);
  if (data.failTerminalSdk) {
    let reads = 0; const fake = new Proxy({}, { get() { reads++; throw Error('Synthetic forbidden option read'); } });
    assert.deepEqual(await hostModule.createConfiguredPublishedInstallationIdentityHost(configured.value, fake), { ok: false, reason: 'ownership_conflict' }); assert.equal(reads, 0);
  }
  data.childResult = { pid: process.pid, initializes, disposes, startup: initial.verdict.kind, requests, protectedWrites, legacyAccess, cleanup }; persist();
  process.stdout.write('PUBLISHED_HOST_CHILD_PASS\n');
}
try { await run(); }
catch (error) { process.stderr.write('PUBLISHED_HOST_CHILD_FAILED: ' + String(error?.message ?? 'unexpected synthetic child failure').slice(0, 1800) + '\n'); process.exitCode = 1; }
finally {
  if (host) await host.dispose();
  if (uiEnvironment) uiEnvironment.close();
  lines.close(); child.stdin.end();
  if (!stopped) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
