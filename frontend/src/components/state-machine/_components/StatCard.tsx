interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-default/50">
      <div className="text-brand-primary">{icon}</div>
      <div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="text-xs text-text-muted">{label}</div>
      </div>
    </div>
  );
}
