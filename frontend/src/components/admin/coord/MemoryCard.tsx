"use client";

/**
 * MemoryCard — render a single `coord.memories` row in list views.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 6 (Wave 3c).
 *
 * Per resolved decision Q3, every memory is event-sourced (immutable
 * version rows; LWW for reads). The list view shows the latest version
 * — `version` here is the monotonic head, NOT the version count.
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
// TODO: Re-export from @qontinui/shared-types once MemorySummary is published.
// Locally aliased to unblock compilation.
type MemorySummary = {
  name: string;
  version: number;
  updated_at: string;
  written_at?: string | null;
  type?: string | null;
  description?: string | null;
  tags?: string[];
};

/**
 * Wire-format row for the coord memory list view. Sources both the
 * `/coord/memory/list` summary projection (no `content`) and the
 * `/coord/memory/:name` full row — the dashboard only renders the
 * fields they have in common, so a permissive shape covering both
 * keeps the card reusable. `MemorySummary` is the canonical promoted
 * type (qontinui-schemas/rust/src/memory.rs).
 */
export type CoordMemoryRow = MemorySummary & {
  /** Only present when this row came from `/coord/memory/:name` (full
   * `MemoryRow` shape) — the list endpoint strips these. */
  written_by_agent?: string | null;
  written_by_device?: string | null;
};

function typeVariant(
  type?: string | null
): "default" | "destructive" | "secondary" | "outline" {
  switch ((type ?? "").toLowerCase()) {
    case "project":
    case "proj":
      return "default";
    case "feedback":
      return "secondary";
    case "reference":
    case "ref":
      return "outline";
    default:
      return "outline";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function MemoryCard({ memory }: { memory: CoordMemoryRow }) {
  return (
    <Link
      href={`/admin/coord/memory/${encodeURIComponent(memory.name)}`}
      data-testid="coord-memory-card"
      className="block"
    >
      <Card className="hover:bg-muted/50 transition-colors">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span
              className="font-mono text-sm font-medium truncate"
              data-testid="coord-memory-card-name"
            >
              {memory.name}
            </span>
            {memory.type && (
              <Badge variant={typeVariant(memory.type)}>{memory.type}</Badge>
            )}
            {memory.version !== null && memory.version !== undefined && (
              <Badge variant="outline" className="text-xs">
                v{memory.version}
              </Badge>
            )}
          </div>
          {memory.description && (
            <p
              className="text-sm text-foreground"
              data-testid="coord-memory-card-description"
            >
              {truncate(memory.description, 160)}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {memory.written_at && <span>updated {memory.written_at}</span>}
            {memory.written_by_agent && (
              <span>by {memory.written_by_agent}</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
