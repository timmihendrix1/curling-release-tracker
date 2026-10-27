// Independent S5l regression; synthetic only, actual host and SQLite.
import {expect,it} from 'vitest';
import {fixture,bootstrap,deferred,releases} from './nativeTrackerFixture';
import {createPendingIntent} from '../../identity/pendingIntentRepository';
async function host(){const h=await fixture(),b=await bootstrap(h),runtime=await b.start();const m=await import('../../persistence/nativeTrackerRegistry');const composition=m.resolveNativeApplicationComposition(runtime)!;return{h,b,runtime,composition};}
const intent=()=>createPendingIntent({kind:'invitation',value:'synthetic-listener-owned',capturedAt:'2026-10-25T12:00:00Z'})!;
it.each(['direct','nested'] as const)('drains actual %s callback work before SDK reservation release',async mode=>{
 const a=await host(),gate=deferred<void>();releases.push(()=>gate.resolve());
 if(mode==='nested')Object.defineProperty(gate.promise,'then',{value:null});
 a.composition.subscribeToPendingIntentChanges(mode==='direct'?()=>gate.promise:async()=>gate.promise);
 expect(await a.runtime.coordinator.capturePendingIntent(intent())).toEqual({kind:'applied'});
 let done=false;const closing=a.b.host.dispose().then(result=>{done=true;return result;});await new Promise(r=>setTimeout(r,10));const early=done;
 const replacement=await a.h.make();gate.resolve();const cleanup=await closing;
 expect.soft(early).toBe(false);expect.soft(replacement.ok).toBe(false);expect(cleanup).toEqual({ok:true});
});
it('does not deliver a later listener after its registration was removed reentrantly',async()=>{
 const a=await host();let calls=0,off=()=>{};
 a.composition.subscribeToPendingIntentChanges(()=>off());off=a.composition.subscribeToPendingIntentChanges(()=>{calls++;});
 expect(await a.runtime.coordinator.capturePendingIntent(intent())).toEqual({kind:'applied'});expect(calls).toBe(0);
});
// Independent known-disposal-child repro, adopted with completion/release proof.
it.each(['thenable','field'] as const)('does not retain its genuine disposal as a directly observed %s child', async mode => {
 const a=await host(); let closing:ReturnType<typeof a.b.host.dispose>|undefined, done=false;
 const close=()=>{closing=a.b.host.dispose();void closing.then(()=>{done=true;});return closing;};
 a.composition.subscribeToPendingIntentChanges(()=>mode==='thenable'
  ?{then(resolve:(value:unknown)=>void){resolve(close());}}
  :{get then(){return close();}});
 await a.runtime.coordinator.capturePendingIntent(intent());
 await expect.poll(()=>done,{timeout:1000}).toBe(true);
 expect(await closing).toEqual({ok:true});
 const replacement=await a.h.make(); expect(replacement.ok).toBe(true);
});
