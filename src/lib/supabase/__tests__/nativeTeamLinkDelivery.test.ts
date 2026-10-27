import {afterEach,expect,it,vi} from 'vitest';
import {createNativeTeamLinkDelivery,isCanonicalNativeTeamLinkOrigin,type NativeTeamLinkPort} from '../nativeTeamLinkDelivery';
import type {IntentMutationOutcome,PendingIntent} from '../../identity/pendingIntentRepository';
const origin='https://team.example.invalid',url=(value='synthetic-A')=>`${origin}/?inviteToken=${value}`;
const releases:(()=>void)[]=[],sources:ReturnType<typeof createNativeTeamLinkDelivery>[]=[];
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function setup(launch:unknown={}) {
 let callback!:(value:unknown)=>void,active=true,own:unknown=null;
 const remove=vi.fn(()=>Promise.resolve()),add=vi.fn((_event:string,fn:(value:unknown)=>void)=>{callback=fn;return Promise.resolve({remove});}),get=vi.fn(()=>launch);
 const capture=vi.fn<(intent:PendingIntent)=>Promise<IntentMutationOutcome>>(async()=>({kind:'applied'}));
 const changed=vi.fn(),port:NativeTeamLinkPort={addListener:add,getLaunchUrl:get};
 const source=createNativeTeamLinkDelivery({origin,port,current:()=>active,isOwnDisposal:value=>own!==null&&value===own,now:()=> '2026-10-25T12:00:00Z',capture,changed});sources.push(source);
 return{source,port,remove,add,get,capture,changed,emit:(value:unknown)=>callback(value),retire:()=>{active=false;},own:(value:unknown)=>{own=value;}};
}
afterEach(async()=>{while(releases.length)releases.pop()!();for(const source of sources.splice(0))await source.close();vi.doUnmock('@capacitor/core');vi.doUnmock('@capacitor/app');vi.restoreAllMocks();});
it.each(['http://team.example.invalid','https://team.example.invalid/','https://user@team.example.invalid','https://team.example.invalid/path','https://team.example.invalid?x=1','https://team.example.invalid#x','HTTPS://team.example.invalid','https://team.example.invalid:443',null,{}])('rejects noncanonical origin %s',value=>{expect(isCanonicalNativeTeamLinkOrigin(value)).toBe(false);});
it('accepts only an explicit canonical bare HTTPS origin',()=>{expect(isCanonicalNativeTeamLinkOrigin(origin)).toBe(true);});
it.each([
 'http://team.example.invalid/?inviteToken=synthetic','https://foreign.example.invalid/?inviteToken=synthetic',
 `${origin}/path?inviteToken=synthetic`,`${origin.replace('https://','https://user@')}/?inviteToken=synthetic`,
 `${url()}#fragment`,`${url()}&inviteToken=synthetic-B`,`${url()}&adminRequestId=a&adminRequestId=b`,
 ...['code','error','error_code','error_description','sb_flow_id'].map(key=>`${url()}&${key}=synthetic`),
 `${origin}/?inviteToken=space%20token`,`${origin}/?inviteToken=line%0Atoken`,`${origin}/?inviteToken=line\ntoken`,
])('drops foreign/malformed/ambiguous/mixed delivery without capture: %s',async raw=>{
 const a=setup({url:raw});expect(await a.source.start()).toBe(true);expect(a.capture).not.toHaveBeenCalled();expect(await a.source.initialCapture()).toEqual({kind:'not_present'});
});
it('preserves existing admin precedence and invalid-admin invitation fallback',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 for(const [admin,kind] of [[id,'admin_request'],['invalid','invitation']] as const){const a=setup({url:`${url()}&adminRequestId=${admin}`});await a.source.start();expect(a.capture.mock.calls[0][0].kind).toBe(kind);await a.source.close();}
});
it.each([undefined,{}])('accepts actual native empty launch %s and a later event-only URL',async launch=>{
 const a=setup(launch);if(launch===undefined)a.get.mockReturnValueOnce(undefined);expect(await a.source.start()).toBe(true);a.emit({url:url(),get iosSourceApplication(){throw null;}});await expect.poll(()=>a.capture.mock.calls.length).toBe(1);expect(a.get).toHaveBeenCalledTimes(1);
});
it('registers before requesting launch and owns an event before registration receipt',async()=>{
 const a=setup({}),reg=deferred<{remove:typeof a.remove}>();releases.push(()=>reg.resolve({remove:a.remove}));
 a.add.mockImplementationOnce((_event,fn)=>{a.emit=fn;return reg.promise;});
 a.get.mockImplementationOnce(()=>{a.emit({url:url()});return {};});
 let done=false;const start=a.source.start().then(value=>{done=true;return value;});
 await expect.poll(()=>a.capture.mock.calls.length).toBe(1);expect(done).toBe(false);reg.resolve({remove:a.remove});expect(await start).toBe(true);
 expect(a.add.mock.invocationCallOrder[0]).toBeLessThan(a.get.mock.invocationCallOrder[0]);
});
it.each(['applied','blocked'] as const)('event B supersedes older unresolved launch A even while B capture is %s',async kind=>{
 const launch=deferred<unknown>(),captured=deferred<IntentMutationOutcome>();releases.push(()=>launch.resolve({}));releases.push(()=>captured.resolve({kind}));
 const a=setup(launch.promise);a.capture.mockReturnValueOnce(captured.promise);const start=a.source.start();a.emit({url:url('synthetic-B')});launch.resolve({url:url('synthetic-A')});
 captured.resolve({kind});expect(await start).toBe(true);expect(a.capture.mock.calls.map(([intent])=>intent.value)).toEqual(['synthetic-B']);
 expect(await a.source.initialCapture()).toMatchObject({kind:kind==='applied'?'captured':'not_captured'});
});
it.each(['https://foreign.example.invalid/?inviteToken=synthetic',`${origin}/?inviteToken=space%20token`])('invalid event cannot suppress valid launch: %s',async raw=>{
 const gate=deferred<unknown>();releases.push(()=>gate.resolve({}));const a=setup(gate.promise),start=a.source.start();a.emit({url:raw});gate.resolve({url:url()});await start;expect(a.capture.mock.calls[0][0].value).toBe('synthetic-A');
});
it('joins only current pending duplicates, then permits deliberate reopening',async()=>{
 const gate=deferred<IntentMutationOutcome>();releases.push(()=>gate.resolve({kind:'applied'}));const a=setup();await a.source.start();a.capture.mockReturnValueOnce(gate.promise);
 a.emit({url:url()});a.emit({url:url()});expect(a.capture).toHaveBeenCalledTimes(1);gate.resolve({kind:'applied'});await expect.poll(()=>a.source.getSnapshot().kind).toBe('listening');await Promise.resolve();await Promise.resolve();
 a.emit({url:url()});expect(a.capture).toHaveBeenCalledTimes(2);
});
it.each(['registration','launch'] as const)('observable %s failure is sticky source initialization failure',async which=>{
 const a=setup();if(which==='registration')a.add.mockImplementationOnce(()=>{throw null;});else a.get.mockImplementationOnce(()=>{throw null;});
 expect(await a.source.start()).toBe(false);expect(await a.source.start()).toBe(false);expect(a.add).toHaveBeenCalledTimes(1);expect(a.get).toHaveBeenCalledTimes(which==='registration'?0:1);
});
it('healthy initial capture refusal is advisory and never false absence or sticky source failure',async()=>{
 const a=setup({url:url()});a.capture.mockResolvedValue({kind:'blocked'});expect(await a.source.start()).toBe(true);expect(await a.source.initialCapture()).toEqual({kind:'not_captured'});expect(a.source.getSnapshot()).toEqual({kind:'capture_failed'});
});
it.each(['old_success','old_failure'] as const)('older completion cannot overwrite newer status: %s',async mode=>{
 const a=setup(),first=deferred<IntentMutationOutcome>(),second=deferred<IntentMutationOutcome>();releases.push(()=>first.resolve({kind:'blocked'}));releases.push(()=>second.resolve({kind:'blocked'}));await a.source.start();
 a.capture.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);a.emit({url:url('synthetic-A')});a.emit({url:url('synthetic-B')});
 second.resolve({kind:mode==='old_success'?'blocked':'applied'});await expect.poll(()=>a.source.getSnapshot().kind).toBe(mode==='old_success'?'capture_failed':'listening');
 first.resolve({kind:mode==='old_success'?'applied':'blocked'});await Promise.resolve();await Promise.resolve();expect(a.source.getSnapshot().kind).toBe(mode==='old_success'?'capture_failed':'listening');
});
it('retirement before an event prevents every payload reflection',async()=>{
 const a=setup();await a.source.start();await a.source.close();let traps=0;a.emit(new Proxy({},{getPrototypeOf(){traps++;throw null;},getOwnPropertyDescriptor(){traps++;throw null;}}));expect(traps).toBe(0);expect(a.capture).not.toHaveBeenCalled();
});
it('close from event reflection prevents later field access and capture',async()=>{
 const a=setup();await a.source.start();let fields=0;a.emit(new Proxy({url:url()},{getPrototypeOf(){void a.source.close();return Object.prototype;},getOwnPropertyDescriptor(){fields++;throw null;}}));expect(fields).toBe(0);expect(a.capture).not.toHaveBeenCalled();
});
it('close from registration invocation prevents launch and removes late handle once',async()=>{
 const a=setup(),reg=deferred<{remove:typeof a.remove}>();releases.push(()=>reg.resolve({remove:a.remove}));a.add.mockImplementationOnce(()=>{void a.source.close();return reg.promise;});
 const start=a.source.start(),closing=a.source.close();expect(a.get).not.toHaveBeenCalled();reg.resolve({remove:a.remove});expect(await start).toBe(false);expect(await closing).toEqual({ok:true});expect(a.remove).toHaveBeenCalledTimes(1);expect(a.source.close()).toBe(closing);
});
it.each(['launch','capture','remove'] as const)('close drains actually pending %s',async kind=>{
 const gate=deferred<unknown>();releases.push(()=>gate.resolve(undefined));const a=setup(kind==='launch'?gate.promise:kind==='capture'?{url:url()}:{});
 if(kind==='capture')a.capture.mockReturnValueOnce(gate.promise as Promise<IntentMutationOutcome>);
 if(kind==='remove')a.remove.mockReturnValueOnce(gate.promise as Promise<void>);
 const started=a.source.start();if(kind==='remove')await started;
 let done=false;const closing=a.source.close().then(value=>{done=true;return value;});await Promise.resolve();await Promise.resolve();expect(done).toBe(false);
 gate.resolve(kind==='capture'?{kind:'applied'}:undefined);await started;expect(await closing).toEqual({ok:true});
});
it('rejected remove reports unconfirmed cleanup',async()=>{
 const a=setup();await a.source.start();a.remove.mockImplementationOnce(()=>Promise.reject(new Error('synthetic-only')));expect(await a.source.close()).toEqual({ok:false});
});
it.each(['root','native','thenable','field'] as const)('own disposal excluded at %s is never a positive removal ACK',async kind=>{
 const a=setup(),disposal=deferred<void>();releases.push(()=>disposal.resolve());a.own(disposal.promise);await a.source.start();
 let returned:unknown=disposal.promise;
 if(kind==='native'){Object.defineProperty(disposal.promise,'then',{value:null});returned=(async()=>disposal.promise)();}
 if(kind==='thenable')returned={then(resolve:(value:unknown)=>void){resolve(disposal.promise);}};
 if(kind==='field')returned={then:disposal.promise};
 a.remove.mockImplementationOnce(()=>returned as Promise<void>);expect(await a.source.close()).toEqual({ok:false});
});
it('masked malformed event work stays owned despite no capture',async()=>{
 const a=setup(),gate=deferred<void>();releases.push(()=>gate.resolve());await a.source.start();Object.defineProperty(gate.promise,'then',{value:null});a.emit(gate.promise);
 let done=false;const closing=a.source.close().then(value=>{done=true;return value;});await Promise.resolve();await Promise.resolve();expect(done).toBe(false);gate.resolve();expect(await closing).toEqual({ok:true});expect(a.capture).not.toHaveBeenCalled();
});
it('does not read an accessor URL and still keeps source data separate from failure',async()=>{
 const a=setup();await a.source.start();let reads=0;a.emit({get url(){reads++;throw null;}});expect(reads).toBe(0);expect(a.capture).not.toHaveBeenCalled();
});
it.each(['web','missing'] as const)('default source refuses %s context before calling App methods',async kind=>{
 const add=vi.fn(),launch=vi.fn();vi.doMock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>kind!=='web',isPluginAvailable:()=>false}}));vi.doMock('@capacitor/app',()=>({App:{addListener:add,getLaunchUrl:launch}}));
 const source=createNativeTeamLinkDelivery({origin,current:()=>true,isOwnDisposal:()=>false,now:()=> '2026-10-25T12:00:00Z',capture:async()=>({kind:'applied'}),changed:()=>{}});sources.push(source);
 expect(await source.start()).toBe(false);expect(add).not.toHaveBeenCalled();expect(launch).not.toHaveBeenCalled();expect(await source.close()).toEqual({ok:true});
});
it('default native source uses only the supported App methods and actual handle remove',async()=>{
 const remove=vi.fn(async()=>{}),add=vi.fn(async()=>({remove})),launch=vi.fn(async()=>({}));vi.doMock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>true,isPluginAvailable:(name:string)=>name==='App'}}));vi.doMock('@capacitor/app',()=>({App:{addListener:add,getLaunchUrl:launch}}));
 const source=createNativeTeamLinkDelivery({origin,current:()=>true,isOwnDisposal:()=>false,now:()=> '2026-10-25T12:00:00Z',capture:async()=>({kind:'applied'}),changed:()=>{}});sources.push(source);
 expect(await source.start()).toBe(true);expect(add).toHaveBeenCalledWith('appUrlOpen',expect.any(Function));expect(launch).toHaveBeenCalledTimes(1);expect(await source.close()).toEqual({ok:true});expect(remove).toHaveBeenCalledTimes(1);
});
it('sticky source failure cannot resume delivery or clear its unavailable status through a later event',async()=>{
 const a=setup();a.get.mockImplementationOnce(()=>Promise.reject(new Error('synthetic-only')));expect(await a.source.start()).toBe(false);expect(a.source.getSnapshot().kind).toBe('unavailable');a.emit({url:url()});await Promise.resolve();expect(a.capture).not.toHaveBeenCalled();expect(a.source.getSnapshot().kind).toBe('unavailable');
});
