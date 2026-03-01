"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  description?: string;
  variant?: "default" | "success" | "warning" | "error";
  color?: string;
}

export function MetricCard({
  title,
  value,
  icon,
  trend,
  description,
  variant = "default",
  color,
}: MetricCardProps) {
  const variantStyles = {
    default: "border-border",
    success: "border-green-500/20 bg-green-500/5",
    warning: "border-orange-500/20 bg-orange-500/5",
    error: "border-red-500/20 bg-red-500/5",
  };

  return (
    <Card className={cn("relative overflow-hidden", variantStyles[variant])}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground" style={color ? { color } : {}}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" style={color ? { color } : {}}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
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
              {trend.toFixed(1)}% vs previous period
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
