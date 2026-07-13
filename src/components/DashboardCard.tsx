"use client";

type DashboardCardProps = {
  label: string;
  value: string;
};

export default function DashboardCard({ label, value }: DashboardCardProps) {
  return (
    <div className="rounded-xl bg-slate-100 p-4">
      <p className="text-sm text-slate-500">{label}</p>

      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
