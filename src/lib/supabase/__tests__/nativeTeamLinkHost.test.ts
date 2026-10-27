// Actual installed SDK + real disposable SQLite; synthetic App/protected/HTTP only.
import {expect,it,vi} from 'vitest';
import {fixture,bootstrap,deferred,releases,onboard,profileId} from './nativeTrackerFixture';
import type {NativeTeamLinkPort} from '../nativeTeamLinkDelivery';
import {INTENT_CLEANUP_STORAGE_KEY,PENDING_INTENT_STORAGE_KEY} from '../../identity/pendingIntentRepository';
const origin='https://team.example.invalid',url=(value='synthetic-A')=>`${origin}/?inviteToken=${value}`;
function port(launch:unknown={}){
 let callback!:(value:unknown)=>void;
 const remove=vi.fn<()=>unknown>(()=>Promise.resolve());
 const add=vi.fn<(event:'appUrlOpen',fn:(value:unknown)=>void)=>unknown>((_event,fn)=>{callback=fn;return Promise.resolve({remove});});
 const get=vi.fn<()=>unknown>(()=>launch);
 const source:NativeTeamLinkPort={addListener:add,getLaunchUrl:get};
 return{source,add,get,remove,emit:(event:unknown)=>callback(event)};
}
async function host(launch:unknown={}){
 const h=await fixture(),p=port(launch),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}}),runtime=await b.start();
 const {resolveNativeApplicationComposition}=await import('../../persistence/nativeTrackerRegistry');const composition=resolveNativeApplicationComposition(runtime)!;
 return{h,p,b,runtime,composition};
}
it('captures launch through the actual lane, then starts OTP without old URL/history access',async()=>{
 const a=await host({url:url()});expect(await a.runtime.loadPendingIntent()).toMatchObject({value:'synthetic-A'});
 expect(await a.runtime.captureCurrentDeepLinkIntent()).toMatchObject({kind:'captured'});
 await onboard(a.h,a.runtime);expect(a.b.callbackUrlAccess.readCurrentUrl).not.toHaveBeenCalled();expect(a.b.callbackUrlAccess.replaceCurrentUrl).not.toHaveBeenCalled();
 expect(a.runtime.createSportingApplicationScope(profileId)).not.toBeNull();expect(a.p.add).toHaveBeenCalledTimes(1);expect(a.p.get).toHaveBeenCalledTimes(1);
});
it('projects actual warm delivery and preserves exact final replay membership',async()=>{
 const a=await host();await onboard(a.h,a.runtime);a.p.emit({url:url()});
 await expect.poll(async()=> (await a.runtime.loadPendingIntent())?.value).toBe('synthetic-A');
 const observed=await a.composition.observePendingIntent();expect(observed.kind).toBe('known');if(observed.kind!=='known'||!observed.intent)throw null;
 const old=observed.intent;a.p.emit({url:url('synthetic-B')});await expect.poll(async()=> (await a.runtime.loadPendingIntent())?.value).toBe('synthetic-B');
 expect(await a.composition.discardPendingIntent(old)).toBe(false);expect(a.composition.getTeamLinkDeliverySnapshot()).toEqual({kind:'listening'});
});
it('persisted denial debt refuses cold capture but keeps genuine OTP/debt settlement reachable',async()=>{
 const h=await fixture();h.source.map.set(INTENT_CLEANUP_STORAGE_KEY,JSON.stringify({schemaVersion:1,recordedAt:'2026-10-25T12:00:00Z'}));
 const p=port({url:url()}),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}}),runtime=await b.start();
 expect(await runtime.captureCurrentDeepLinkIntent()).toEqual({kind:'not_captured'});expect(await runtime.loadPendingIntent()).toBeNull();expect(b.host.health()).toMatchObject({identityFailed:false,runtime:{domain:'healthy',protocol:'healthy'}});
 await onboard(h,runtime);expect(runtime.createSportingApplicationScope(profileId)).not.toBeNull();
 const rows=await h.raw({kind:'query',sql:'SELECT value FROM records WHERE key = ?;',values:[INTENT_CLEANUP_STORAGE_KEY]}) as {values:unknown[]};expect(rows.values).toEqual([]);
 p.emit({url:url('synthetic-reopened')});await expect.poll(async()=> (await runtime.loadPendingIntent())?.value).toBe('synthetic-reopened');
 expect(b.callbackUrlAccess.readCurrentUrl).not.toHaveBeenCalled();expect(b.callbackUrlAccess.replaceCurrentUrl).not.toHaveBeenCalled();
});
it('healthy warm refusal preserves genuine training owner and does not fabricate saved link',async()=>{
 const a=await host();await onboard(a.h,a.runtime);const scope=a.runtime.createSportingApplicationScope(profileId)!;
 await a.h.raw({kind:'run',sql:'INSERT INTO records(key,value) VALUES (?,?);',values:[INTENT_CLEANUP_STORAGE_KEY,JSON.stringify({schemaVersion:1,recordedAt:'2026-10-25T12:00:00Z'})]});
 a.p.emit({url:url()});await expect.poll(()=>a.composition.getTeamLinkDeliverySnapshot().kind).toBe('capture_failed');
 expect((await scope.repositories.trainingPlans.savePlans([])).ok).toBe(true);expect(await a.runtime.loadPendingIntent()).toBeNull();expect(a.b.host.health().runtime).toMatchObject({domain:'healthy',protocol:'healthy'});
});
it('genuine SQL capture failure retains original domain revocation and training veto',async()=>{
 const a=await host();await onboard(a.h,a.runtime);const scope=a.runtime.createSportingApplicationScope(profileId)!;
 a.h.sqlFaults.hook=async(event,next)=>{if(event.kind==='run'&&event.values?.[0]===PENDING_INTENT_STORAGE_KEY)throw null;return next();};
 a.p.emit({url:url()});await expect.poll(()=>a.b.host.health().runtime?.domain).toBe('failed');expect((await scope.repositories.trainingPlans.savePlans([])).ok).toBe(false);expect(a.runtime.createSportingApplicationScope(profileId)).toBeNull();
 expect(a.b.host.health().code).not.toBe('team_link_unavailable');
});
it('initial source failure stays waiting, joins repeated start, then clean removal releases reservation',async()=>{
 const h=await fixture(),p=port();p.get.mockImplementation(()=>Promise.reject(new Error('synthetic-only')));
 const b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});expect(await b.host.start()).toEqual({outcome:'waiting',code:'team_link_unavailable'});
 expect(await b.host.start()).toEqual({outcome:'waiting',code:'team_link_unavailable'});expect(b.host.health()).toMatchObject({code:'team_link_unavailable',identityFailed:false});
 expect(p.add).toHaveBeenCalledTimes(1);expect(p.get).toHaveBeenCalledTimes(1);expect((await h.make()).ok).toBe(false);
 expect(await b.host.dispose()).toEqual({ok:true});expect(p.remove).toHaveBeenCalledTimes(1);expect((await h.make()).ok).toBe(true);
});
it('close owns delayed launch and late callbacks are inert before payload reflection',async()=>{
 const gate=deferred<unknown>();releases.push(()=>gate.resolve({}));const h=await fixture(),p=port(gate.promise),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});
 const start=b.host.start();await expect.poll(()=>p.get.mock.calls.length).toBe(1);let done=false;const closing=b.host.dispose().then(value=>{done=true;return value;});
 let traps=0;p.emit(new Proxy({},{getPrototypeOf(){traps++;throw null;}}));expect(traps).toBe(0);expect((await h.make()).ok).toBe(false);expect(done).toBe(false);
 gate.resolve({url:url()});expect(await start).toEqual({outcome:'closed'});expect(await closing).toEqual({ok:true});expect(p.remove).toHaveBeenCalledTimes(1);expect((await h.make()).ok).toBe(true);
});
it.each(['root','native','thenable','field'] as const)('actual host disposal at %s remove depth is never its own drain or cleanup ACK',async mode=>{
 const a=await host();a.p.remove.mockImplementation(()=>{
  const closing=a.b.host.dispose();
  if(mode==='root')return closing;
  if(mode==='native'){Object.defineProperty(closing,'then',{value:null});return (async()=>closing)();}
  if(mode==='thenable')return{then(resolve:(value:unknown)=>void){resolve(closing);}};
  return{then:closing};
 });
 const closing=a.b.host.dispose();const result=await new Promise<unknown>((resolve,reject)=>{Reflect.apply(Promise.prototype.then,closing,[resolve,reject]);});
 expect(result).toEqual({ok:false,reason:'cleanup_unconfirmed'});expect(a.b.host.health().cleanupUnconfirmed).toBe(true);expect((await a.h.make()).ok).toBe(false);expect(a.p.remove).toHaveBeenCalledTimes(1);
});
it('invalid explicit origin refuses before App or underlying protected-store I/O',async()=>{
 const h=await fixture(),p=port();const result=await h.module.createNativeSportingIdentityHost({...h.options,callbackUrlAccess:{readCurrentUrl:()=>null,replaceCurrentUrl:()=>{}},teamLinkDelivery:{origin:origin+'/',port:p.source}});
 expect(result).toEqual({ok:false,reason:'invalid_dependency'});expect(p.add).not.toHaveBeenCalled();expect(p.get).not.toHaveBeenCalled();expect(h.events).toEqual([]);expect(h.fetch).not.toHaveBeenCalled();
});
it('cold genuine domain failure retains the existing host waiting classification',async()=>{
 const h=await fixture(),p=port({url:url()});h.sqlFaults.hook=async(event,next)=>{if(event.kind==='run'&&event.values?.[0]===PENDING_INTENT_STORAGE_KEY)throw null;return next();};
 const b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});expect(await b.host.start()).toEqual({outcome:'waiting',code:'credential_failed'});expect(b.host.health()).toMatchObject({storageFailed:true,code:'credential_failed',runtime:{domain:'failed'}});
});
it.each(['root','native','thenable','field'] as const)('genuine disposal during launch at %s depth yields closed, never absent runtime',async mode=>{
 const h=await fixture(),p=port(),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});
 let closing:ReturnType<typeof b.host.dispose>|undefined;
 p.get.mockImplementation(()=>{closing=b.host.dispose();if(mode==='root')return closing;if(mode==='native'){Object.defineProperty(closing,'then',{value:null});return (async()=>closing)();}if(mode==='thenable')return{then(resolve:(value:unknown)=>void){resolve(closing);}};return{then:closing};});
 expect(await b.host.start()).toEqual({outcome:'closed'});const result=await new Promise((resolve,reject)=>Reflect.apply(Promise.prototype.then,closing,[resolve,reject]));expect(result).toEqual({ok:true});expect((await h.make()).ok).toBe(true);
});
it('invalid observed async launch field stays owned through cleanup and reservation release',async()=>{
 const h=await fixture(),gate=deferred<void>();releases.push(()=>gate.resolve());Object.defineProperty(gate.promise,'then',{value:null});const p=port({url:gate.promise}),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});
 expect(await b.host.start()).toEqual({outcome:'waiting',code:'team_link_unavailable'});let done=false;const closing=b.host.dispose().then(value=>{done=true;return value;});await Promise.resolve();await Promise.resolve();expect(done).toBe(false);expect((await h.make()).ok).toBe(false);gate.resolve();expect(await closing).toEqual({ok:true});expect((await h.make()).ok).toBe(true);
});
it('inherited opt-in cannot activate a native source or read its getter',async()=>{
 const h=await fixture();let reads=0;
 const options={...h.options,callbackUrlAccess:{readCurrentUrl:()=>null,replaceCurrentUrl:()=>{}}};Object.setPrototypeOf(options,{get teamLinkDelivery(){reads++;throw null;}});
 const created=await h.module.createNativeSportingIdentityHost(options);expect(created.ok).toBe(true);if(!created.ok)throw null;
 try{expect((await created.host.start()).outcome).toBe('ready');expect(reads).toBe(0);}finally{await created.host.dispose();}
});
it.each(['root','native','thenable','field'] as const)('registration reaching genuine disposal as %s cannot fabricate a handle or release reservation',async mode=>{
 const h=await fixture(),p=port(),b=await bootstrap(h,{teamLinkDelivery:{origin,port:p.source}});let closing:ReturnType<typeof b.host.dispose>|undefined;
 p.add.mockImplementation(()=>{
  if(mode==='thenable')return{then(resolve:(value:unknown)=>void){closing=b.host.dispose();resolve(closing);}};
  if(mode==='field')return{get then(){closing=b.host.dispose();return closing;}};
  closing=b.host.dispose();if(mode==='native'){Object.defineProperty(closing,'then',{value:null});return (async()=>closing)();}return closing;
 });
 expect(await b.host.start()).toEqual({outcome:'closed'});const result=await new Promise((resolve,reject)=>Reflect.apply(Promise.prototype.then,closing,[resolve,reject]));
 expect(result).toEqual({ok:false,reason:'cleanup_unconfirmed'});expect((await h.make()).ok).toBe(false);expect(p.remove).not.toHaveBeenCalled();expect(p.get).toHaveBeenCalledTimes(mode==='thenable'?1:0);
});
