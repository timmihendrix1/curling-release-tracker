import { useEffect, useSyncExternalStore } from "react";
import { createNewUserMobileApplication } from "../../../src/lib/supabase/newUserMobileApplication";
import { DormantNativeTrackerComposition } from "../../../src/components/persistence/DormantNativeTrackerComposition";

// One document owner. Imports/rendering alone start no host/application-store
// or network work. The installed SDK module diagnostic is documented separately.
const application = createNewUserMobileApplication();
export default function NewUserBetaRoot() {
  const snapshot = useSyncExternalStore(application.subscribe, application.getSnapshot, application.getSnapshot);
  useEffect(() => application.retain(), []);
  if (snapshot.phase === "ready" && snapshot.runtime) return <DormantNativeTrackerComposition runtime={snapshot.runtime} />;
  return <section aria-label="Athlete access preparation" className="rounded-2xl border border-slate-200 bg-white p-6">
    <h1 className="text-xl font-semibold">Athlete access</h1>
    <p role={snapshot.phase === "blocked" ? "alert" : "status"}>{snapshot.notice}</p>
    {snapshot.retry && <button type="button" onClick={application.start}>Try again</button>}
  </section>;
}
