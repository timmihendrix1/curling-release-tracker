import {expect,it,afterEach,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {prepareNativeProviderConfiguration as prepare} from '../nativeProviderConfiguration';
const config={status:'configured',url:'https://synthetic.supabase.invalid',publishableKey:'sb_publishable_SYNTHETIC_CONFIG_PROBE'};
function deferred(){let resolve!:(v:unknown)=>void;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
const cleanup:Array<()=>void>=[];afterEach(()=>{while(cleanup.length)cleanup.pop()!();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function assertOwned(setup:(p:Promise<unknown>)=>void){const d=deferred();cleanup.push(()=>d.resolve(undefined));setup(d.promise);let done=false;const work=prepare(config).then(v=>{done=true;return v;});await new Promise(r=>setTimeout(r,10));const premature=done;d.resolve(undefined);const result=await work;expect(result).toEqual({ok:false,reason:'evidence_unavailable'});expect(premature).toBe(false);}
it('owns a masked native Promise yielded as the observed digest fulfillment',async()=>{await assertOwned(p=>{Object.defineProperty(p,'then',{value:null});vi.stubGlobal('crypto',{subtle:{digest:async()=>p}});});});
it('owns an observed malformed digest method',async()=>{await assertOwned(p=>{vi.stubGlobal('crypto',{subtle:{digest:p}});});});
it('owns encode field before a later platform getter throws',async()=>{await assertOwned(p=>{vi.stubGlobal('TextEncoder',class {encode=p;});vi.stubGlobal('crypto',{get subtle(){throw new Error('synthetic');}});});});
it('owns a directly observed pending crypto object',async()=>{await assertOwned(p=>{vi.stubGlobal('crypto',p);});});
it('owns malformed encoder output before invoking another dependency',async()=>{await assertOwned(p=>{Object.defineProperty(p,'then',{value:null});vi.stubGlobal('TextEncoder',class {encode(){return p;}});vi.stubGlobal('crypto',webcrypto);});});
it('rejects an explicit record without the three own config fields',async()=>{
 vi.stubGlobal('crypto',webcrypto);const saved=new Map<string,PropertyDescriptor|undefined>();for(const key of Object.keys(config))saved.set(key,Object.getOwnPropertyDescriptor(Object.prototype,key));
 const restore=()=>{for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(Object.prototype,key,descriptor);else Reflect.deleteProperty(Object.prototype,key);}};cleanup.push(restore);
 let once=false;const input=new Proxy({a:1,b:2,c:3},{ownKeys(target){if(!once){once=true;for(const [key,value]of Object.entries(config))Object.defineProperty(Object.prototype,key,{value,configurable:true,writable:true});}return Reflect.ownKeys(target);}});
 const result=await prepare(input);restore();expect(result).toEqual({ok:false,reason:'invalid_configuration'});
});
it('accepts actual standard capabilities and an ordinary exact record',async()=>{vi.stubGlobal('crypto',webcrypto);expect((await prepare(config)).ok).toBe(true);});
it('owns an encoder instance observed inside the reused fingerprint constructor',async()=>{const Actual=TextEncoder;await assertOwned(p=>{Object.defineProperty(p,'then',{value:null});let calls=0;vi.stubGlobal('TextEncoder',function(){return ++calls===2?p:new Actual();});vi.stubGlobal('crypto',webcrypto);});});
it.each(['domain','credential'] as const)('owns malformed nested output when the prepared %s binding is used',async kind=>{
 const d=deferred();cleanup.push(()=>d.resolve(undefined));Object.defineProperty(d.promise,'then',{value:null});let calls=0;
 vi.stubGlobal('crypto',{subtle:{digest:async(algorithm:string,bytes:BufferSource)=>{if(++calls===1)return await webcrypto.subtle.digest(algorithm,bytes);return d.promise;}}});
 const configurationModule=await import('../nativeProviderConfiguration');const prepared=await prepare(config);expect(prepared.ok).toBe(true);if(!prepared.ok)throw null;
 const bound=configurationModule.resolveNativeProviderConfiguration(prepared.value)!;let done=false;const work=Promise.resolve(kind==='domain'?bound.domainFingerprint.fingerprint('synthetic domain raw'):bound.credentialFingerprint.fingerprint('credential-value/v1','sb-synthetic-auth-token','synthetic sdk raw')).then(()=>{done=true;},()=>{done=true;});
 await new Promise(r=>setTimeout(r,10));const premature=done;d.resolve(undefined);await work;expect(premature).toBe(false);
});
it('never invokes inherited config getters introduced by the actual reflection callback',async()=>{
 vi.stubGlobal('crypto',webcrypto);const saved=new Map<string,PropertyDescriptor|undefined>();for(const key of Object.keys(config))saved.set(key,Object.getOwnPropertyDescriptor(Object.prototype,key));
 const restore=()=>{for(const [key,d]of saved){if(d)Object.defineProperty(Object.prototype,key,d);else Reflect.deleteProperty(Object.prototype,key);}};cleanup.push(restore);let calls=0,once=false;
 const input=new Proxy({a:1,b:2,c:3},{ownKeys(target){if(!once){once=true;for(const [key,value]of Object.entries(config))Object.defineProperty(Object.prototype,key,{get(){calls++;return value;},configurable:true});}return Reflect.ownKeys(target);}});
 const result=await prepare(input);restore();expect.soft(result).toEqual({ok:false,reason:'invalid_configuration'});expect.soft(calls).toBe(0);
});


import {prepareNativeProviderConfiguration} from '../nativeProviderConfiguration';
afterEach(()=>{vi.unstubAllGlobals();});
it('owns the directly observed rejected masked digest fulfillment',async()=>{const inner=Promise.reject('SYNTHETIC_NESTED_DIGEST_REJECTION');Object.defineProperty(inner,'then',{value:null});vi.stubGlobal('crypto',{subtle:{digest:async()=>inner}});expect(await prepareNativeProviderConfiguration({status:'configured',url:'https://synthetic.supabase.invalid',publishableKey:'sb_publishable_SYNTHETIC_CONFIG_PROBE'})).toEqual({ok:false,reason:'evidence_unavailable'});await new Promise(r=>setTimeout(r,15));});


import {fixture,bootstrap,onboard} from './nativeTrackerFixture';
it.each(['ios','android'] as const)('refuses a changed exact key in a fresh SDK/module lifetime on %s',async platform=>{
 const h=await fixture('empty',platform);let configurationModule=await import('../nativeProviderConfiguration');
 const firstCap=await configurationModule.prepareNativeProviderConfiguration(h.options.config);expect(firstCap.ok).toBe(true);if(!firstCap.ok)throw null;
 const a=await bootstrap(h,{},firstCap.value),runtime=await a.start();await onboard(h,runtime);await a.host.dispose();
 const items=[...h.values],source=[...h.source.map];h.fetch.mockClear();vi.resetModules();h.module=await import('../supabaseAuthService');configurationModule=await import('../nativeProviderConfiguration');
 const cap=await configurationModule.prepareNativeProviderConfiguration({...h.options.config,publishableKey:h.options.config.publishableKey+'ROTATED'});expect(cap.ok).toBe(true);if(!cap.ok)throw null;
 const b=await bootstrap(h,{},cap.value);expect((await b.host.start()).outcome).toBe('waiting');expect(b.host.health().code).not.toBe('restart_required');expect(h.fetch).not.toHaveBeenCalled();expect([...h.values]).toEqual(items);expect([...h.source.map]).toEqual(source);
});
