import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./mobile.css";
import MobileApp from "./MobileApp";

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

createRoot(container).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>
);
