import { afterEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { capturePlatformByteSha256, settlePlatformSha256Preparation } from '../platformSha256';
const releases:(()=>void)[]=[];
function pending(){let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(done=>{resolve=done});releases.push(()=>resolve(undefined));return{promise,resolve};}
function port(){const result=capturePlatformByteSha256();if(!result.ok)throw Error('synthetic capture failed');return result.value;}
const reference=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterEach(()=>{while(releases.length)releases.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([[],[0],[0,255,128,42],Array.from({length:256},(_,i)=>i)])('hashes actual bytes with standard WebCrypto %j',async input=>{
 vi.stubGlobal('crypto',webcrypto);const digest=vi.spyOn(webcrypto.subtle,'digest'),bytes=new Uint8Array(input);expect(await port().hashBytes(bytes)).toBe(reference(bytes));expect(digest).toHaveBeenCalledTimes(1);expect(digest.mock.calls[0][0]).toBe('SHA-256');
});
it('needs no TextEncoder and captures the original operation and receiver once',async()=>{
 let subtleReads=0,operationReads=0,calls=0;const subtle={get digest(){operationReads++;return function(this:unknown,algorithm:string,bytes:Uint8Array){expect(this).toBe(subtle);expect(algorithm).toBe('SHA-256');calls++;return webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);}}};
 vi.stubGlobal('TextEncoder',undefined);vi.stubGlobal('crypto',{get subtle(){subtleReads++;return subtle}});const captured=port();expect(calls).toBe(0);vi.stubGlobal('crypto',null);const bytes=new Uint8Array([7,8,9]);expect(await captured.hashBytes(bytes)).toBe(reference(bytes));expect(subtleReads).toBe(1);expect(operationReads).toBe(1);expect(calls).toBe(1);
});
it('does not read dependency call/apply properties or input iterators/species',async()=>{
 const digest=Object.assign(function(this:unknown,_algorithm:string,bytes:Uint8Array){return webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)},{});
 Object.defineProperty(digest,'apply',{get(){throw null}});Object.defineProperty(digest,'call',{get(){throw null}});vi.stubGlobal('crypto',{subtle:{digest}});
 const bytes=new Uint8Array([1,2,3]);Object.defineProperty(bytes,Symbol.iterator,{get(){throw null}});Object.defineProperty(bytes,'constructor',{get(){throw null}});expect(await port().hashBytes(bytes)).toBe(reference(new Uint8Array([1,2,3])));
});
it('owns a stable private input copy through a delayed actual digest',async()=>{
 const gate=pending();let supplied!:Uint8Array;vi.stubGlobal('crypto',{subtle:{digest(_algorithm:string,bytes:Uint8Array){supplied=bytes;return gate.promise.then(()=>webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));}}});
 const bytes=new Uint8Array([1,2,3]),op=port().hashBytes(bytes);bytes.fill(9);expect(supplied).not.toBe(bytes);expect([...supplied]).toEqual([1,2,3]);gate.resolve(undefined);expect(await op).toBe(reference(new Uint8Array([1,2,3])));
});
it.each(['crypto','subtle','digest'] as const)('refuses missing/malformed %s before later dependencies',async slot=>{
 for(const value of [undefined,null,false,1,'digest',{}]){let later=0;vi.stubGlobal('crypto',slot==='crypto'?value:{get subtle(){if(slot==='subtle')return value;return{digest:value}}});if(slot==='crypto'&&value&&typeof value==='object')Object.defineProperty(value,'subtle',{get(){later++;throw null}});const result=capturePlatformByteSha256();expect(result).toEqual({ok:false});await settlePlatformSha256Preparation(result);expect(later).toBe(slot==='crypto'&&value&&typeof value==='object'?1:0);}
});
it.each(['crypto','subtle','digest'] as const)('retains malformed async %s before reading later getters',async slot=>{
 for(const shape of ['native','nested','thenable','field']){const gate=pending();Object.defineProperty(gate.promise,'then',{value:null});const bad=shape==='native'?gate.promise:shape==='nested'?(async()=>gate.promise)():shape==='thenable'?{then(resolve:(value:unknown)=>void){resolve(gate.promise)}}:{then:gate.promise};let later=0;
 vi.stubGlobal('crypto',slot==='crypto'?bad:{get subtle(){if(slot==='subtle')return bad;return{digest:bad}}});if(slot!=='digest')Object.defineProperty(bad,slot==='crypto'?'subtle':'digest',{get(){later++;throw null}});
 const result=capturePlatformByteSha256();expect(result.ok).toBe(false);let done=false;const wait=settlePlatformSha256Preparation(result).then(()=>{done=true});await new Promise(resolve=>setTimeout(resolve,5));expect(done).toBe(false);expect(later).toBe(0);gate.resolve(undefined);await wait;}
});
it('reads a malformed then getter only once while owning the captured method',async()=>{
 const gate=pending();let reads=0,calls=0,later=0;vi.stubGlobal('crypto',{get then(){reads++;if(reads>1)throw null;return(resolve:(value:unknown)=>void)=>{calls++;resolve(gate.promise)}},get subtle(){later++;throw null}});
 const result=capturePlatformByteSha256();expect(result.ok).toBe(false);let done=false;const wait=settlePlatformSha256Preparation(result).then(()=>{done=true});await Promise.resolve();expect(done).toBe(false);expect(later).toBe(0);gate.resolve(undefined);await wait;expect(reads).toBe(1);expect(calls).toBe(1);
});
it.each(['native','nested','thenable','field'] as const)('owns pending digest result at %s and refuses without premature settlement',async shape=>{
 const gate=pending();Object.defineProperty(gate.promise,'then',{value:null});vi.stubGlobal('crypto',{subtle:{digest(){return shape==='native'?gate.promise:shape==='nested'?(async()=>gate.promise)():shape==='thenable'?{then(resolve:(value:unknown)=>void){resolve(gate.promise)}}:{then:gate.promise}}}});
 let done=false;const op=port().hashBytes(new Uint8Array([1])).then(value=>{done=true;return value},()=>{done=true;return 'refused'});await Promise.resolve();expect(done).toBe(false);gate.resolve(new ArrayBuffer(32));expect(await op).toBe(shape==='field'?'refused':'00'.repeat(32));
});
it.each(['throw','reject','nested','thenable','field'] as const)('contains opaque failures without unhandled work: %s',async shape=>{
 let touched=0;const reason=new Proxy({},{get(){touched++;throw null},getPrototypeOf(){touched++;throw null},ownKeys(){touched++;throw null}});
 vi.stubGlobal('crypto',{subtle:{digest(){if(shape==='throw')throw reason;const child=Promise.reject(reason);Object.defineProperty(child,'then',{value:null});return shape==='reject'?child:shape==='nested'?(async()=>child)():shape==='thenable'?{then(resolve:(value:unknown)=>void){resolve(child)}}:{then:child}}}});
 await expect(port().hashBytes(new Uint8Array([1]))).rejects.toThrow(/^Platform byte fingerprint unavailable$/);expect(touched).toBe(0);
});
it('refuses malformed/detached output, accepts a genuine cross-realm buffer',async()=>{
 const detached=new ArrayBuffer(32);structuredClone(detached,{transfer:[detached]});for(const value of [undefined,null,'a'.repeat(64),false,{},new Uint8Array(32),new DataView(new ArrayBuffer(32)),new ArrayBuffer(31),new ArrayBuffer(33),detached]){vi.stubGlobal('crypto',{subtle:{digest:()=>value}});await expect(port().hashBytes(new Uint8Array())).rejects.toThrow(/^Platform byte fingerprint unavailable$/);}
 vi.stubGlobal('crypto',{subtle:{digest:()=>runInNewContext('new ArrayBuffer(32)')}});expect(await port().hashBytes(new Uint8Array())).toBe('00'.repeat(32));
});
it('rejects invalid/detached/shared/oversize inputs before digest without arbitrary reflection',async()=>{
 const digest=vi.fn(()=>new ArrayBuffer(32));vi.stubGlobal('crypto',{subtle:{digest}});const hash=port();let touched=0;const proxy=new Proxy({},{get(){touched++;throw null},getPrototypeOf(){touched++;throw null}}),detached=new Uint8Array(4);structuredClone(detached.buffer,{transfer:[detached.buffer]});
 for(const value of [proxy,undefined,null,'bytes',[],new Uint16Array(2),new DataView(new ArrayBuffer(4)),new Uint8Array(new SharedArrayBuffer(4)),detached,new Uint8Array(16_777_217)])await expect(hash.hashBytes(value as Uint8Array)).rejects.toThrow(/^Platform byte fingerprint unavailable$/);expect(touched).toBe(0);expect(digest).not.toHaveBeenCalled();
});
it('refuses native and thenable cycles with first settlement',async()=>{
 const a=pending(),b=pending();for(const p of [a.promise,b.promise])Object.defineProperty(p,'then',{value:null});a.resolve(b.promise);b.resolve(a.promise);vi.stubGlobal('crypto',{subtle:{digest:()=>a.promise}});await expect(port().hashBytes(new Uint8Array())).rejects.toThrow(/^Platform byte fingerprint unavailable$/);
 let calls=0;const cyclic={then(resolve:(value:unknown)=>void){calls++;resolve(cyclic);resolve(new ArrayBuffer(32))}};vi.stubGlobal('crypto',{subtle:{digest:()=>cyclic}});await expect(port().hashBytes(new Uint8Array())).rejects.toThrow(/^Platform byte fingerprint unavailable$/);expect(calls).toBe(1);
});
it.each(['crypto','subtle','digest'] as const)('owns rejected observed %s dependencies with opaque reasons',async slot=>{
 let touches=0;const reason=new Proxy({},{get(){touches++;throw null},getPrototypeOf(){touches++;throw null},ownKeys(){touches++;throw null}});
 for(const shape of ['native','nested','thenable','field']){const child=Promise.reject(reason);Object.defineProperty(child,'then',{value:null});const bad=shape==='native'?child:shape==='nested'?(async()=>child)():shape==='thenable'?{then(resolve:(value:unknown)=>void){resolve(child)}}:{then:child};vi.stubGlobal('crypto',slot==='crypto'?bad:{subtle:slot==='subtle'?bad:{digest:bad}});const result=capturePlatformByteSha256();expect(result).toEqual({ok:false});await settlePlatformSha256Preparation(result);}
 expect(touches).toBe(0);
});
it('supports the exact maximum owned preimage bound with the real standard engine',async()=>{
 vi.stubGlobal('crypto',webcrypto);const input=new Uint8Array(16_777_216);input[0]=1;input[input.length-1]=255;expect(await port().hashBytes(input)).toBe(reference(input));
});
