export function EmptyState({
  icon: Icon,
  message,
  detail,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  detail?: string;
  iconClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
      <Icon className={`h-12 w-12 mb-4 ${iconClassName || ""}`} />
      <p>{message}</p>
      {detail && <p className="text-sm">{detail}</p>}
    </div>
  );
}
