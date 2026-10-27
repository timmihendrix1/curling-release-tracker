import {afterEach,expect,it} from 'vitest';
import {fixture,releases} from './nativeTrackerFixture';
const hosts:Array<{dispose():Promise<unknown>}>=[];afterEach(async()=>{for(const host of hosts.splice(0))await host.dispose();});
function deferred(){let resolve!:(v:unknown)=>void;const promise=new Promise(r=>{resolve=r;});releases.push(()=>resolve(undefined));return{promise,resolve};}
it.each(['native_option','thenable_option','input_root'] as const)('owns nested masked malformed configured host %s and keeps reservation through drain',async kind=>{
 const h=await fixture();const configuration=await import('../nativeProviderConfiguration');
 const cap=await configuration.prepareNativeProviderConfiguration(h.options.config);expect(cap.ok).toBe(true);if(!cap.ok)throw null;
 const inner=deferred();Object.defineProperty(inner.promise,'then',{value:null});
 const wrapped=kind==='thenable_option'?{then(resolve:(v:unknown)=>void){resolve(inner.promise);}}:(async()=>inner.promise)();
 const valid={...h.options,callbackUrlAccess:{readCurrentUrl:()=>null,replaceCurrentUrl:()=>{}}};
 const malformed=kind==='input_root'?wrapped:{...valid,fetch:wrapped};let done=false;
 const first=h.module.createConfiguredNativeSportingIdentityHost(cap.value,malformed as never).then(result=>{done=true;return result;});
 await new Promise(r=>setTimeout(r,10));const premature=done;
 const next=await h.module.createConfiguredNativeSportingIdentityHost(cap.value,valid);if(next.ok)hosts.push(next.host);
 inner.resolve(undefined);expect(await first).toEqual({ok:false,reason:'invalid_dependency'});
 expect.soft(premature).toBe(false);expect.soft(next).toEqual({ok:false,reason:'ownership_conflict'});
 expect(h.fetch).not.toHaveBeenCalled();
});
