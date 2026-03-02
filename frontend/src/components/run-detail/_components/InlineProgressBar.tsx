import { PROGRESS_COLORS } from "../_types/timeline-types";

export function InlineProgressBar({
  current,
  total,
  progressType,
}: {
  current: number;
  total: number;
  progressType: string;
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const colors = PROGRESS_COLORS[progressType] ?? PROGRESS_COLORS["default"]!;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex w-16 h-1.5 rounded-full bg-surface-canvas/50 overflow-hidden">
        <span
          className={`h-full rounded-full ${colors.bar} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={`text-xs ${colors.text} tabular-nums`}>
        {current}/{total}
      </span>
    </span>
  );
}
