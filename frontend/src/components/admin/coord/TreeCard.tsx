"use client";

/**
 * TreeCard — render a single `coord.primary_trees` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Visual rules:
 *  - "dirty" badge when row.dirty=true
 *  - Stale-WIP highlighting (24h+ warning, 72h+ critical) keyed off
 *    `last_seen` (or `wip_last_modified` if present).
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, AlertTriangle } from "lucide-react";

export interface PrimaryTreeRow {
  device_id?: string;
  hostname?: string;
  repo: string;
  primary_path: string;
  branch?: string | null;
  dirty?: boolean;
  last_seen?: string | null;
  wip_last_modified?: string | null;
}

function hoursAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 3_600_000;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const h = hoursAgo(iso);
  if (h === null) return "—";
  if (h < 1) return `${Math.max(0, Math.floor(h * 60))}m ago`;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TreeCard({ tree }: { tree: PrimaryTreeRow }) {
  const wipHours =
    hoursAgo(tree.wip_last_modified ?? null) ?? hoursAgo(tree.last_seen ?? null);
  const isCritical = tree.dirty && wipHours !== null && wipHours >= 72;
  const isWarning =
    tree.dirty && wipHours !== null && wipHours >= 24 && wipHours < 72;

  return (
    <Card
      data-testid="coord-tree-card"
      className={
        isCritical
          ? "border-destructive"
          : isWarning
            ? "border-amber-500"
            : undefined
      }
    >
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm font-medium">{tree.repo}</span>
          {tree.dirty && (
            <Badge variant="destructive" data-testid="coord-tree-dirty-badge">
              dirty
            </Badge>
          )}
          {isCritical && (
            <Badge
              variant="destructive"
              className="gap-1"
              data-testid="coord-tree-stale-critical"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 72h+
            </Badge>
          )}
          {isWarning && (
            <Badge
              variant="secondary"
              className="gap-1"
              data-testid="coord-tree-stale-warning"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 24h+
            </Badge>
          )}
          {tree.branch && (
            <Badge variant="outline" className="font-mono text-xs">
              {tree.branch}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono break-all">
          {tree.primary_path}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {tree.hostname && <span>host: {tree.hostname}</span>}
          {tree.device_id && (
            <Link
              href={`/admin/coord/fleet`}
              className="hover:text-foreground"
            >
              device: {tree.device_id.slice(0, 8)}…
            </Link>
          )}
          <span>last_seen: {relativeTime(tree.last_seen)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
