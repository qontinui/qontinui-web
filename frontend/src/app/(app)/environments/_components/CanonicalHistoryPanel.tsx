"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CANONICAL_HISTORY_PAGE_SIZE,
  DevenvApiError,
  getCanonicalHistory,
  type CanonicalChange,
} from "@/services/devenv-api";
import {
  actorLabel,
  describeLatestChange,
  formatChangedAt,
  isInitialDesignation,
  machineLabel,
} from "./canonical-history";

/** How many rows the collapsed list shows before "Show all". */
const COLLAPSED_ROWS = 3;

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof DevenvApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

interface CanonicalHistoryPanelProps {
  environmentId: string;
  /**
   * Bumped by the parent after a successful designation so the panel refetches
   * — the change it just made should appear without a page reload.
   */
  refreshKey?: number;
}

/**
 * The canonical-designation audit trail for an environment: the most recent
 * change inline ("Canonical set by X at Y") plus a short from → to history.
 *
 * Rendered beside `CanonicalSelector` — the control that CHANGES canonical —
 * so "who set this, and when" sits with the thing that sets it.
 *
 * Three states worth calling out:
 * - **empty** is the CORRECT state until the next designation (the audit only
 *   records changes made after it shipped) — an explicit friendly note, never
 *   a spinner and never an error;
 * - **error** is inline and non-blocking (the selector above still works);
 * - **null names** are by design (soft machine refs + `SET NULL` user FK) and
 *   degrade through the helpers in `./canonical-history`.
 */
export function CanonicalHistoryPanel({
  environmentId,
  refreshKey = 0,
}: CanonicalHistoryPanelProps) {
  const [changes, setChanges] = useState<CanonicalChange[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** True while the backend may hold older pages beyond what's accumulated. */
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Bumped by Retry so the reload runs through the effect (and stays cancellable). */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await getCanonicalHistory(environmentId);
        if (cancelled) return;
        setChanges(list);
        setHasMore(list.length === CANONICAL_HISTORY_PAGE_SIZE);
      } catch (err) {
        if (cancelled) return;
        setChanges(null);
        setError(errMessage(err, "Failed to load canonical history"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId, refreshKey, reloadKey]);

  const loadMore = async () => {
    if (!changes || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await getCanonicalHistory(
        environmentId,
        CANONICAL_HISTORY_PAGE_SIZE,
        changes.length
      );
      setChanges((prev) => [...(prev ?? []), ...next]);
      setHasMore(next.length === CANONICAL_HISTORY_PAGE_SIZE);
    } catch (err) {
      // Toast, not the inline error state: the rows already on screen stay —
      // failing to fetch OLDER history must not hide the history we have.
      toast.error(errMessage(err, "Failed to load older changes"));
    } finally {
      setLoadingMore(false);
    }
  };

  // Spinner only when there is nothing to show. A refresh after a designation
  // keeps the existing rows on screen rather than flashing back to a spinner.
  if (loading && !changes) {
    return (
      <div
        className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
        aria-busy="true"
      >
        <Loader2 className="size-4 animate-spin" />
        Loading canonical history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-border p-3 text-xs">
        <p className="text-muted-foreground">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Retry
        </Button>
      </div>
    );
  }

  // An empty audit trail is the expected state, not a failure: the log only
  // records designations made after it shipped.
  if (!changes || changes.length === 0) {
    return (
      <div className="rounded-md border border-border p-3 text-center">
        <History className="size-4 mx-auto mb-1 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          No canonical changes recorded yet. The next time someone designates a
          canonical machine, it will be logged here with who and when.
        </p>
      </div>
    );
  }

  // Non-null: the empty case returned above. Newest-first, so [0] is latest.
  const latest = changes[0]!;
  const visible = expanded ? changes : changes.slice(0, COLLAPSED_ROWS);
  const hidden = changes.length - visible.length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <History className="size-3.5 shrink-0" />
        <span className="truncate">{describeLatestChange(latest)}</span>
      </p>

      <div className="rounded-md border border-border divide-y divide-border">
        {visible.map((change) => (
          <CanonicalChangeRow key={change.id} change={change} />
        ))}
      </div>

      {changes.length > COLLAPSED_ROWS && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
          {expanded
            ? "Show fewer"
            : `Show ${hidden} older change${hidden === 1 ? "" : "s"}`}
        </Button>
      )}

      {/* A full page means older rows exist beyond it. Offer to fetch them —
          an audit trail that looks complete but isn't is worse than none, and
          a bare "older ones are not listed" would be a dead end. */}
      {expanded && hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
        >
          {loadingMore ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ChevronDown className="size-4" />
          )}
          Load older changes
        </Button>
      )}
    </div>
  );
}

function CanonicalChangeRow({ change }: { change: CanonicalChange }) {
  const initial = isInitialDesignation(change);
  const from = initial
    ? "—"
    : machineLabel(change.from_machine_name, change.from_machine_id, "—");
  const to = machineLabel(
    change.to_machine_name,
    change.to_machine_id,
    "no machine"
  );

  return (
    <div className="px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-muted-foreground">{from}</span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{to}</span>
        {initial && (
          <Badge variant="secondary" className="shrink-0">
            initial
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 min-w-0 text-muted-foreground">
        <span className="truncate">
          {actorLabel(change.changed_by_email, change.changed_by_user_id)}
        </span>
        <span className="shrink-0">{formatChangedAt(change.changed_at)}</span>
      </div>
      {change.note && (
        <p className="text-muted-foreground italic break-words">
          {change.note}
        </p>
      )}
    </div>
  );
}
