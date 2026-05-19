"use client";

/**
 * LevelBadge — render a colored badge for an agent log level.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Five canonical levels: trace, debug, info, warn, error. Unknown
 * values render as a generic outline badge. The mapping mirrors what
 * coord stamps into `coord.agent_logs.level`.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | string;

interface LevelBadgeProps {
  level: LogLevel | undefined | null;
  className?: string;
}

function normalize(level: LogLevel | undefined | null): string {
  if (!level) return "info";
  const lower = String(level).toLowerCase();
  // Tolerate common synonyms emitted by structured loggers.
  if (lower === "warning") return "warn";
  if (lower === "err") return "error";
  return lower;
}

function styleFor(level: string): string {
  switch (level) {
    case "trace":
      return "bg-muted text-muted-foreground border-muted";
    case "debug":
      return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30";
    case "info":
      return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
    case "warn":
      return "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40";
    case "error":
      return "bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40";
    default:
      return "";
  }
}

export function LevelBadge({ level, className }: LevelBadgeProps) {
  const normalized = normalize(level);
  const style = styleFor(normalized);
  return (
    <Badge
      variant="outline"
      data-testid={`log-level-${normalized}`}
      data-log-level={normalized}
      className={cn(
        "font-mono uppercase text-[10px] tracking-wide px-1.5 py-0",
        style,
        className,
      )}
    >
      {normalized}
    </Badge>
  );
}

export default LevelBadge;
