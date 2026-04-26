"use client";

import React, { useState } from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

interface RatingStarsProps {
  value: number | null;
  /** When provided, the component renders interactive buttons. */
  onChange?: (stars: number) => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  ariaLabel?: string;
}

const SIZES: Record<NonNullable<RatingStarsProps["size"]>, string> = {
  sm: "w-3.5 h-3.5",
  md: "w-5 h-5",
  lg: "w-7 h-7",
};

export function RatingStars({
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: RatingStarsProps) {
  const editable = !!onChange;
  const [hover, setHover] = useState(0);
  const display = hover || Math.round(value ?? 0);
  const sizeClass = SIZES[size];

  return (
    <div
      className={cn("flex items-center gap-0.5", className)}
      role={editable ? "radiogroup" : undefined}
      aria-label={ariaLabel}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= display;
        const icon = (
          <Star
            className={cn(
              sizeClass,
              filled
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40",
              editable && "transition-transform"
            )}
          />
        );

        if (!editable) {
          return (
            <span key={star} aria-hidden="true">
              {icon}
            </span>
          );
        }

        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === Math.round(value ?? 0)}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            onClick={() => onChange?.(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(0)}
            className="rounded transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}
