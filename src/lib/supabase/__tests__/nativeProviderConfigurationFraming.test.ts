import {afterEach,expect,it,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import {prepareNativeProviderConfiguration as prepare,resolveNativeProviderConfiguration as resolve} from '../nativeProviderConfiguration';
import {createPlatformDomainFingerprint} from '../../persistence/platformDomainFingerprint';
import {createPlatformCredentialFingerprint} from '../../persistence/platformCredentialFingerprint';
const configuration={status:'configured',url:'https://synthetic.supabase.invalid',publishableKey:'sb_publishable_SYNTHETIC_BYTE_FRAMING'};
const saved=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');
function restore(){if(saved)Object.defineProperty(Array.prototype,'toJSON',saved);else Reflect.deleteProperty(Array.prototype,'toJSON');}
afterEach(()=>{restore();vi.unstubAllGlobals();});
it('hashes the exact config tuple after input reflection installs inherited toJSON',async()=>{
 vi.stubGlobal('crypto',webcrypto);let calls=0;
 const input=new Proxy({...configuration},{ownKeys(target){Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value:function(this:unknown[]){if(this[0]==='native-provider-configuration/v1'){calls++;return 'SYNTHETIC_REDIRECTED_PREIMAGE';}return this;}});return Reflect.ownKeys(target);}});
 let first:Awaited<ReturnType<typeof prepare>>,second:Awaited<ReturnType<typeof prepare>>;
 try{first=await prepare(input);second=await prepare({...configuration,publishableKey:configuration.publishableKey+'ROTATED'});}finally{restore();}
 expect(first!.ok).toBe(true);expect(second!.ok).toBe(true);if(!first!.ok||!second!.ok)throw null;
 const a=resolve(first!.value)!,b=resolve(second!.value)!;
 const expected='pc1:'+createHash('sha256').update(JSON.stringify(['native-provider-configuration/v1','auth-js/2.112.3:credential-v1',configuration.url,configuration.publishableKey,'sb-synthetic-auth-token'])).digest('hex');
 expect.soft(calls).toBe(0);expect.soft(a.providerConfigIdentity).toBe(expected);expect(a.providerConfigIdentity).not.toBe(b.providerConfigIdentity);
});
it.each(['domain','credential'] as const)('uses exact %s tuple bytes without inherited serialization callbacks',async kind=>{
 vi.stubGlobal('crypto',webcrypto);let calls=0;
 const domain=createPlatformDomainFingerprint(),credential=createPlatformCredentialFingerprint('sb-synthetic-auth-token');expect(domain.ok&&credential.ok).toBe(true);if(!domain.ok||!credential.ok)throw null;
 Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value:function(this:unknown[]){if(this[0]===kind+'-value/v1'){calls++;return 'SYNTHETIC_REDIRECTED_PREIMAGE';}return this;}});
 let actual!:string;try{actual=kind==='domain'?await domain.value.fingerprint('SYNTHETIC_RAW'):await credential.value.fingerprint('credential-value/v1','sb-synthetic-auth-token','SYNTHETIC_RAW');}finally{restore();}
 const expected=createHash('sha256').update(JSON.stringify(kind==='domain'?['domain-value/v1','SYNTHETIC_RAW']:['credential-value/v1','sb-synthetic-auth-token','SYNTHETIC_RAW'])).digest('hex');
 expect.soft(calls).toBe(0);expect(actual).toBe(expected);
});


import {fixture,bootstrap,onboard} from './nativeTrackerFixture';
const previousHost=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');
function restoreHost(){if(previousHost)Object.defineProperty(Array.prototype,'toJSON',previousHost);else Reflect.deleteProperty(Array.prototype,'toJSON');}
afterEach(restoreHost);
it('refuses changed exact key against genuine persisted Q/M/I despite inherited tuple serializer',async()=>{
 const h=await fixture();let configuration=await import('../nativeProviderConfiguration');
 const first=await configuration.prepareNativeProviderConfiguration(h.options.config);expect(first.ok).toBe(true);if(!first.ok)throw null;
 const firstCaptured=configuration.resolveNativeProviderConfiguration(first.value)!;
 const originalTuple=['native-provider-configuration/v1','auth-js/2.112.3:credential-v1',h.options.config.url,h.options.config.publishableKey,firstCaptured.sessionStorageKey];
 const a=await bootstrap(h,{},first.value);await onboard(h,await a.start());await a.host.dispose();
 vi.resetModules();h.module=await import('../supabaseAuthService');configuration=await import('../nativeProviderConfiguration');
 const changed=new Proxy({...h.options.config,publishableKey:h.options.config.publishableKey+'ROTATED'},{ownKeys(target){Object.defineProperty(Array.prototype,'toJSON',{configurable:true,value:function(this:unknown[]){return this[0]==='native-provider-configuration/v1'?originalTuple:this;}});return Reflect.ownKeys(target);}});
 let second:Awaited<ReturnType<typeof configuration.prepareNativeProviderConfiguration>>;try{second=await configuration.prepareNativeProviderConfiguration(changed);}finally{restoreHost();}
 expect(second!.ok).toBe(true);if(!second!.ok)throw null;
 const secondCaptured=configuration.resolveNativeProviderConfiguration(second!.value)!;expect.soft(secondCaptured.providerConfigIdentity).not.toBe(firstCaptured.providerConfigIdentity);
 const b=await bootstrap(h,{},second!.value);const started=await b.host.start();expect(started.outcome).toBe('waiting');
});
