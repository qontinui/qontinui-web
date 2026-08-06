"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Layers, RefreshCw } from "lucide-react";
import { useMigrationQueueStream } from "./useMigrationQueueStream";
import { useTenantDefaultRepo } from "./useTenantDefaultRepo";
import { CollapsiblePanel } from "./CollapsiblePanel";
import type { MigrationReservation } from "./types";

// ---------------------------------------------------------------------------
// State color-coding
// ---------------------------------------------------------------------------

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

/**
 * Map a reservation lifecycle `state` to a Badge variant. An unknown/future
 * coord state renders as a neutral outline chip (it never crashes the row —
 * honesty about uncertainty).
 *
 * - queued    → secondary (neutral, holding a slot, no PR yet)
 * - pr_bound  → info (blue — a PR is verified against the slot)
 * - merged    → success (green — landed)
 * - expired   → warning (amber — authoring window lapsed)
 * - withdrawn → outline (muted — voluntarily released)
 */
export function stateVariant(state: string): BadgeVariant {
  switch (state) {
    case "merged":
      return "success";
    case "pr_bound":
      return "info";
    case "expired":
      return "warning";
    case "queued":
      return "secondary";
    case "withdrawn":
      return "outline";
    default:
      return "outline";
  }
}

/** Short form of an alembic revision id — these are long hashes; the head
 *  8 chars are enough to recognize while keeping rows stable. Full id is
 *  available on hover via the row's `title`. */
function shortRev(rev: string | null | undefined): string {
  if (!rev) return "—";
  return rev.length > 12 ? rev.slice(0, 8) + "…" : rev;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** A live queue row — leads with the 1-based queue position (the field this
 *  tile exists to surface), then revision → down_revision chaining, state,
 *  and the requesting session. */
export function LiveRow({
  res,
  fallbackPosition,
}: {
  res: MigrationReservation;
  fallbackPosition: number;
}) {
  // Prefer coord's server-computed position; fall back to the list index for
  // older coord deploys that predate the field.
  const position = res.position ?? fallbackPosition;
  return (
    <li
      data-ui-bridge-id="operations.migration-queue-live-row"
      data-reservation-id={res.id}
      data-position={position}
      data-state={res.state}
      className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-sm"
    >
      <span
        className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full bg-primary/10 px-1.5 font-mono text-xs font-semibold tabular-nums text-primary"
        data-ui-bridge-id="operations.migration-queue-position"
        title={`queue position ${position}`}
      >
        #{position}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="font-mono font-medium truncate max-w-[9rem]"
            data-ui-bridge-id="operations.migration-queue-revision"
          >
            {shortRev(res.revision)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-[11px]">
          {res.revision}
          <br />
          chains off {res.down_revision || "(root)"}
        </TooltipContent>
      </Tooltip>

      <span className="text-muted-foreground text-xs shrink-0">←</span>
      <span
        className="font-mono text-xs text-muted-foreground truncate max-w-[7rem]"
        data-ui-bridge-id="operations.migration-queue-down-revision"
        title={res.down_revision || "(root)"}
      >
        {res.down_revision ? shortRev(res.down_revision) : "(root)"}
      </span>

      <Badge
        variant={stateVariant(res.state)}
        className="text-[10px] shrink-0"
        data-ui-bridge-id="operations.migration-queue-state"
      >
        {res.state}
      </Badge>

      <div className="flex-1 min-w-0" />

      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        {res.requested_by_session && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="font-mono max-w-[7rem] truncate"
                data-ui-bridge-id="operations.migration-queue-session"
              >
                {res.requested_by_session}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="font-mono text-[11px]">
              {res.requested_by_session}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

/**
 * Migration reservation queue tile for the operations dashboard. Renders
 * coord's coord-authoritative reservation queue for a repo (seeded from the
 * active tenant's first registered repo — see `useTenantDefaultRepo`): the
 * ordered live set — each row leading with its 1-based queue **position** and
 * showing how it chains off its predecessor.
 *
 * The queue is per-repo (coord requires `repo`), so the tile carries a small
 * repo input. Data comes from the `useMigrationQueueStream` poll hook;
 * modeled on `DevActionsTile` (section/header/list shape).
 */
export function MigrationQueueTile() {
  // `repo` is the committed selection driving the fetch; `repoInput` is the
  // in-progress text. Committing on submit/blur avoids a fetch per keystroke.
  // Both start empty and are seeded from the ACTIVE tenant's first registered
  // repo once it resolves — never a hardcoded operator repo. The stream hook
  // treats an empty repo as a settled-empty queue (no doomed fetch).
  const [repo, setRepo] = useState("");
  const [repoInput, setRepoInput] = useState("");
  // True once the user has typed/committed a repo themselves, so a late tenant
  // default resolution never clobbers their choice.
  const [userPicked, setUserPicked] = useState(false);
  const { defaultRepo, loading: defaultRepoLoading } = useTenantDefaultRepo();

  // Seed from the tenant default exactly once, and only while the user hasn't
  // made their own selection.
  useEffect(() => {
    if (!userPicked && !repo && defaultRepo) {
      setRepo(defaultRepo);
      setRepoInput(defaultRepo);
    }
  }, [defaultRepo, userPicked, repo]);

  const { live, seeded, error, refetch } = useMigrationQueueStream(repo);

  const commitRepo = useCallback(() => {
    const next = repoInput.trim();
    setUserPicked(true);
    if (next && next !== repo) setRepo(next);
  }, [repoInput, repo]);

  const liveRows = useMemo(() => live, [live]);

  return (
    <CollapsiblePanel
      data-ui-bridge-id="operations.migration-queue-tile"
      data-testid="operations-migration-queue-tile"
      storageKey="fleet:migration-queue"
      icon={<Layers className="w-4 h-4 text-muted-foreground shrink-0" />}
      title="Migration queue"
      summary={
        <Badge
          variant="outline"
          className="text-[10px] shrink-0"
          data-ui-bridge-id="operations.migration-queue-count"
        >
          {liveRows.length}
        </Badge>
      }
      headerActions={
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              commitRepo();
            }}
          >
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onBlur={commitRepo}
              spellCheck={false}
              aria-label="Repository (owner/name)"
              placeholder="owner/repo"
              className="w-44 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-ui-bridge-id="operations.migration-queue-repo-input"
            />
          </form>
          {error && (
            <Badge variant="destructive" className="text-[10px]">
              error
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30"
            data-ui-bridge-id="operations.migration-queue-refresh"
            aria-label="Refresh migration queue"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </>
      }
    >
      {!repo ? (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          {defaultRepoLoading
            ? "Loading migration queue…"
            : "No repository selected. Enter an owner/repo above to view its migration queue."}
        </p>
      ) : !seeded && liveRows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          Loading migration queue&hellip;
        </p>
      ) : (
        <>
          {liveRows.length === 0 ? (
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
              No live reservations for{" "}
              <span className="font-mono text-foreground/80">{repo}</span>. The
              chain is idle — the next author to reserve a slot takes position
              #1.
            </div>
          ) : (
            <ul
              className="flex flex-col gap-1.5"
              data-ui-bridge-id="operations.migration-queue-live-list"
            >
              {liveRows.map((res, i) => (
                <LiveRow key={res.id} res={res} fallbackPosition={i + 1} />
              ))}
            </ul>
          )}
        </>
      )}
    </CollapsiblePanel>
  );
}
