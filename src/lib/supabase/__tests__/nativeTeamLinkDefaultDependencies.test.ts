import {afterEach,expect,it,vi} from 'vitest';
const releases:(()=>void)[]=[],sources:{close():Promise<unknown>}[]=[];
afterEach(async()=>{while(releases.length)releases.pop()!();for(const s of sources.splice(0))await s.close();vi.doUnmock('@capacitor/core');vi.doUnmock('@capacitor/app');vi.resetModules();});
function pending(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r});releases.push(resolve);Object.defineProperty(promise,'then',{value:null});return{promise,resolve};}
async function source(core:unknown,app:unknown){vi.doMock('@capacitor/core',()=>({Capacitor:core}));vi.doMock('@capacitor/app',()=>({App:app}));const {createNativeTeamLinkDelivery}=await import('../nativeTeamLinkDelivery');const s=createNativeTeamLinkDelivery({origin:'https://team.example.invalid',current:()=>true,isOwnDisposal:()=>false,now:()=> '2026-10-25T12:00:00Z',capture:async()=>({kind:'applied'}),changed:()=>{}});sources.push(s);return s;}
it.each(['native','available'] as const)('refuses malformed async default %s result and owns pending work',async which=>{const gate=pending();let adds=0,launches=0;const s=await source({isNativePlatform:()=>which==='native'?gate.promise:true,isPluginAvailable:()=>which==='available'?gate.promise:true},{addListener(){adds++;return{remove(){}}},getLaunchUrl(){launches++;return{}}});const start=s.start();await new Promise(r=>setTimeout(r,15));let done=false;const close=s.close().then(()=>{done=true});await new Promise(r=>setTimeout(r,15));expect.soft(adds).toBe(0);expect.soft(launches).toBe(0);expect.soft(done).toBe(false);gate.resolve();expect.soft(await start).toBe(false);await close;});
it('retains malformed App add getter result before later launch getter throws',async()=>{const gate=pending();const s=await source({isNativePlatform:()=>true,isPluginAvailable:()=>true},{get addListener(){return gate.promise},get getLaunchUrl(){throw new Error('synthetic later getter')}});expect(await s.start()).toBe(false);let done=false;const close=s.close().then(()=>{done=true});await new Promise(r=>setTimeout(r,15));expect.soft(done).toBe(false);gate.resolve();await close;});
it.each([false,undefined,null,0,1,'native',{},()=>true])('requires exact true before reading later native dependencies: %s',async value=>{
 let nativeCalls=0,laterReads=0;
 const s=await source({isNativePlatform(){nativeCalls++;return value},get isPluginAvailable(){laterReads++;throw null}},{get addListener(){laterReads++;throw null}});
 expect(await s.start()).toBe(false);expect(nativeCalls).toBe(1);expect(laterReads).toBe(0);expect(await s.close()).toEqual({ok:true});
});
it.each(['core_root','native_method','available_method','app_root','add_method','launch_method'] as const)('owns malformed pending %s and refuses all subsequent reads',async point=>{
 const gate=pending();let reached=0,later=0;
 const core=point==='core_root'?gate.promise:{get isNativePlatform(){if(point==='native_method'){reached++;return gate.promise}return()=>true},get isPluginAvailable(){if(point==='available_method'){reached++;return gate.promise}if(point==='native_method')later++;return()=>true}};
 const app=point==='app_root'?gate.promise:{get addListener(){if(point==='add_method'){reached++;return gate.promise}return()=>{later++;return{remove(){}}}},get getLaunchUrl(){if(point==='launch_method'){reached++;return gate.promise}if(point==='add_method')later++;return()=>{later++;return{}}}};
 const s=await source(core,app);expect(await s.start()).toBe(false);expect(reached).toBe(point.endsWith('root')?0:1);expect(later).toBe(0);
 let closed=false;const closing=s.close().then(()=>{closed=true});await new Promise(resolve=>setTimeout(resolve,15));expect(closed).toBe(false);gate.resolve();await closing;
});
it('retirement inside a default getter owns its result and prevents the next getter',async()=>{
 const gate=pending();let later=0;
 const s=await source({get isNativePlatform(){void s.close();return gate.promise},get isPluginAvailable(){later++;throw null}},{get addListener(){later++;throw null}});
 expect(await s.start()).toBe(false);let closed=false;const closing=s.close().then(()=>{closed=true});await new Promise(resolve=>setTimeout(resolve,15));expect(closed).toBe(false);expect(later).toBe(0);gate.resolve();await closing;
});
it('captures native methods with their receiver and never invokes their apply properties',async()=>{
 const receivers:unknown[]=[];let removed=0;
 const native=function(this:unknown){receivers.push(this);return true},available=function(this:unknown,name:unknown){receivers.push(this);expect(name).toBe('App');return true};
 Object.defineProperty(native,'apply',{get(){throw null}});
 const add=function(this:unknown,name:unknown){receivers.push(this);expect(name).toBe('appUrlOpen');return{remove(){removed++}}},launch=function(this:unknown){receivers.push(this);return{}};
 const core={isNativePlatform:native,isPluginAvailable:available},app={addListener:add,getLaunchUrl:launch};const s=await source(core,app);expect(await s.start()).toBe(true);expect(await s.close()).toEqual({ok:true});expect(receivers).toEqual([core,core,app,app]);expect(removed).toBe(1);
});
