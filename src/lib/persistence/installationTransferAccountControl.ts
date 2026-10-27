// Closed transfer-host producer; inspection alone grants no source clearance.
import { readNativeFreshEmailOtp } from "../identity/identityTransitionCoordinator";
import { validDeletionRevision } from "../identity/accountDeletionGuard";
import { isCanonicalUuid } from "../uuid";

type Observation = Readonly<{ event: object; source: object; accountScopeId: string; profileId: string; revision: number; current(): boolean }>;
const observations = new WeakMap<object, Observation>();
export function createTransferAccountControlObservation(event: unknown, accountScopeId: string, profileId: string, revision: number, current: () => boolean): object | null {
  try {
    const facts = readNativeFreshEmailOtp(event);
    if (!facts || facts.accountScopeId !== accountScopeId || facts.profileId !== profileId || !isCanonicalUuid(profileId) || !validDeletionRevision(revision) || !facts.current() || current() !== true) return null;
    const handle = Object.freeze(Object.create(null)) as object;
    observations.set(handle, Object.freeze({ event: event as object, source: facts.source, accountScopeId, profileId, revision,
      current: () => { try { return facts.current() && current() === true; } catch { return false; } },
    }));
    return handle;
  } catch { return null; }
}
export function readTransferAccountControlObservation(value: unknown): Observation | null {
  const facts = value !== null && (typeof value === "object" || typeof value === "function") ? observations.get(value) : null;
  return facts?.current() === true ? facts : null;
}
