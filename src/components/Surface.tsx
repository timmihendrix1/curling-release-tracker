import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

/**
 * Shared surface-hierarchy vocabulary for Epic 1 (Visual Hierarchy and Surface
 * Discipline). Maps onto docs/DESIGN_SYSTEM.md #10 (10.1 Primary Task Surface,
 * 10.2 Standard Section Card, 10.3 Inset Panel) and docs/VISUAL_LANGUAGE.md's
 * Surface Hierarchy model — this does not introduce a new taxonomy, it gives
 * the existing one a single reusable implementation.
 *
 * - hero: the one Level-3/"Primary Task Surface" per screen (Today's Plan,
 *   Current Shot, Current Planned Shot, Result Summary, ...).
 * - primary: a Level-2 "Standard Section Card" — essential supporting
 *   content/controls, must not compete with the Hero.
 * - secondary: supporting analytics, context or history that visibly steps
 *   back (no shadow).
 * - inset: a low-emphasis panel nested inside another surface (10.3).
 * - utility: filters, metadata, compact status rows (Level 1).
 */
export type SurfaceLevel = "hero" | "primary" | "secondary" | "inset" | "utility";

const SURFACE_LEVEL_CLASSES: Record<SurfaceLevel, string> = {
  hero: "rounded-2xl bg-white p-6 shadow-lg",
  primary: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
  secondary: "rounded-2xl border border-slate-200 bg-white p-4",
  inset: "rounded-xl bg-slate-100 p-4",
  utility: "rounded-lg bg-slate-100 px-3 py-2",
};

export function surfaceClass(level: SurfaceLevel, className?: string): string {
  return className ? `${SURFACE_LEVEL_CLASSES[level]} ${className}` : SURFACE_LEVEL_CLASSES[level];
}

type SurfaceOwnProps<T extends ElementType> = {
  level: SurfaceLevel;
  as?: T;
  className?: string;
  children: ReactNode;
};

export type SurfaceProps<T extends ElementType> = SurfaceOwnProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof SurfaceOwnProps<T>>;

const DEFAULT_ELEMENT = "div";

export function Surface<T extends ElementType = typeof DEFAULT_ELEMENT>({
  level,
  as,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? DEFAULT_ELEMENT) as ElementType;
  return (
    <Component className={surfaceClass(level, className)} {...rest}>
      {children}
    </Component>
  );
}
