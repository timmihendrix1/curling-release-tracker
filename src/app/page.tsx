import TrackerApp from "../components/TrackerApp";
import IdentityProvider from "../components/identity/IdentityProvider";
import AuthenticatedSportingPersistence from "../components/ProfileScopedSportingPersistence";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md sm:max-w-xl">
        <IdentityProvider>
          <AuthenticatedSportingPersistence>
            <TrackerApp />
          </AuthenticatedSportingPersistence>
        </IdentityProvider>
      </div>
    </main>
  );
}
