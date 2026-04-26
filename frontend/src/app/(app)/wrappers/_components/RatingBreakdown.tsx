"use client";

import React from "react";
import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

interface RatingBreakdownProps {
  /**
   * Per-star counts. When omitted, the component falls back to displaying
   * empty bars — useful when the backend doesn't return a breakdown but we
   * still know the total.
   */
  counts?: Partial<Record<1 | 2 | 3 | 4 | 5, number>>;
  total: number;
  className?: string;
}

export function RatingBreakdown({
  counts,
  total,
  className,
}: RatingBreakdownProps) {
  const safeTotal = Math.max(0, total);

  return (
    <div className={cn("space-y-1.5", className)}>
      {([5, 4, 3, 2, 1] as const).map((stars) => {
        const count = counts?.[stars] ?? 0;
        const pct = safeTotal > 0 ? (count / safeTotal) * 100 : 0;
        return (
          <div key={stars} className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1 w-10 text-muted-foreground">
              <span className="tabular-nums">{stars}</span>
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            </div>
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400/80 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-8 text-right tabular-nums text-muted-foreground">
              {count}
            </div>
          </div>
        );
      })}
    </div>
  );
}
