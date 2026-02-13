"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";

interface MetricCardProps {
  icon: React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  label: string;
  value: string | number;
  color: string;
  trend?: number;
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  color,
  trend,
}: MetricCardProps) {
  const TrendIcon = trend && trend > 0 ? TrendingUp : TrendingDown;
  const trendColor =
    trend && trend > 0 ? "var(--brand-success)" : "var(--error)";

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm hover:border-border-default transition-all">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>
                {value}
              </p>
            </div>
          </div>
          {trend !== undefined && (
            <Badge
              variant="outline"
              className="text-xs"
              style={{
                backgroundColor: `${trendColor}20`,
                borderColor: `${trendColor}40`,
                color: trendColor,
              }}
            >
              <TrendIcon className="w-3 h-3 mr-1" />
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
