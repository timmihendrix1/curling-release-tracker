import { afterEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { encodeInstallationTransferV3, decodeInstallationTransferV3 } from '../installationTransferV3';
import { encodeInstallationTransfer, decodeInstallationTransfer, encodeInstallationTransferV2, decodeInstallationTransferV2 } from '../installationTransferCodec';
import { TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_LIMITS, type Json, type JsonObject } from '../installationTransferInventory';
import { decideInstallationTransfer } from '../installationTransferDecision';
const a='10000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',nonce='30000000-0000-4000-8000-000000000003';
const key=(id=a,suffix:string=TRANSFER_SPORTING_SUFFIXES[0])=>`curling.sporting.profile.v1.${id}.${suffix}`;
const guardKey=`curling.identity.accountDeletionGuard.${a}.v1`,resolutionKey=`curling.identity.accountDeletionGuardResolution.${nonce}.v1`;
const guard=JSON.stringify({schemaVersion:1,profileId:a,nonce,revision:4}),resolution=JSON.stringify({schemaVersion:1,profileId:a,nonce,fencedRevision:5});
const fixed=[...TRANSFER_IDENTITY_KEYS,TRANSFER_LEGACY_KEY];
function snapshot(raws:Record<string,string>={}){
 const profiles=[...new Set(Object.keys(raws).filter(k=>k.startsWith('curling.sporting.profile.v1.')).map(k=>k.slice('curling.sporting.profile.v1.'.length,'curling.sporting.profile.v1.'.length+36)))];
 const dynamic=Object.keys(raws).filter(k=>k.startsWith('curling.identity.')&&!fixed.includes(k));
 const slots=[...fixed,...dynamic,...profiles.flatMap(id=>TRANSFER_SPORTING_SUFFIXES.map(suffix=>key(id,suffix)))].sort();
 return{schemaVersion:3,transferId:'40000000-0000-4000-8000-000000000004',snapshotId:'50000000-0000-4000-8000-000000000005',sourceBuild:{version:'synthetic-v3',build:'test-1'},catalogContractId:'synthetic-catalog',listing:{schemaVersion:1,keys:Object.keys(raws).sort()},observations:slots.map(k=>Object.hasOwn(raws,k)?{key:k,state:'present',raw:raws[k]}:{key:k,state:'absent'}),sourceControl:{domain:'absent',credential:'excluded'},snapshotState:'synthetic_frozen'};
}
function engine(){const digest=vi.fn((_algorithm:string,bytes:Uint8Array)=>webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));vi.stubGlobal('crypto',{subtle:{digest}});return digest;}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function u64(n:number){const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(n));return bytes;}
function utf16(value:string){const bytes=Buffer.alloc(value.length*2);for(let i=0;i<value.length;i++)bytes.writeUInt16BE(value.charCodeAt(i),i*2);return bytes;}
// Independent C4 reference using Node buffers/BigInt, not codec internals.
function typed(value:Json):Buffer{
 if(value===null)return Buffer.from([0]);if(typeof value==='boolean')return Buffer.from([value?2:1]);if(typeof value==='number')return Buffer.concat([Buffer.from([3]),u64(value)]);if(typeof value==='string')return Buffer.concat([Buffer.from([4]),u64(value.length),utf16(value)]);
 if(Array.isArray(value))return Buffer.concat([Buffer.from([5]),u64(value.length),...value.map(typed)]);
 const names=Object.keys(value).sort();return Buffer.concat([Buffer.from([6]),u64(names.length),...names.flatMap(name=>[u64(name.length),utf16(name),typed(value[name])])]);
}
function canonical(value:Json):string{
 if(typeof value==='string'){let out='"';for(let i=0;i<value.length;i++)out+='\\u'+value.charCodeAt(i).toString(16).padStart(4,'0');return out+'"';}
 if(value===null||typeof value!=='object')return String(value);if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';return'{'+Object.keys(value).sort().map(name=>canonical(name)+':'+canonical(value[name])).join(',')+'}';
}
const preimage=(value:Json,purpose:string)=>Buffer.concat([Buffer.from(purpose+'\0','ascii'),typed(value)]);
async function wire(raws:Record<string,string>={}){const result=await encodeInstallationTransferV3(JSON.stringify(snapshot(raws)));expect(result.ok).toBe(true);if(!result.ok)throw Error('synthetic encode refused');return result.value.wire;}
const releases:(()=>void)[]=[];
afterEach(()=>{while(releases.length)releases.pop()!();vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each(['','\0','é','e\u0301','🥌','\ud800','\udc00','\ufffd','a"\\\r\n'])('uses actual standard SHA over exact UTF16 binary V3 preimages: %j',async raw=>{
 const digest=engine(),encoded=await wire({[key()]:raw}),o=JSON.parse(encoded) as JsonObject,items=o.items as JsonObject[],present=items.find(item=>item.presence==='present')!;
 expect(o.formatVersion).toBe(3);expect(o.fingerprintContract).toBe('sha256-transfer-bytes-v1');expect((o.provenance as JsonObject).inventoryContract).toBe('profile13-identity5-resolution-deletion-legacy-v2');expect(present.valueDigest).toBe(sha(preimage(raw,'curling-transfer-value/v3')));
 const packageTree={...o};delete packageTree.packageDigest;expect(o.packageDigest).toBe(sha(preimage(packageTree,'curling-transfer-package/v3')));expect(encoded).toBe(canonical(o));expect(digest).toHaveBeenCalledTimes(2);expect(Buffer.from(digest.mock.calls[0][1])).toEqual(preimage(raw,'curling-transfer-value/v3'));
 const decoded=await decodeInstallationTransferV3(encoded);expect(decoded.ok).toBe(true);if(decoded.ok){expect(decoded.value.semanticStatus).toBe('not_evaluated');expect((decoded.value.envelope.items as JsonObject[]).find(item=>item.presence==='present')?.raw).toBe(raw);expect(Object.isFrozen(decoded.value.envelope)).toBe(true);}
});
it.each([{}, {[guardKey]:guard},{[resolutionKey]:resolution},{[guardKey]:guard,[resolutionKey]:resolution}] as Record<string,string>[])('preserves V2 deletion-control inventory and an empty archive: %j',async raws=>{
 const digest=engine(),encoded=await wire(raws);const result=await decodeInstallationTransferV3(encoded);expect(result.ok).toBe(true);expect(digest).toHaveBeenCalledTimes((Object.keys(raws).length+1)*2);
 if(result.ok){const items=result.value.envelope.items as JsonObject[];for(const[k,raw]of Object.entries(raws))expect(items.find(item=>item.key===k)?.raw).toBe(raw);}
});
it('keeps every mixed-profile raw, including unsupported data, and grants no usable status',async()=>{
 engine();const raws={[key()]:'{malformed',[key(b,TRANSFER_SPORTING_SUFFIXES[12])]:' {"future":999,"privateNote":"synthetic-note"} ',[guardKey]:guard,[resolutionKey]:resolution};const result=await decodeInstallationTransferV3(await wire(raws));expect(result.ok).toBe(true);if(result.ok){expect(result.value.envelope.profiles).toEqual([a,b]);for(const[k,raw]of Object.entries(raws))expect((result.value.envelope.items as JsonObject[]).find(item=>item.key===k)?.raw).toBe(raw);expect(result.value.semanticStatus).toBe('not_evaluated');}
 const decision=decideInstallationTransfer(JSON.stringify({schemaVersion:1,kind:'readiness',package:'valid',source:'frozen',target:'clean',request:'access',proof:'imported_trusted',semantic:'candidate',receipt:'external_verified'}));expect(decision).toMatchObject({ok:true,value:{mayIssue:false,mayPublish:false,mayMount:false}});
});
it('captures the engine once per admitted invocation, after preflight, without TextEncoder',async()=>{
 let captures=0,subtleReads=0,digestReads=0,calls=0;vi.stubGlobal('TextEncoder',undefined);vi.stubGlobal('crypto',{});Object.defineProperty(globalThis,'crypto',{configurable:true,get(){captures++;return{get subtle(){subtleReads++;return{get digest(){digestReads++;return(_algorithm:string,bytes:Uint8Array)=>{calls++;return webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)}}}}}}});
 const encoded=await wire({[key()]:'one',[key(b)]:'two'});expect(captures).toBe(1);expect(subtleReads).toBe(1);expect(digestReads).toBe(1);expect(calls).toBe(3);expect((await decodeInstallationTransferV3(encoded)).ok).toBe(true);expect(captures).toBe(2);expect(calls).toBe(6);
});
it('rejects deterministic pre-hash admission failures without platform capture or coercion',async()=>{
 let captures=0,touches=0;vi.stubGlobal('crypto',{});Object.defineProperty(globalThis,'crypto',{configurable:true,get(){captures++;throw null}});const proxy=new Proxy({},{get(){touches++;throw null},getPrototypeOf(){touches++;throw null},ownKeys(){touches++;throw null}});
 const base=snapshot({[key()]:'x'});const mutations=[{...base,schemaVersion:2},{...base,listing:{...base.listing,schemaVersion:2}},{...base,observations:[]},{...base,listing:{schemaVersion:1,keys:['curling.future.unknown']}},{...base,sourceControl:{domain:'fault',credential:'excluded'}}];
 for(const value of [undefined,null,proxy,new String('json'),'{malformed','{"schemaVersion":3,"schemaVersion":3}',...mutations.map(value=>JSON.stringify(value))])expect((await encodeInstallationTransferV3(value)).ok).toBe(false);
 for(const value of [undefined,null,proxy,new String('json'),'{malformed','{"formatVersion":3,"formatVersion":3}'])expect((await decodeInstallationTransferV3(value)).ok).toBe(false);expect(captures).toBe(0);expect(touches).toBe(0);
});
it('checks size/raw/inventory bounds and sensitive or unsupported identity before engine access',async()=>{
 let captures=0;vi.stubGlobal('crypto',{});Object.defineProperty(globalThis,'crypto',{configurable:true,get(){captures++;throw null}});
 const bads=[snapshot({[key()]:'x'.repeat(TRANSFER_LIMITS.sporting+1)}),snapshot({[key()]:'x'.repeat(900_000),[key(b)]:'x'.repeat(900_000),[key('60000000-0000-4000-8000-000000000006')]:'x'.repeat(900_000),[key('70000000-0000-4000-8000-000000000007')]:'x'.repeat(900_000)}),snapshot({[guardKey]:JSON.stringify({schemaVersion:1,profileId:b,nonce,revision:4})}),snapshot({[guardKey]:guard,[resolutionKey]:JSON.stringify({schemaVersion:1,profileId:b,nonce,fencedRevision:5})}),snapshot({'curling.identity.pendingIntent.v1':'{"schemaVersion":1,"kind":"invitation","value":"synthetic"}'})];
 for(const bad of bads)expect((await encodeInstallationTransferV3(JSON.stringify(bad))).ok).toBe(false);expect(captures).toBe(0);
});
it('hashes structurally valid noncanonical input before refusing, preserving mismatch precedence',async()=>{
 const digest=engine(),encoded=await wire({[key()]:'abc'});digest.mockClear();expect(await decodeInstallationTransferV3(encoded+' ')).toEqual({ok:false,code:'noncanonical_wire'});expect(digest).toHaveBeenCalledTimes(2);
 const raw=JSON.parse(encoded) as JsonObject;(raw.items as JsonObject[]).find(item=>item.presence==='present')!.raw='abd';digest.mockClear();expect(await decodeInstallationTransferV3(canonical(raw)+' ')).toEqual({ok:false,code:'digest_mismatch'});expect(digest).toHaveBeenCalledTimes(1);
 const pkg=JSON.parse(encoded) as JsonObject;pkg.packageDigest='b'.repeat(64);digest.mockClear();expect(await decodeInstallationTransferV3(canonical(pkg)+' ')).toEqual({ok:false,code:'digest_mismatch'});expect(digest).toHaveBeenCalledTimes(2);
});
it('retains deterministic engine-failure precedence over late canonical checks and returns no partial package',async()=>{
 engine();const encoded=await wire({[key()]:'abc'});let calls=0;vi.stubGlobal('crypto',{subtle:{digest(){calls++;throw new Error('synthetic-only')}}});expect(await decodeInstallationTransferV3(encoded+' ')).toEqual({ok:false,code:'fingerprint_failed'});expect(calls).toBe(1);
 calls=0;vi.stubGlobal('crypto',{subtle:{digest(_algorithm:string,bytes:Uint8Array){if(++calls===2)throw null;return webcrypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)}}});expect(await encodeInstallationTransferV3(JSON.stringify(snapshot({[key()]:'abc'})))).toEqual({ok:false,code:'fingerprint_failed'});expect(calls).toBe(2);
});
it('leaves V1/V2 wires and injected APIs unchanged and refuses cross-version interpretation',async()=>{
 const digest=engine(),base=snapshot({[key()]:'abc'});const old1=await encodeInstallationTransfer(JSON.stringify({...base,schemaVersion:1}),sha),old2=await encodeInstallationTransferV2(JSON.stringify({...base,schemaVersion:2}),sha),new3=await encodeInstallationTransferV3(JSON.stringify(base));expect(old1.ok&&old2.ok&&new3.ok).toBe(true);if(!old1.ok||!old2.ok||!new3.ok)return;
 expect(JSON.parse(old1.value.wire).fingerprintContract).toBe('injected-256-v1');expect(JSON.parse(old2.value.wire).fingerprintContract).toBe('injected-256-v2');expect(await decodeInstallationTransfer(old1.value.wire,sha)).toMatchObject({ok:true});expect(await decodeInstallationTransferV2(old2.value.wire,sha)).toMatchObject({ok:true});
 digest.mockClear();for(const old of [old1,old2])expect(await decodeInstallationTransferV3(old.value.wire)).toEqual({ok:false,code:'unsupported_format'});expect(digest).not.toHaveBeenCalled();for(const decode of [decodeInstallationTransfer,decodeInstallationTransferV2])expect(await decode(new3.value.wire,sha)).toEqual({ok:false,code:'unsupported_format'});
});
it('rejects closed contract, routing, inventory and digest tampering',async()=>{
 const digest=engine(),encoded=await wire({[key()]:'abc'});
 for(const change of [(o:JsonObject)=>{o.fingerprintContract='injected-256-v2'},(o:JsonObject)=>{o.intendedDestination='other.bundle'},(o:JsonObject)=>{(o.provenance as JsonObject).inventoryContract='other'},(o:JsonObject)=>{(o.counts as JsonObject).slots=0}]){const o=JSON.parse(encoded);change(o);digest.mockClear();expect((await decodeInstallationTransferV3(canonical(o))).ok).toBe(false);expect(digest).not.toHaveBeenCalled();}
 const o=JSON.parse(encoded) as JsonObject;(o.items as JsonObject[]).find(item=>item.presence==='present')!.valueDigest='a'.repeat(64);expect(await decodeInstallationTransferV3(canonical(o))).toEqual({ok:false,code:'digest_mismatch'});
});
it.each(['crypto','subtle','digest'] as const)('awaits malformed observed %s capture work before a settled refusal',async slot=>{
 let resolve!:(value:unknown)=>void;const child=new Promise<unknown>(done=>{resolve=done});releases.push(()=>resolve(undefined));Object.defineProperty(child,'then',{value:null});const bad=(async()=>child)();let later=0;
 vi.stubGlobal('crypto',slot==='crypto'?bad:{get subtle(){if(slot==='subtle')return bad;return{digest:bad}}});if(slot!=='digest')Object.defineProperty(bad,slot==='crypto'?'subtle':'digest',{get(){later++;throw null}});
 let done=false;const op=encodeInstallationTransferV3(JSON.stringify(snapshot())).then(result=>{done=true;return result});await new Promise(r=>setTimeout(r,10));expect(done).toBe(false);expect(later).toBe(0);resolve(undefined);expect(await op).toEqual({ok:false,code:'fingerprint_failed'});
});
it.each(['pending','reject','field'] as const)('holds the safe core bridge through masked digest %s work',async mode=>{
 let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;const child=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no});releases.push(()=>resolve(undefined));Object.defineProperty(child,'then',{value:null});vi.stubGlobal('crypto',{subtle:{digest:()=>mode==='field'?{then:child}:(async()=>child)()}});
 let done=false;const op=encodeInstallationTransferV3(JSON.stringify(snapshot())).then(result=>{done=true;return result});await Promise.resolve();await Promise.resolve();expect(done).toBe(false);if(mode==='reject')reject('SYNTHETIC_ONLY');else resolve(mode==='field'?undefined:new ArrayBuffer(31));expect(await op).toEqual({ok:false,code:'fingerprint_failed'});
});
it('has no public provider override or default weak fallback',async()=>{
 vi.stubGlobal('crypto',undefined);const fake=vi.fn(()=>'a'.repeat(64));expect(await Reflect.apply(encodeInstallationTransferV3,undefined,[JSON.stringify(snapshot()),fake])).toEqual({ok:false,code:'fingerprint_failed'});expect(fake).not.toHaveBeenCalled();
});
it('does not use inherited JSON hooks for source, bytes or package framing',async()=>{
 engine();const input=JSON.stringify(snapshot({[key()]:'\ud800'})),prototypes=[Object.prototype,Array.prototype,Uint8Array.prototype],saved=prototypes.map(value=>Object.getOwnPropertyDescriptor(value,'toJSON'));let hooks=0,result:Awaited<ReturnType<typeof encodeInstallationTransferV3>>;
 try{for(const prototype of prototypes)Object.defineProperty(prototype,'toJSON',{configurable:true,value(){hooks++;throw null}});result=await encodeInstallationTransferV3(input);}finally{prototypes.forEach((prototype,index)=>{if(saved[index])Object.defineProperty(prototype,'toJSON',saved[index]!);else Reflect.deleteProperty(prototype,'toJSON')});}
 expect(result!.ok).toBe(true);expect(hooks).toBe(0);if(result!.ok)expect((await decodeInstallationTransferV3(result!.value.wire)).ok).toBe(true);
});
