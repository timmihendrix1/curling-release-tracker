import {expect,it} from 'vitest';
import {fixture,bootstrap} from './nativeTrackerFixture';
const origin='https://team.example.invalid',url=(v:string)=>`${origin}/?inviteToken=${v}`;
it('actual SDK/SQLite retains newer B rather than reentrant older A',async()=>{const h=await fixture();let emit!:(x:unknown)=>void;const port={addListener(_n:string,cb:(x:unknown)=>void){emit=cb;return Promise.resolve({remove(){}})},getLaunchUrl(){return{}}};const b=await bootstrap(h,{teamLinkDelivery:{origin,port}}),runtime=await b.start();emit(new Proxy({url:url('synthetic-A')},{getOwnPropertyDescriptor(t,k){if(k==='url')emit({url:url('synthetic-B')});return Reflect.getOwnPropertyDescriptor(t,k)}}));await expect.poll(async()=>(await runtime.loadPendingIntent())?.value).toBe('synthetic-B');});
