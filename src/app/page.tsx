import AppHeader from "../components/AppHeader";
import TrackerApp from "../components/TrackerApp";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md sm:max-w-xl">
        <AppHeader />

        <TrackerApp />
      </div>
    </main>
  );
}
