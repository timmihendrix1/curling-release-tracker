import {afterEach,expect,it} from 'vitest';
import {createNativeTeamLinkDelivery} from '../nativeTeamLinkDelivery';
const origin='https://team.example.invalid',url=(v:string)=>`${origin}/?inviteToken=${v}`;
const sources:ReturnType<typeof createNativeTeamLinkDelivery>[]=[];
afterEach(async()=>{for(const s of sources.splice(0))await s.close()});
async function source(){let event!:(x:unknown)=>void;const captured:string[]=[];let clock=()=> '2026-10-25T12:00:00Z';const s=createNativeTeamLinkDelivery({origin,current:()=>true,isOwnDisposal:()=>false,now:()=>clock(),changed:()=>{},capture:async i=>{captured.push(i.value);return{kind:'applied'}},port:{addListener(_name,cb){event=cb;return{remove(){}}},getLaunchUrl(){return{}}}});sources.push(s);await s.start();return{s,captured,emit:(v:unknown)=>event(v),clock:(fn:()=>string)=>{clock=fn}};}
it('preserves newer valid B delivered inside older A url descriptor',async()=>{const a=await source();a.emit(new Proxy({url:url('synthetic-A')},{getOwnPropertyDescriptor(t,k){if(k==='url')a.emit({url:url('synthetic-B')});return Reflect.getOwnPropertyDescriptor(t,k)}}));await a.s.close();expect(a.captured).toEqual(['synthetic-B']);});
it('preserves newer valid B delivered inside older A clock',async()=>{const a=await source();let armed=true;a.clock(()=>{if(armed){armed=false;a.emit({url:url('synthetic-B')})}return '2026-10-25T12:00:00Z'});a.emit({url:url('synthetic-A')});await a.s.close();expect(a.captured).toEqual(['synthetic-B']);});
it('invalid nested event does not retire valid outer A',async()=>{const a=await source();a.emit(new Proxy({url:url('synthetic-A')},{getOwnPropertyDescriptor(t,k){if(k==='url')a.emit({url:'https://foreign.example.invalid/?inviteToken=synthetic-B'});return Reflect.getOwnPropertyDescriptor(t,k)}}));await a.s.close();expect(a.captured).toEqual(['synthetic-A']);});
it('eligible nested B retires A even when B persistence refuses',async()=>{
 let emit!:(value:unknown)=>void;const captured:string[]=[];
 const s=createNativeTeamLinkDelivery({origin,current:()=>true,isOwnDisposal:()=>false,now:()=> '2026-10-25T12:00:00Z',changed:()=>{},capture:async intent=>{captured.push(intent.value);return{kind:'blocked'}},port:{addListener(_name,callback){emit=callback;return{remove(){}}},getLaunchUrl(){return{}}}});sources.push(s);await s.start();
 emit(new Proxy({url:url('synthetic-A')},{getOwnPropertyDescriptor(target,key){if(key==='url')emit({url:url('synthetic-B')});return Reflect.getOwnPropertyDescriptor(target,key)}}));
 await expect.poll(()=>s.getSnapshot().kind).toBe('capture_failed');expect(captured).toEqual(['synthetic-B']);
});
it('nested eligible event during prototype read stops later A classification reads',async()=>{
 const a=await source();let descriptorReads=0;
 a.emit(new Proxy({url:url('synthetic-A')},{getPrototypeOf(){a.emit({url:url('synthetic-B')});return Object.prototype},getOwnPropertyDescriptor(target,key){if(key!=='then')descriptorReads++;return Reflect.getOwnPropertyDescriptor(target,key)}}));
 await a.s.close();expect(a.captured).toEqual(['synthetic-B']);expect(descriptorReads).toBe(0);
});
