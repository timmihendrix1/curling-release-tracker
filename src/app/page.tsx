import TrackerApp from "../components/TrackerApp";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md sm:max-w-xl">
        <div className="mb-4 rounded-2xl bg-white p-5 shadow-lg sm:p-6">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            Curling Release Tracker
          </h1>

          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Track and analyze your release consistency.
          </p>
        </div>

        <TrackerApp />
      </div>
    </main>
  );
}