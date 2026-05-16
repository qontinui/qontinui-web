"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { StrategyDocSummary } from "@/lib/api/strategy";

/**
 * Doc list rail shared by the index and the per-doc viewer. Phase 1
 * is read-only: no thread/comment affordances (Phase 2).
 */
export function StrategySidebar({
  docs,
  activeName,
}: {
  docs: StrategyDocSummary[];
  activeName?: string;
}) {
  return (
    <nav className="w-64 shrink-0 border-r border-border overflow-y-auto">
      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Strategy
      </div>
      <ul>
        {docs.map((d) => (
          <li key={d.name}>
            <Link
              href={`/strategy/${encodeURIComponent(d.name)}`}
              className={cn(
                "block px-4 py-2 text-sm hover:bg-accent",
                d.name === activeName &&
                  "bg-accent font-medium text-accent-foreground"
              )}
            >
              {d.title}
            </Link>
          </li>
        ))}
        {docs.length === 0 && (
          <li className="px-4 py-2 text-sm text-muted-foreground">
            No strategy documents.
          </li>
        )}
      </ul>
    </nav>
  );
}
