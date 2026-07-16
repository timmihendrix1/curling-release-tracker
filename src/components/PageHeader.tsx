type PageHeaderProps = {
  title: string;
  description?: string;
};

/**
 * Compact contextual header for Train, Assess, Analyze and Settings — an
 * inline section (DESIGN_SYSTEM.md §9.2/§10.6), not a card: no background,
 * border or shadow, so it never competes with the screen's own primary
 * surface. The full "Curling Performance" product identity (AppHeader)
 * stays on Home only; every other screen identifies itself with this instead.
 */
export default function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="px-1">
      <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">
        {title}
      </h1>
      {description && (
        <p className="mt-0.5 text-sm text-slate-600">{description}</p>
      )}
    </header>
  );
}
