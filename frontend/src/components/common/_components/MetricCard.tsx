"use client";

import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  /** Card title / label */
  title: string;
  /** Primary value to display */
  value: string | number;
  /**
   * Icon: either a rendered ReactNode (e.g. `<Activity className="h-4 w-4" />`)
   * or a component reference (e.g. `Activity`) that will be instantiated.
   */
  icon?:
    | React.ReactNode
    | React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  /** Numeric trend percentage. Positive = up, negative = down. */
  trend?: number;
  /** Text shown below the trend indicator (e.g. "vs previous period") */
  trendSuffix?: string;
  /** Short description shown below the value */
  description?: string;
  /** Semantic variant that applies border/bg coloring */
  variant?: "default" | "success" | "warning" | "error";
  /** Accent color applied to icon and optionally to the value */
  color?: string;
  /** When true the accent color is also applied to the value text */
  colorValue?: boolean;
  /** Additional CSS classes on the root Card */
  className?: string;
}

/**
 * Returns true if the icon prop is a React component reference rather than an
 * already-rendered ReactNode. Handles plain function components, class
 * components, and `React.forwardRef`/`React.memo`-wrapped components (which
 * are objects of shape `{ $$typeof, render }` / `{ $$typeof, type }`, not
 * functions — so a naive `typeof === "function"` check misses them and
 * triggers "Objects are not valid as a React child" when the object is
 * passed straight to JSX).
 */
function isComponentRef(
  icon: MetricCardProps["icon"]
): icon is React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
}> {
  if (icon == null) return false;
  if (typeof icon === "function") return true;
  // Already-rendered elements have $$typeof too, so exclude them explicitly.
  if (React.isValidElement(icon)) return false;
  // Anything else with a $$typeof tag is a component-like object
  // (forwardRef, memo, lazy, etc.) — instantiate it as JSX.
  return typeof icon === "object" && "$$typeof" in icon;
}

const variantStyles: Record<NonNullable<MetricCardProps["variant"]>, string> = {
  default: "border-border",
  success: "border-green-500/20 bg-green-500/5",
  warning: "border-orange-500/20 bg-orange-500/5",
  error: "border-red-500/20 bg-red-500/5",
};

export function MetricCard({
  title,
  value,
  icon,
  trend,
  trendSuffix = "vs previous period",
  description,
  variant = "default",
  color,
  colorValue = false,
  className,
}: MetricCardProps) {
  const iconStyle = color ? { color } : undefined;

  // Render the icon, handling both ReactNode and component-ref forms
  let renderedIcon: React.ReactNode = null;
  if (icon) {
    if (isComponentRef(icon)) {
      const Icon = icon;
      renderedIcon = <Icon className="w-5 h-5" style={iconStyle} />;
    } else {
      // Already a ReactNode; wrap in a span to apply color if needed
      renderedIcon = color ? <span style={iconStyle}>{icon}</span> : icon;
    }
  }

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        variantStyles[variant],
        className
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {renderedIcon && (
          <div className="text-muted-foreground">{renderedIcon}</div>
        )}
      </CardHeader>
      <CardContent>
        <div
          className="text-2xl font-bold"
          style={colorValue && color ? { color } : undefined}
        >
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
              {trend.toFixed(1)}%{trendSuffix ? ` ${trendSuffix}` : ""}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
