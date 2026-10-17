import type { ActiveView } from "../lib/navigation";

export default function NavigationIcon({ view }: { view: ActiveView }) {
  return (
    <svg aria-hidden="true" focusable="false" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {view === "home" && <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z" />}
      {view === "train" && <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 1v4m0 14v4M1 12h4m14 0h4" /></>}
      {view === "assess" && <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6m-6 5h6" /></>}
      {view === "analyze" && <path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9" />}
      {view === "settings" && <><path d="M5 3v3m0 6v9M12 3v10m0 6v2M19 3v3m0 6v9" /><circle cx="5" cy="9" r="3" /><circle cx="12" cy="16" r="3" /><circle cx="19" cy="9" r="3" /></>}
    </svg>
  );
}
