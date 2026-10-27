// Independent S5l regression; synthetic only, actual host and SQLite.
import {expect,it} from 'vitest';
import {fixture,bootstrap} from './nativeTrackerFixture';
import {createPendingIntent} from '../../identity/pendingIntentRepository';
it('owns actual nested masked callback rejection without changing applied capture truth',async()=>{
 const h=await fixture(),b=await bootstrap(h),runtime=await b.start();const m=await import('../../persistence/nativeTrackerRegistry');const composition=m.resolveNativeApplicationComposition(runtime)!;
 composition.subscribeToPendingIntentChanges(()=>{const inner=Promise.reject('SYNTHETIC_PENDING_NOTIFICATION_NESTED_REJECTION');Object.defineProperty(inner,'then',{value:null});return(async()=>inner)();});
 expect(await runtime.coordinator.capturePendingIntent(createPendingIntent({kind:'invitation',value:'synthetic-owned-rejection',capturedAt:'2026-10-25T12:00:00Z'})!)).toEqual({kind:'applied'});
 await new Promise(r=>setTimeout(r,15));expect(h.fetch).not.toHaveBeenCalled();
});
