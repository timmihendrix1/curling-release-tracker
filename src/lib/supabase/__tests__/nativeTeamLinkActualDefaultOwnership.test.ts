import {expect,it,vi} from 'vitest';
import {fixture,bootstrap,deferred,releases} from './nativeTrackerFixture';
it.each(['context','app_field'] as const)('actual host retains observed default %s pending work until settlement',async mode=>{const h=await fixture(),gate=deferred<void>();releases.push(()=>gate.resolve());Object.defineProperty(gate.promise,'then',{value:null});let touched=0,add=0,get=0;
 vi.doMock('@capacitor/core',()=>({Capacitor:{isNativePlatform(){if(mode==='context'){touched++;return gate.promise}return true},isPluginAvailable:()=>true}}));
 vi.doMock('@capacitor/app',()=>({App:mode==='context'?{addListener(){add++;return{remove(){}}},getLaunchUrl(){get++;return{}}}:{get addListener(){touched++;return gate.promise},get getLaunchUrl(){throw null}}}));
 try{const b=await bootstrap(h,{teamLinkDelivery:{origin:'https://team.example.invalid'}}),start=b.host.start();await expect.poll(()=>touched).toBe(1);await new Promise(r=>setTimeout(r,15));let done=false;const close=b.host.dispose().then(x=>{done=true;return x});await new Promise(r=>setTimeout(r,15));expect.soft(done).toBe(false);expect.soft((await h.make()).ok).toBe(false);expect.soft(add).toBe(0);expect.soft(get).toBe(0);gate.resolve();await start;await close;}finally{vi.doUnmock('@capacitor/core');vi.doUnmock('@capacitor/app');}
});
