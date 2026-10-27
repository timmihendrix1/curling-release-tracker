"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import TeamInvitationAcceptOverlay from "../TeamInvitationAcceptOverlay";
import { useOptionalIdentity } from "./IdentityProvider";
import { useNativeTrackerBinding } from "../persistence/nativeTrackerContext";
import { useNativeApplicationComposition } from "../persistence/nativeApplicationContext";

const ordinary = Object.freeze({ mode: "normal" as const, credentialPaused: false });
const webSnapshot = () => ordinary, webSubscribe = () => () => {};

/**
 * Replays the one durable Team deep-link intent only after the global identity
 * gate has opened. TrackerApp owns the destination UI; the identity authority
 * owns the intent lifetime and its required deletion.
 */
export default function IdentityPendingTeamIntent({
  onOpenAdminRequests,
  onInvitationContext,
}: {
  onOpenAdminRequests: () => void;
  onInvitationContext?: (shown: boolean) => void;
}) {
  const identity = useOptionalIdentity();
  const nativeBinding = useNativeTrackerBinding();
  const nativeComposition = useNativeApplicationComposition();
  const presentation = useSyncExternalStore(nativeBinding?.tracker.subscribe ?? webSubscribe, nativeBinding?.tracker.getSnapshot ?? webSnapshot, webSnapshot);
  const replayedAdminRequestRef = useRef<string | object | null>(null);
  const intent = identity?.pendingIntent ?? null;
  const [prepared, setPrepared] = useState<{ binding: object; intent: object } | null>(null);
  const nativeAvailable = !!nativeBinding?.team && presentation.mode === "normal";

  useEffect(() => {
    if ((nativeComposition && !nativeAvailable) || identity === null || intent?.kind !== "admin_request") return;
    const replay = nativeComposition ? intent : intent.value;
    if (replayedAdminRequestRef.current === replay) return;
    replayedAdminRequestRef.current = replay;
    onOpenAdminRequests();
    // TeamsScreen removes the durable intent only after its Admin Request inbox
    // has loaded successfully. A failed or interrupted replay must survive.
  }, [nativeComposition, nativeAvailable, identity, intent, onOpenAdminRequests]);

  useEffect(() => {
    if (!nativeComposition || !nativeAvailable || !nativeBinding || intent?.kind !== "invitation" || !onInvitationContext) return;
    // Report the real nonpersonal context BEFORE permitting the child overlay's
    // first mount/effect. This microtask only acknowledges presentation setup.
    onInvitationContext(true);
    let active = true;
    void Promise.resolve().then(() => { if (active) setPrepared({ binding: nativeBinding, intent }); });
    return () => { active = false; onInvitationContext(false); };
  }, [nativeComposition, nativeAvailable, nativeBinding, intent, onInvitationContext]);

  if (nativeComposition && intent && (!nativeAvailable || (intent.kind === "invitation" && !onInvitationContext))) return <p role="status">Team access is unavailable. Your link has been kept.</p>;

  if (identity === null || intent?.kind !== "invitation") return null;
  if (nativeComposition && (prepared?.binding !== nativeBinding || prepared.intent !== intent)) return null;

  return (
    <TeamInvitationAcceptOverlay
      token={intent.value}
      onDone={() => {
        void identity.discardPendingIntent();
      }}
    />
  );
}
