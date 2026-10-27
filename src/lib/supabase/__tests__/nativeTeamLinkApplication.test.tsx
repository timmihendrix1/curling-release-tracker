// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React,{StrictMode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {fixture,bootstrap,server,teamTransport,deferred,releases} from './nativeTrackerFixture';
import type {IdentityContextValue} from '../../../components/identity/IdentityProvider';
import {INTENT_CLEANUP_STORAGE_KEY} from '../../identity/pendingIntentRepository';
const origin='https://team.example.invalid',url=(value='synthetic-A')=>`${origin}/?inviteToken=${value}`;
let identity:IdentityContextValue|null=null;
afterEach(()=>{cleanup();identity=null;});
async function application(strict=false,debt=false){
 const h=await fixture();if(debt)h.source.map.set(INTENT_CLEANUP_STORAGE_KEY,JSON.stringify({schemaVersion:1,recordedAt:'2026-10-25T12:00:00Z'}));
 let callback!:(value:unknown)=>void;const remove=vi.fn(async()=>{});
 const port={addListener:vi.fn((_event:string,fn:(value:unknown)=>void)=>{callback=fn;return Promise.resolve({remove});}),getLaunchUrl:vi.fn(async()=>debt?{url:url()}: {})};
 const b=await bootstrap(h,{teamLinkDelivery:{origin,port}}),runtime=await b.start();server(h);const team=teamTransport(h);
 vi.stubGlobal('navigator',{onLine:false,userAgent:'Synthetic App Team-link test'});
 const {useIdentity}=await import('../../../components/identity/IdentityProvider');const flow=await import('../../../components/identity/AccountDeletionFlow'),Original=flow.default;
 function Probe(){const value=useIdentity();React.useLayoutEffect(()=>{identity=value;},[value]);return null;}
 vi.spyOn(flow,'default').mockImplementation(props=><><Probe/><Original {...props}/></>);
 const {DormantNativeTrackerComposition}=await import('../../../components/persistence/DormantNativeTrackerComposition');const tree=<DormantNativeTrackerComposition runtime={runtime}/>;const rendered=render(strict?<StrictMode>{tree}</StrictMode>:tree);
 await screen.findByLabelText('Email address');
 return{h,b,runtime,team,rendered,remove,port,emit:async(value:string)=>{await act(async()=>{callback({url:url(value)});});},emitUrl:async(raw:string)=>{await act(async()=>{callback({url:raw});});}};
}
async function signIn(){
 fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'synthetic@example.invalid'}});fireEvent.click(screen.getByRole('button',{name:'Send sign-in code'}));await screen.findByLabelText('6-digit code');
 fireEvent.change(screen.getByLabelText('6-digit code'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verify code'}));await screen.findByLabelText('Display Name');
 fireEvent.change(screen.getByLabelText('Display Name'),{target:{value:'Synthetic Athlete'}});for(const checkbox of screen.getAllByRole('checkbox'))fireEvent.click(checkbox);fireEvent.click(screen.getByRole('button',{name:'Create athlete profile'}));await screen.findByTestId('house-home');
}
it('cold persisted debt shows truthful notice and genuine OTP/debt recovery instead of reload-only lock',async()=>{
 const a=await application(true,true);expect(screen.getByText('A Team link could not be saved. Open the link again to retry.')).toBeVisible();expect(screen.queryByRole('button',{name:'Retry this Team link'})).toBeNull();
 expect(identity!.state.kind).toBe('signed_out');expect(identity!.pendingIntent).toBeNull();expect(await a.runtime.loadPendingIntent()).toBeNull();
 await signIn();expect(identity!.state.kind).toBe('ready_online');expect(await a.runtime.loadPendingIntent()).toBeNull();expect(screen.getByText(/A Team link could not be saved/)).toBeVisible();
 await a.emit('synthetic-reopened');await screen.findByText(/Synthetic Admin invited you/);await waitFor(()=>expect(screen.queryByText(/A Team link could not be saved/)).toBeNull());
 expect(a.b.callbackUrlAccess.readCurrentUrl).not.toHaveBeenCalled();expect(a.b.callbackUrlAccess.replaceCurrentUrl).not.toHaveBeenCalled();expect(a.port.addListener).toHaveBeenCalledTimes(1);expect(a.port.getLaunchUrl).toHaveBeenCalledTimes(1);
});
it.each([false,true])('warm actual plugin event opens real invitation under same owner, StrictMode=%s',async strict=>{
 const a=await application(strict);await signIn();const session=identity!.session;await a.emit('synthetic-A');await screen.findByText(/Synthetic Admin invited you/);expect(identity!.session).toBe(session);
 fireEvent.click(screen.getByRole('button',{name:'Not now'}));await waitFor(async()=>expect(await a.runtime.loadPendingIntent()).toBeNull());expect(identity!.session).toBe(session);expect(a.port.addListener).toHaveBeenCalledTimes(1);
});
it('healthy warm storage refusal displays notice without closing real ready Home',async()=>{
 const a=await application();await signIn();const session=identity!.session;
 await a.h.raw({kind:'run',sql:'INSERT INTO records(key,value) VALUES (?,?);',values:[INTENT_CLEANUP_STORAGE_KEY,JSON.stringify({schemaVersion:1,recordedAt:'2026-10-25T12:00:00Z'})]});
 await a.emit('synthetic-refused');await screen.findByText(/A Team link could not be saved/);expect(screen.getByTestId('house-home')).toBeVisible();expect(identity!.session).toBe(session);expect(identity!.state.kind).toBe('ready_online');expect(identity!.pendingIntent).toBeNull();expect(a.b.host.health().runtime).toMatchObject({domain:'healthy',protocol:'healthy'});
});
it('new delivered B survives old real A acceptance and its old dismissal facade',async()=>{
 const a=await application();await signIn();await a.emit('synthetic-A');await screen.findByText(/Synthetic Admin invited you/);const old=identity!,original=a.h.fetch.getMockImplementation()!,entered=deferred<void>(),gate=deferred<void>();releases.push(()=>gate.resolve());
 a.h.fetch.mockImplementation(async(...args)=>{const result=await original(...args);if(new URL((args[0] as Request).url).pathname.endsWith('accept_invitation')){entered.resolve();await gate.promise;}return result;});
 fireEvent.click(screen.getByRole('button',{name:'Accept'}));await entered.promise;await a.emit('synthetic-B');await waitFor(()=>expect(identity!.pendingIntent?.value).toBe('synthetic-B'));
 await act(async()=>{expect(await old.discardPendingIntent()).toBe(false);gate.resolve();});await screen.findByText(/Synthetic Admin invited you/);expect(screen.queryByText("You've joined the team.")).toBeNull();expect((await a.runtime.loadPendingIntent())?.value).toBe('synthetic-B');
});
it('delivered admin link refreshes the already mounted real inbox when deliberately reopened',async()=>{
 const a=await application();await signIn();const raw=`${origin}/?adminRequestId=77777777-7777-4777-8777-777777777777`;await a.emitUrl(raw);await screen.findByRole('button',{name:'Close Teams'});await waitFor(async()=>expect(await a.runtime.loadPendingIntent()).toBeNull());
 const first=a.team.calls.filter(name=>name==='team_admin_requests').length;await a.emitUrl(raw);await waitFor(()=>expect(a.team.calls.filter(name=>name==='team_admin_requests').length).toBeGreaterThan(first));await waitFor(async()=>expect(await a.runtime.loadPendingIntent()).toBeNull());expect(screen.getByRole('button',{name:'Close Teams'})).toBeVisible();
});
