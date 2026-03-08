import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export interface MetricCellProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  trend?: "up" | "down";
  primary?: boolean;
  muted?: boolean;
  uiId: string;
}

export function MetricCell({
  icon,
  label,
  value,
  sub,
  trend,
  primary,
  muted,
  uiId,
}: MetricCellProps) {
  return (
    <div className={`bg-background px-4 py-3 ${muted ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span
          className="text-xs text-muted-foreground uppercase tracking-wider"
          data-content-role="label"
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`font-semibold tabular-nums ${primary ? "text-2xl" : "text-xl"}`}
          data-content-role="metric"
          data-content-label={uiId}
        >
          {value}
        </span>
        {trend && (
          <span
            className={`flex items-center text-xs ${
              trend === "up" ? "text-green-500" : "text-red-500"
            }`}
          >
            {trend === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
          </span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}
