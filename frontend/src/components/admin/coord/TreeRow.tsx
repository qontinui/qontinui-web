"use client";

/**
 * TreeRow — one `coord.primary_trees` row, on one line, detail on click.
 *
 * Replaces `TreeCard` on `/admin/coord/trees`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `AlertRow.tsx`, this wave's reference implementation.
 *
 * `/trees` is the route the plan singled out (§4): `TreeCard` had **zero**
 * `useState` and **zero** `onClick` — everything it knew was already on the
 * card, which is exactly why the card was three lines tall. It paid the
 * density cost to avoid a click and got neither. This row keeps the scannable
 * signals on the line (verdict, dirty, stale, ahead — all frozen testids) and
 * moves the path, the host, the device id and the timestamps into a
 * `<RecordDetail>` that did not exist before.
 *
 * **The verdict badge is no longer a `<Link>`.** `<RecordRow>` renders the
 * whole line as one `<button>` so the expand affordance is keyboard-reachable,
 * and an anchor inside a button is invalid HTML. The pull-decisions
 * cross-link moved into the detail's actions slot, which is where D1 puts it
 * anyway. The badge keeps its `coord-tree-verdict-<kind>` testid.
 *
 * Every `data-testid` `TreeCard` authored is carried across (D4a):
 * `coord-tree-card`, `coord-tree-dirty-badge`, `coord-tree-stale-critical`,
 * `coord-tree-stale-warning`, `coord-tree-ahead-badge`, and the five
 * `coord-tree-verdict-*`.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowUp, ExternalLink } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  TREE_STATUS_PALETTE,
  deriveTreeStatus,
  pullDecisionsHref,
  pullSafetyClass,
  staleBand,
  verdictReason,
  verdictTestId,
  type PrimaryTreeRow,
} from "@/components/admin/coord/treeStatus";

export type { PrimaryTreeRow };

export function TreeRow({
  tree,
  expanded,
  onToggle,
}: {
  tree: PrimaryTreeRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveTreeStatus(tree);
  const cls = pullSafetyClass(tree);
  const band = staleBand(tree);
  const localAhead = tree.local_ahead ?? 0;
  const behind = tree.behind_count ?? 0;

  return (
    <RecordRow
      data-testid="coord-tree-card"
      rowKey={`${tree.device_id ?? "no-device"}:${tree.repo}`}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      identity={tree.repo}
      label={
        <span className="font-mono text-xs" title={tree.primary_path}>
          {tree.primary_path}
        </span>
      }
      status={
        <span className="flex items-center gap-1.5 shrink-0">
          {/* The verdict badge. Wrapped rather than replaced: the
              `coord-tree-verdict-<kind>` testid is frozen (D4a) and is what
              `specs/pages/coord-trees` asserts, and `<StatusBadge>` —
              correctly — takes no testid. Wrapping keeps the primitive and the
              contract; a second badge implementation would keep neither. */}
          <span className="inline-flex" data-testid={verdictTestId(cls.kind)}>
            <StatusBadge status={status} palette={TREE_STATUS_PALETTE} />
          </span>
          {tree.branch && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] hidden md:inline-flex"
            >
              {tree.branch}
            </Badge>
          )}
          {tree.dirty && (
            <Badge
              variant="destructive"
              className="text-[10px]"
              data-testid="coord-tree-dirty-badge"
            >
              dirty
            </Badge>
          )}
          {band === "critical" && (
            <Badge
              variant="destructive"
              className="gap-1 text-[10px]"
              data-testid="coord-tree-stale-critical"
              title="uncommitted work untouched for 72h or more — only a human clears this"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 72h+
            </Badge>
          )}
          {band === "warning" && (
            // Red, not the neutral `secondary` this started as: after the
            // Wave-1 review's Ruling 1 BOTH dirty bands are `author`, and a
            // grey badge on a row whose accent is red is the same R3 drift
            // one level down. The 24h/72h gradation lives in the TEXT.
            <Badge
              variant="destructive"
              className="gap-1 text-[10px]"
              data-testid="coord-tree-stale-warning"
              title="uncommitted work untouched for 24h or more — only a human clears this"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 24h+
            </Badge>
          )}
          {localAhead > 0 && (
            <Badge
              variant="warning"
              className="gap-1 text-[10px]"
              title="unpushed local commits ahead of origin"
              data-testid="coord-tree-ahead-badge"
            >
              <ArrowUp className="h-3 w-3" />
              {localAhead} ahead
            </Badge>
          )}
        </span>
      }
      reason={verdictReason(cls)}
      time={
        <RowTime
          at={tree.last_seen ?? null}
          verb="Last seen"
          absent={{
            label: "never seen",
            title: "coord has recorded no observation of this tree",
          }}
        />
      }
    >
      <RecordDetail
        why={
          <div className="text-xs">
            <span className="text-muted-foreground">Verdict: </span>
            <span className="text-foreground/90">{verdictReason(cls)}</span>
          </div>
        }
        problems={
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              branch{" "}
              <span className="font-mono text-foreground/90">
                {tree.branch || "(unknown)"}
              </span>
            </span>
            <span>
              behind{" "}
              <span className="tabular-nums text-foreground/90">{behind}</span>
            </span>
            <span>
              ahead{" "}
              <span className="tabular-nums text-foreground/90">
                {localAhead}
              </span>
            </span>
            {tree.untracked_count != null && (
              <span>
                untracked{" "}
                <span className="tabular-nums text-foreground/90">
                  {tree.untracked_count}
                </span>
              </span>
            )}
            {tree.head_detached === true && (
              <span className="text-red-300">HEAD is detached</span>
            )}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={pullDecisionsHref(tree)} data-testid="coord-tree-pull-link">
              <Button variant="outline" size="sm">
                Pull decisions
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
            {tree.device_id && (
              <Link href="/admin/coord/fleet">
                <Button variant="ghost" size="sm">
                  Fleet
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            )}
          </div>
        }
        history={
          <div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
            {tree.hostname && <span>host {tree.hostname}</span>}
            <span className="inline-flex items-center gap-1">
              last seen{" "}
              <RowTime at={tree.last_seen ?? null} verb="Last seen" />
            </span>
            {tree.wip_last_modified && (
              <span className="inline-flex items-center gap-1">
                WIP touched{" "}
                <RowTime at={tree.wip_last_modified} verb="WIP last modified" />
              </span>
            )}
          </div>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            {tree.primary_path}
            {tree.device_id ? ` · device ${tree.device_id}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
