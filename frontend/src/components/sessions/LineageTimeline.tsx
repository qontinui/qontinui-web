"use client";

/**
 * Shared coord-lineage timeline renderer.
 *
 * Renders a `LineageAction[]` (the UNION ALL timeline coord builds across
 * `agent_worktrees` / `claims_audit` / `build_events` / `merge_proposals`)
 * grouped by kind under collapsible headers. Pure presentation — the
 * caller owns fetching + loading/error/empty states.
 *
 * Used by BOTH the admin Coordination Audit dashboard
 * (`components/admin/agent-sessions/AgentSessionsDashboard.tsx`) and the
 * per-session drill-down (`SessionDetail.tsx`), so the worktree/claim/
 * build/merge timeline renders identically in both places.
 */

import { useMemo } from "react";
import { ChevronDown, GitBranch, Hammer, Layers, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LineageAction, LineageActionKind } from "./types";

const KIND_ORDER: LineageActionKind[] = [
  "agent_worktree",
  "claim_event",
  "build_event",
  "merge_proposal",
];

function kindIcon(kind: LineageActionKind) {
  switch (kind) {
    case "agent_worktree":
      return <GitBranch className="h-3.5 w-3.5" />;
    case "claim_event":
      return <Lock className="h-3.5 w-3.5" />;
    case "build_event":
      return <Hammer className="h-3.5 w-3.5" />;
    case "merge_proposal":
      return <Layers className="h-3.5 w-3.5" />;
  }
}

function kindLabel(kind: LineageActionKind): string {
  switch (kind) {
    case "agent_worktree":
      return "Worktree spawn";
    case "claim_event":
      return "Claim event";
    case "build_event":
      return "Build event";
    case "merge_proposal":
      return "Merge proposal";
  }
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function LineageTimeline({
  actions,
  defaultGroupOpen = true,
}: {
  actions: LineageAction[];
  /** Whether each per-kind group starts expanded. */
  defaultGroupOpen?: boolean;
}) {
  const grouped = useMemo(() => {
    const m = new Map<LineageActionKind, LineageAction[]>();
    for (const a of actions) {
      const arr = m.get(a.kind) ?? [];
      arr.push(a);
      m.set(a.kind, arr);
    }
    return m;
  }, [actions]);

  return (
    <div className="space-y-2" data-testid="lineage-panel">
      {KIND_ORDER.filter((k) => (grouped.get(k) ?? []).length > 0).map(
        (kind) => {
          const kindActions = grouped.get(kind) ?? [];
          return (
            <Collapsible key={kind} defaultOpen={defaultGroupOpen}>
              <CollapsibleTrigger
                className="flex w-full items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60"
                data-testid={`lineage-group-${kind}`}
              >
                <ChevronDown className="h-3 w-3" />
                {kindIcon(kind)}
                {kindLabel(kind)}
                <Badge variant="outline" className="ml-auto">
                  {kindActions.length}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>handle</TableHead>
                      <TableHead className="w-[160px]">when</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kindActions.map((a, idx) => (
                      <TableRow key={`${a.kind}:${a.handle}:${idx}`}>
                        <TableCell className="font-mono text-xs">
                          {a.handle}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {relativeTime(a.occurred_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          );
        }
      )}
    </div>
  );
}
