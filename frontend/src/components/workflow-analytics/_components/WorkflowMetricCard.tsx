import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WorkflowMetricCardProps } from "../workflow-metrics-panel-types";

const variantStyles = {
  default: "border-border",
  success: "border-green-500/20 bg-green-500/5",
  warning: "border-orange-500/20 bg-orange-500/5",
  error: "border-red-500/20 bg-red-500/5",
};

export function WorkflowMetricCard({
  title,
  value,
  icon,
  trend,
  subtitle,
  variant = "default",
}: WorkflowMetricCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", variantStyles[variant])}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
        {trend !== undefined && trend !== 0 && (
          <div className="flex items-center mt-2 text-xs">
            {trend > 0 ? (
              <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
            )}
            <span className={cn(trend > 0 ? "text-green-500" : "text-red-500")}>
              {trend > 0 ? "+" : ""}
              {trend.toFixed(1)}% vs avg
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
