// Execute the installed public wrapper, not a hand-written registration/removal model.
// Only the native bridge receipts are synthetic; this is NOT physical evidence.
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
it('public App handle confirms the callback-ID path; remove settles before native remove receipt',async()=>{
 let callbackId!:(value:string)=>void,removed!:()=>void;
 const registration=new Promise<string>(resolve=>{callbackId=resolve;}),removal=new Promise<void>(resolve=>{removed=resolve;});
 const nativeCallback=vi.fn(()=>registration),nativePromise=vi.fn(()=>removal);
 const cap={PluginHeaders:[{name:'App',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'promise'}]}],nativeCallback,nativePromise};
 const context:{Capacitor:typeof cap;webkit:object;console:Console;__wrapper?:{Capacitor:{isNativePlatform():boolean;isPluginAvailable(name:string):boolean};registerPlugin(name:string):{addListener(name:string,callback:()=>void):Promise<{remove():Promise<void>}>}}}={Capacitor:cap,webkit:{messageHandlers:{bridge:{}}},console};
 const source=readFileSync(join(process.cwd(),'node_modules/@capacitor/core/dist/index.js'),'utf8');
 const rewritten=source.replace(/^export \{[^\n]+\};$/m,'globalThis.__wrapper={Capacitor,registerPlugin};');expect(rewritten).not.toBe(source);runInNewContext(rewritten,context);
 const api=context.__wrapper!;expect(api.Capacitor.isNativePlatform()).toBe(true);expect(api.Capacitor.isPluginAvailable('App')).toBe(true);
 const app=api.registerPlugin('App');let registered=false;const handleWork=app.addListener('appUrlOpen',()=>{}).then(value=>{registered=true;return value;});
 await Promise.resolve();await Promise.resolve();expect(nativeCallback).toHaveBeenCalledTimes(1);expect(registered).toBe(false);
 callbackId('synthetic-callback-id');const handle=await handleWork;expect(registered).toBe(true);let nativeDone=false;void removal.then(()=>{nativeDone=true;});
 try{await handle.remove();await Promise.resolve();await Promise.resolve();expect(nativePromise).toHaveBeenCalledWith('App','removeListener',{eventName:'appUrlOpen',callbackId:'synthetic-callback-id'});expect(nativeDone).toBe(false);}finally{removed();await removal;}
});
