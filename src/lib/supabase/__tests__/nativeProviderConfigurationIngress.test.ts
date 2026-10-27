import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto,createHash} from 'node:crypto';
import {capturePlatformSha256,settlePlatformSha256Preparation} from '../../persistence/platformSha256';
import {prepareNativeProviderConfiguration as prepare} from '../nativeProviderConfiguration';
const Encoder=TextEncoder;
const config={status:'configured',url:'https://synthetic.supabase.invalid',publishableKey:'sb_publishable_SYNTHETIC_EXTRAPROBE'};
const release:Array<()=>void>=[];
afterEach(()=>{while(release.length)release.pop()!();vi.unstubAllGlobals();});
function pending(){let resolve!:(v:unknown)=>void;const promise=new Promise(r=>{resolve=r;});release.push(()=>resolve(undefined));return{promise,resolve};}
async function turns(){await new Promise(r=>setTimeout(r,10));}
it.each(['root','url'] as const)('owns nested masked async invalid config %s',async slot=>{
 const inner=pending();Object.defineProperty(inner.promise,'then',{value:null});
 const outer=(async()=>inner.promise)();let done=false;
 const work=prepare(slot==='root'?outer:{...config,url:outer}).then(result=>{done=true;return result;});
 await turns();const early=done;inner.resolve(undefined);expect(await work).toEqual({ok:false,reason:'invalid_configuration'});expect(early).toBe(false);
});
it.each(['plain','masked'] as const)('owns both previously read platform fields and later malformed return %s',async mode=>{
 const a=pending(),b=pending();if(mode==='masked')for(const p of [a.promise,b.promise])Object.defineProperty(p,'then',{value:null});
 const encoder={get then(){return a.promise;},encode:undefined};
 vi.stubGlobal('TextEncoder',function(){return encoder;});
 const cap=capturePlatformSha256();expect(cap.ok).toBe(false);let done=false;const work=settlePlatformSha256Preparation(cap).then(()=>{done=true;});
 await turns();expect(done).toBe(false);a.resolve(undefined);await work;expect(done).toBe(true);b.resolve(undefined);
});
it('retains no arbitrary property inspection of noncallable override proxy',()=>{
 let reads=0;const hostile=new Proxy({}, {get(){reads++;throw null;},getPrototypeOf(){reads++;throw null;},ownKeys(){reads++;throw null;}});
 vi.stubGlobal('TextEncoder',Encoder);expect(capturePlatformSha256(hostile).ok).toBe(false);expect(reads).toBe(0);
});
it('owns malformed encoder thenable before digest and ignores repeated settlement',async()=>{
 const held=pending();let calls=0;
 vi.stubGlobal('TextEncoder',class{encode(){return {then(resolve:(v:unknown)=>void,reject:(v:unknown)=>void){resolve(held.promise);reject('ignored');}};}});
 const cap=capturePlatformSha256(()=>{calls++;return new ArrayBuffer(32);});expect(cap.ok).toBe(true);if(!cap.ok)throw null;
 let done=false;const work=cap.value.hash('x').then(()=>{done=true;},()=>{done=true;});await turns();expect(done).toBe(false);expect(calls).toBe(0);held.resolve(new Uint8Array([1]));await work;
});
it('keeps concurrent hashes independent and resolves only their own exact vectors',async()=>{
 vi.stubGlobal('TextEncoder',Encoder);const a=pending(),b=pending();Object.defineProperty(a.promise,'then',{value:null});let count=0;
 const cap=capturePlatformSha256(()=>++count===1?Promise.resolve(a.promise):b.promise);expect(cap.ok).toBe(true);if(!cap.ok)throw null;
 let doneA=false,doneB=false;const wa=cap.value.hash('a').then(v=>{doneA=true;return v;}),wb=cap.value.hash('b').then(v=>{doneB=true;return v;});
 b.resolve(await webcrypto.subtle.digest('SHA-256',new Encoder().encode('b')));expect(await wb).toBe(createHash('sha256').update('b').digest('hex'));expect(doneA).toBe(false);expect(doneB).toBe(true);
 a.resolve(await webcrypto.subtle.digest('SHA-256',new Encoder().encode('a')));expect(await wa).toBe(createHash('sha256').update('a').digest('hex'));
});
it('contains opaque nested rejection without reading reason metadata',async()=>{
 let read=0;const reason=new Proxy({}, {get(){read++;throw null;},getPrototypeOf(){read++;throw null;},ownKeys(){read++;throw null;}});
 vi.stubGlobal('TextEncoder',Encoder);const inner=Promise.reject(reason);Object.defineProperty(inner,'then',{value:null});
 const cap=capturePlatformSha256(()=>Promise.resolve(inner));expect(cap.ok).toBe(true);if(!cap.ok)throw null;
 await expect(cap.value.hash('x')).rejects.toThrow('Platform fingerprint unavailable');expect(read).toBe(0);
});
it('refuses a cycle through an observed malformed native then field without rereading the same graph',async()=>{
 vi.stubGlobal('TextEncoder',Encoder);let reads=0;const value:Record<string,unknown>={};const method=Promise.resolve(value);
 Object.defineProperty(value,'then',{get(){if(++reads>5)throw 'SYNTHETIC_CYCLE_STOP';return method;}});
 const captured=capturePlatformSha256(()=>value);expect(captured.ok).toBe(true);if(!captured.ok)throw null;
 await expect(captured.value.hash('x')).rejects.toThrow('Platform fingerprint unavailable');expect(reads).toBeLessThanOrEqual(2);
});


it('owns the actual rejected native fulfillment observed through malformed config input',async()=>{
 const inner=Promise.reject('SYNTHETIC_CONFIG_INPUT_NESTED_REJECTION');Object.defineProperty(inner,'then',{value:null});
 const outer=(async()=>inner)();expect(await prepare(outer)).toEqual({ok:false,reason:'invalid_configuration'});
 await new Promise(r=>setTimeout(r,15));
});

it('owns the actual plain-prototype native Promise, beyond the capture probe', async () => {
 const held=pending();Object.setPrototypeOf(held.promise,Object.prototype);let done=false;
 const work=prepare(held.promise).then(value=>{done=true;return value;});await turns();expect(done).toBe(false);
 held.resolve(undefined);expect(await work).toEqual({ok:false,reason:'invalid_configuration'});
});
