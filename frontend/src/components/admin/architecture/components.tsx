import React from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const VARIANT_STYLES = {
  primary: "border-primary bg-primary/10",
  secondary: "border-border bg-card",
  accent: "border-blue-500 bg-blue-500/10",
  muted: "border-muted-foreground/30 bg-muted/50",
};

export const ComponentBox: React.FC<{
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  items?: string[];
  variant?: "primary" | "secondary" | "accent" | "muted";
  className?: string;
}> = ({ title, subtitle, icon, items, variant = "secondary", className }) => {
  return (
    <div
      className={cn(
        "border-2 rounded-lg p-4 min-w-[200px]",
        VARIANT_STYLES[variant],
        className
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="text-primary">{icon}</div>
        <div>
          <h4 className="font-semibold text-sm">{title}</h4>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {items && items.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 ml-6">
          {items.map((item, index) => (
            <li key={index}>
              {"\u2022"} {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const Arrow: React.FC<{
  direction?: "right" | "down" | "left" | "up";
  label?: string;
  className?: string;
}> = ({ direction = "right", label, className }) => {
  const ArrowIcon =
    direction === "down" || direction === "up" ? ArrowDown : ArrowRight;
  const rotate =
    direction === "up"
      ? "rotate-180"
      : direction === "left"
        ? "rotate-180"
        : "";

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1",
        direction === "down" || direction === "up" ? "flex-col" : "",
        className
      )}
    >
      <ArrowIcon className={cn("w-5 h-5 text-muted-foreground", rotate)} />
      {label && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
};
