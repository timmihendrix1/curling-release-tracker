import type { ReactNode } from "react";
import HouseMark from "./HouseMark";

/** A short orientation surface. Rings are decorative, never a performance score. */
export default function TrainingHeader({ title, eyebrow, children }: {
  title: string;
  eyebrow: string;
  children?: ReactNode;
}) {
  return (
    <header className="house-hero house-training-header">
      <HouseMark className="house-training-mark" />
      <div className="relative">
        <p className="house-hero-muted text-xs font-medium uppercase tracking-[0.12em]">{eyebrow}</p>
        <h2 className="mt-2 max-w-xl text-2xl font-medium leading-tight tracking-tight sm:text-3xl">{title}</h2>
        {children && <div className="house-hero-muted mt-3 max-w-lg text-sm leading-relaxed">{children}</div>}
      </div>
    </header>
  );
}
