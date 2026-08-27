"use client";

import { useState } from "react";
import { useOptionalIdentity } from "./IdentityProvider";

const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60";

export default function IdentityAccountControl({ onOpenTeams }: { onOpenTeams: () => void }) {
  const identity = useOptionalIdentity();
  const [signingOut, setSigningOut] = useState(false);
  if (identity === null) return null;
  const session = identity.session;
  if (session === null) return null;

  return (
    <div data-testid="identity-account-control" className="mb-2 flex flex-wrap items-center justify-end gap-2 text-sm">
      <div className="mr-auto min-w-0">
        <p className="truncate font-medium text-slate-800">{session.displayName}</p>
        {session.email && <p className="truncate text-xs text-slate-500">{session.email}</p>}
      </div>
      {identity.state.kind === "ready_offline" && (
        <span role="status" className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
          Offline
        </span>
      )}
      <button type="button" onClick={onOpenTeams} className={secondaryButtonClassName}>Teams</button>
      <button
        type="button"
        disabled={signingOut}
        className={secondaryButtonClassName}
        onClick={() => {
          setSigningOut(true);
          void identity.signOut().finally(() => setSigningOut(false));
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
