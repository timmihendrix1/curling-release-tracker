"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useIdentity, type AccountDeletionState, type GateSession } from "./IdentityProvider";
import { useFileExport } from "../useFileExport";
import FileExportStatusNotice from "../FileExportStatusNotice";

const button = "min-h-11 rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-800 disabled:opacity-50";
const primary = "min-h-11 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-50";

/** Uses the existing identity authority for every OTP/recovery transition. No
 * provider session, token, credential store or second auth controller lives here. */
export default function AccountDeletionFlow({ owner, onClose, children }: {
  owner: GateSession | null; onClose(): void; children: ReactNode;
}) {
  const identity = useIdentity();
  const actions = identity.accountDeletion;
  const [pending, setPending] = useState<AccountDeletionState | null>(null);
  const [busy, setBusy] = useState(false);
  // A later sign-in, even for the same public Profile, needs its own explicit
  // confirmation. Pending/cancel state stays on this original Flow instance.
  const [confirmation, setConfirmation] = useState<{ owner: GateSession | null; checked: boolean }>({ owner, checked: false });
  const understood = confirmation.owner === owner && confirmation.checked;
  const setUnderstood = (checked: boolean) => setConfirmation({ owner, checked });
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const { runExport, status } = useFileExport({ ownerKey: identity.session?.profileId });
  const stateKind = identity.state.kind;

  useEffect(() => {
    if (!actions || busy || !["ready_online", "ready_offline", "identity_unconfirmed", "locked", "quarantined_locked", "signed_out", "recoverable_error"].includes(stateKind)) return;
    let active = true;
    void actions.getState().then((result) => {
      if (active && result.ok) setPending(result.value);
    });
    return () => { active = false; };
    // Actions are a facade over the same runtime; key reads to identity transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKind, identity.session?.profileId, busy]);

  const authInProgress = ["requesting_otp", "awaiting_otp", "verifying_otp", "establishing_identity_barrier",
    "finalizing_identity", "resolving_gate_facts", "ensuring_profile", "establishing_trusted_state"].includes(stateKind);

  async function requestDeletion() {
    if (!actions || !owner || !understood || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await actions.request(owner.profileId);
      if (result.ok) setPending(result.value);
      else setMessage(result.error === "reauthentication_required"
        ? "Confirm your sign-in again, then return to the deletion confirmation. No deletion was requested."
        : "Deletion could not be confirmed. Sign in again and check the account status before retrying.");
    } finally { setBusy(false); }
  }

  async function exportData() {
    if (!actions || !owner || busy) return;
    // Capture before any await. This is the original Provider's one-way native
    // retirement witness, carried through actual file preparation to share().
    const retirement = actions.captureNativeExportRetirement?.(owner.profileId);
    setBusy(true);
    setMessage(null);
    try {
      const result = await actions.exportPersonal(owner.profileId);
      if (!result.ok) { setMessage("Your complete export could not be prepared. Check your connection and try again."); return; }
      if (retirement?.isRetired()) return;
      const request = { displayFileName: "Evolane Curling personal data.json", content: result.value,
        mimeType: "application/json", shareTitle: "Your personal Curling data" };
      if (retirement) await runExport(request, retirement);
      else await runExport(request);
    } finally { setBusy(false); }
  }

  async function cancelDeletion() {
    if (!actions || !pending || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await actions.cancel(pending.requestId, (result) => {
        if (result.ok && result.value) {
          setPending(null);
          onClose();
        } else setMessage(result.ok ? "This request is no longer recoverable. Sign in again to check its status."
          : result.error === "reauthentication_required" ? "Confirm your sign-in with a new email code, then choose Keep my account."
            : result.error === "recovery_period_ended" ? "The recovery period has ended. Deletion can no longer be cancelled."
              : result.error === "account_changed" ? "The account status changed. Sign in again to check whether this request can still be cancelled."
              : "Your request could not be cancelled. Check your connection and try again.");
      });
    } finally { setBusy(false); }
  }

  if (!actions || authInProgress) return children;
  if (pending && (!identity.session || identity.session.profileId === pending.profileId)) return (
    <section aria-labelledby="account-deletion-title" className="mx-auto min-h-screen w-full max-w-xl space-y-4 px-4 py-8">
      <h1 id="account-deletion-title" className="text-2xl font-semibold">Account deletion requested</h1>
      <p>Training access and synchronisation are paused. You can keep your account before {new Date(pending.finalizeAfter).toLocaleString("en-GB")} by confirming your sign-in.</p>
      <p>After that date, your account, own results and private notes will be removed. Other participants keep their own results with anonymized references.</p>
      {message && <p role="alert">{message}</p>}
      {stateKind === "recoverable_error" && children}
      <button type="button" disabled={busy} className={primary} onClick={() => void cancelDeletion()}>Keep my account</button>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void identity.requestEmailOtp(email.trim()); }}>
        <label className="block">Confirm your account email
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3" />
        </label>
        <button type="submit" disabled={busy} className={button}>Send a new confirmation code</button>
      </form>
      <button type="button" disabled={busy} className={button} onClick={() => { setPending(null); onClose(); void identity.signOut(); }}>Sign out</button>
    </section>
  );
  if (!owner || identity.session?.profileId !== owner.profileId) return (
    <>{owner && message && <p role="status" className="mx-auto max-w-xl px-4 pt-4">{message}</p>}{children}</>
  );
  return (
    <section aria-labelledby="account-deletion-title" className="mx-auto min-h-screen w-full max-w-xl space-y-4 px-4 py-8">
      <h1 id="account-deletion-title" className="text-2xl font-semibold">Delete your account</h1>
      <p>Export your personal data before requesting deletion. The export includes your cloud records and data on this device. Local-only work on other devices is not included; sync or export it there first.</p>
      <button type="button" disabled={busy} className={button} onClick={() => void exportData()}>Export my personal data</button>
      <FileExportStatusNotice status={status} />
      <p>Requesting deletion pauses training access and synchronisation. You have 30 days to cancel after confirming your sign-in. Your own results and private notes are then deleted; other participants keep their own results with anonymized references and receive a neutral notification.</p>
      <label className="flex min-h-11 items-start gap-3"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-1" />I understand what will be deleted and have been offered a personal data export.</label>
      {message && <p role="alert">{message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} className={button} onClick={() => { setUnderstood(false); setMessage(null); onClose(); }}>Keep using my account</button>
        <button type="button" disabled={busy || !understood} className={primary} onClick={() => void requestDeletion()}>Request account deletion</button>
      </div>
    </section>
  );
}
