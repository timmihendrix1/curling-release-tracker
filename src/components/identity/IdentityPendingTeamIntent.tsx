"use client";

import { useEffect, useRef } from "react";
import TeamInvitationAcceptOverlay from "../TeamInvitationAcceptOverlay";
import { useOptionalIdentity } from "./IdentityProvider";

/**
 * Replays the one durable Team deep-link intent only after the global identity
 * gate has opened. TrackerApp owns the destination UI; the identity authority
 * owns the intent lifetime and its required deletion.
 */
export default function IdentityPendingTeamIntent({
  onOpenAdminRequests,
}: {
  onOpenAdminRequests: () => void;
}) {
  const identity = useOptionalIdentity();
  const replayedAdminRequestRef = useRef<string | null>(null);
  const intent = identity?.pendingIntent ?? null;

  useEffect(() => {
    if (identity === null || intent?.kind !== "admin_request") return;
    if (replayedAdminRequestRef.current === intent.value) return;
    replayedAdminRequestRef.current = intent.value;
    onOpenAdminRequests();
    // TeamsScreen removes the durable intent only after its Admin Request inbox
    // has loaded successfully. A failed or interrupted replay must survive.
  }, [identity, intent, onOpenAdminRequests]);

  if (identity === null || intent?.kind !== "invitation") return null;

  return (
    <TeamInvitationAcceptOverlay
      token={intent.value}
      onDone={() => {
        void identity.discardPendingIntent();
      }}
    />
  );
}
