"use client";
// Explicit destination composition. Its owner is created outside React.
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import IdentityProvider, { useIdentity } from "../identity/IdentityProvider";
import { DormantNativeTrackerComposition } from "./DormantNativeTrackerComposition";
import type { InstallationTransferApplication, InstallationTransferApplicationSnapshot, PublishedInstallationApplicationRuntime } from "../../lib/supabase/installationTransferApplication";
const action = "min-h-11 rounded-2xl bg-[#163A40] px-4 py-3 font-medium text-white disabled:opacity-50";
const secondary = "min-h-11 rounded-2xl border border-[#DEE5E7] px-4 py-3 font-medium text-[#163A40] disabled:opacity-50";
function ImportRecovery({ owner, state }: { owner: InstallationTransferApplication; state: InstallationTransferApplicationSnapshot }) {
  const identity = useIdentity();
  const [signingOut, setSigningOut] = useState(false);
  async function signInAgain() {
    if (signingOut || state.busy) return;
    setSigningOut(true);
    try { await identity.signOut(); } finally { setSigningOut(false); }
  }
  return <details className="mt-4 rounded-2xl border border-[#DEE5E7] bg-white p-4">
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Account recovery</summary>
    <p className="text-sm text-[#626E73]">If account access is locked or deletion is pending, check its status before importing.</p>
    <div className="mt-3 flex flex-col gap-3">
      <button className={secondary} disabled={state.busy || signingOut} onClick={() => owner.checkAccountDeletion()}>Check account status</button>
      {state.pendingDeletion ? <>
        <p role="status">Account deletion is pending. Cancel it before importing training.</p>
        <button className={secondary} disabled={state.busy || signingOut} onClick={() => owner.cancelAccountDeletion(state.pendingDeletion!.requestId)}>Cancel account deletion</button>
      </> : null}
      <button className={secondary} disabled={state.busy || signingOut} onClick={() => { void signInAgain(); }}>Sign out and sign in again</button>
    </div>
  </details>;
}
function ImportConfirmation({ owner, state }: { owner: InstallationTransferApplication; state: InstallationTransferApplicationSnapshot }) {
  const identity = useIdentity();
  return <section className="rounded-3xl bg-white p-5 shadow-sm" aria-labelledby="import-confirmation-title">
    <h2 id="import-confirmation-title" className="text-xl font-semibold">Import your training</h2>
    <p className="mt-2 text-sm text-[#626E73]">Your account is signed in. The import checks that the original training belongs to this Profile before saving it.</p>
    <p className="mt-2 text-sm">Signed in as {identity.session?.displayName ?? "your athlete Profile"}.</p>
    <button className={`${action} mt-4 w-full`} disabled={state.busy} onClick={() => owner.completeImport()}>Import training data</button>
  </section>;
}
export function InstallationTransferFlow({ owner }: { owner: InstallationTransferApplication }) {
  const [originalOwner] = useState(() => owner);
  const state = useSyncExternalStore(originalOwner.subscribe, originalOwner.getSnapshot, originalOwner.getSnapshot);
  const [file, setFile] = useState<File | null>(null), [code, setCode] = useState("");
  const id = useId();
  useEffect(() => originalOwner.subscribe(() => {
    if (originalOwner.getSnapshot().phase !== "select") { setFile(null); setCode(""); }
  }), [originalOwner]);
  if (owner !== originalOwner) return <p role="alert">The import has changed. Close and reopen the app before continuing.</p>;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || state.busy) return;
    owner.importFile(file, code); setFile(null); setCode(""); event.currentTarget.reset();
  }
  if (state.phase === "workspace" && state.runtime) return <DormantNativeTrackerComposition runtime={state.runtime as PublishedInstallationApplicationRuntime} />;
  return <div className="space-y-4 text-[#20282B]">
    {state.notice ? <p role={state.phase === "blocked" ? "alert" : "status"} className="rounded-2xl bg-[#E7EFF0] p-4">{state.notice}</p> : null}
    {state.phase === "select" ? <section className="rounded-3xl bg-white p-5 shadow-sm" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`} className="text-2xl font-semibold">Bring your training with you</h1>
      <p className="mt-2 text-sm text-[#626E73]">Choose the protected transfer file from your previous app and enter its separate recovery code. Keep the original app until the transfer has been checked.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div><label className="block font-medium" htmlFor={`${id}-file`}>Transfer file</label>
          <input className="mt-2 min-h-11 w-full text-sm" id={`${id}-file`} type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} /></div>
        <div><label className="block font-medium" htmlFor={`${id}-code`}>Recovery code</label>
          <input className="mt-2 min-h-11 w-full rounded-xl border border-[#DEE5E7] p-3" id={`${id}-code`} type="password" autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} /></div>
        <button className={`${action} w-full`} disabled={!file || !code || state.busy} type="submit">Check transfer file</button>
      </form>
      <button className={`${secondary} mt-3 w-full`} disabled={state.busy} onClick={() => owner.openPublished()}>Open imported training</button>
    </section> : null}
    {state.phase === "reading" || state.phase === "preparing" ? <p role="status">Preparing your transfer…</p> : null}
    {state.phase === "access" && state.runtime ? <IdentityProvider runtime={state.runtime} accessRecovery={<ImportRecovery owner={owner} state={state} />}>
      <ImportConfirmation owner={owner} state={state} />
    </IdentityProvider> : null}
    {state.phase === "closing" ? <p role="status">Finishing the import. Keep the original app and data.</p> : null}
    {state.phase === "restart" ? <h1 className="text-2xl font-semibold">Your import is saved</h1> : null}
    {state.phase !== "closed" && state.phase !== "restart" && !state.cleanupPending ? <button className={secondary} disabled={state.phase === "closing"} onClick={() => { void owner.close(); }}>End import</button> : null}
    {state.phase === "blocked" && state.cleanupPending ? <button className={secondary} onClick={() => { void owner.close(); }}>Retry finishing</button> : null}
  </div>;
}
