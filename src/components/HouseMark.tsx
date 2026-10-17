/** The House signature is decoration, never a progress or accuracy chart. */
export default function HouseMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 108 108" className={className}>
      <circle cx="54" cy="54" r="51" fill="none" stroke="currentColor" opacity=".45" />
      <circle cx="54" cy="54" r="39" fill="none" stroke="currentColor" strokeWidth="16" opacity=".35" />
      <circle cx="54" cy="54" r="23" fill="none" stroke="currentColor" />
      <circle cx="54" cy="54" r="9" fill="currentColor" />
      <path d="M54 0v108M0 54h108" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".65" />
    </svg>
  );
}
