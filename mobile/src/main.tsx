import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./mobile.css";

/**
 * Mobile bootstrap. The only thing this file does beyond `src/app/page.tsx`'s
 * job is mount the tree, which Next does for the Web build.
 *
 * StrictMode matches the Web build's React behaviour in development. It is a
 * development-only double-invoke in React and has no production effect, so the
 * shared identity orchestration sees the same replayed-effect conditions it is
 * already designed for (see the capture cell's page-scoping note in
 * src/lib/identity/identityRuntime.ts).
 */
const container = document.getElementById("root");
if (container === null) {
  throw new Error("Mobile shell is missing its #root container.");
}

const root = createRoot(container);
// Keep dependency-evaluation failures inside the bootstrap boundary too. The
// pinned SDK has a deprecated browser-storage diagnostic at module evaluation;
// a throwing diagnostic must never turn an installable app into a blank page.
void import("./MobileApp").then(({ default: MobileApp }) => {
  root.render(<StrictMode><MobileApp /></StrictMode>);
}).catch(() => {
  root.render(<main className="house-shell min-h-screen px-4 py-4 sm:px-6 sm:py-8">
    <section className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">Athlete access</h1>
      <p role="alert">Athlete access could not be loaded. Close and reopen the app. Existing data has been preserved.</p>
    </section>
  </main>);
});
