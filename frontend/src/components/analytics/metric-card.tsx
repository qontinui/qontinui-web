import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: "up" | "down";
  trendValue?: string;
  gradientFrom?: string;
  gradientTo?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  trendValue,
  gradientFrom = "var(--color-brand-primary)",
  gradientTo = "var(--color-brand-secondary)",
}: MetricCardProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm hover:border-brand-primary/30 hover:shadow-[0_0_20px_rgba(0,217,255,0.05)] transition-all duration-300 relative overflow-hidden group">
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300"
        style={{
          background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`,
        }}
      />
      <CardContent className="p-6 relative">
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${gradientFrom}20, ${gradientTo}20)`,
            }}
          >
            <Icon className="w-6 h-6" style={{ color: gradientFrom }} />
          </div>
          {trend && trendValue && (
            <div
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                trend === "up"
                  ? "bg-brand-success/20 text-brand-success"
                  : "bg-red-500/20 text-red-400"
              }`}
              data-content-role="badge"
              data-content-label="trend"
            >
              <span>{trend === "up" ? "↑" : "↓"}</span>
              <span>{trendValue}</span>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm text-text-muted">{title}</p>
          <p
            className="text-2xl font-bold text-white"
            data-content-role="metric"
            data-content-label={title.toLowerCase().replace(/\s+/g, "-")}
          >
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
