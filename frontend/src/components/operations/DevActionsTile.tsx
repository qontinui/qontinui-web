"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  ListChecks,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { devActionDetailUrl, relativeTime } from "./utils";
import { useDevActionsStream } from "./useDevActionsStream";
import { CollapsiblePanel } from "./CollapsiblePanel";
import type {
  DevAction,
  DevActionCategory,
  DevActionDetail,
  DevActionOutcome,
} from "./types";

// ---------------------------------------------------------------------------
// Category color-coding
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
 * Map a D3 cause→effect `category` to a Badge variant. An unknown/absent
 * category renders as a neutral outline chip (honesty-about-uncertainty —
 * a future coord category never crashes the row, it just looks neutral).
 *
 * - contradiction / failure → destructive (red)
 * - confirmed              → success (green)
 * - surprise               → warning (amber)
 * - partial                → info (blue)
 */
function categoryVariant(category: string | null | undefined): BadgeVariant {
  switch (category as DevActionCategory) {
    case "confirmed":
      return "success";
    case "failure":
    case "contradiction":
      return "destructive";
    case "surprise":
      return "warning";
    case "partial":
      return "info";
    default:
      return "outline";
  }
}

function categoryLabel(category: string | null | undefined): string {
  if (!category) return "unknown";
  return category;
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs == null || Number.isNaN(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${minutes}m${remSec.toString().padStart(2, "0")}s`;
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

// ---------------------------------------------------------------------------
// State chips
// ---------------------------------------------------------------------------

const STATE_CHIPS_MAX = 6;

function StateChips({
  stateIds,
  statesUnknown,
}: {
  stateIds: string[];
  statesUnknown: string[];
}) {
  const known = stateIds ?? [];
  const unknown = statesUnknown ?? [];
  const total = known.length + unknown.length;

  if (total === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">
        no active states
      </span>
    );
  }

  const shownKnown = known.slice(0, STATE_CHIPS_MAX);
  const remaining = total - shownKnown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shownKnown.map((s) => (
        <Badge
          key={s}
          variant="secondary"
          className="text-[10px] font-mono max-w-[10rem] truncate"
          title={s}
          data-ui-bridge-id="operations.dev-action-state-chip"
        >
          {s}
        </Badge>
      ))}
      {remaining > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[10px]">
              +{remaining} more
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="flex flex-col gap-0.5 font-mono text-[11px]">
              {[...known.slice(STATE_CHIPS_MAX), ...unknown].map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-action outcome drill-down
// ---------------------------------------------------------------------------

interface OutcomeState {
  loading: boolean;
  outcomes: DevActionOutcome[] | null;
  error: string | null;
}

function OutcomeList({ state }: { state: OutcomeState }) {
  if (state.loading) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
        data-ui-bridge-id="operations.dev-action-outcomes-loading"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading outcomes&hellip;
      </div>
    );
  }
  if (state.error) {
    return (
      <p className="px-3 py-2 text-xs text-destructive">
        Failed to load outcomes: {state.error}
      </p>
    );
  }
  const outcomes = state.outcomes ?? [];
  if (outcomes.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground italic">
        No outcome signatures recorded yet.
      </p>
    );
  }
  return (
    <ul
      className="flex flex-col gap-1 px-3 py-2"
      data-ui-bridge-id="operations.dev-action-outcomes-list"
    >
      {outcomes.map((o, i) => (
        <li
          key={`${o.signature}-${i}`}
          data-ui-bridge-id="operations.dev-action-outcome-row"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span
            className="font-mono truncate text-foreground/90"
            title={o.signature}
          >
            {o.signature}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {o.late && (
              <Badge variant="warning" className="text-[10px]">
                late
              </Badge>
            )}
            <span
              className="tabular-nums text-muted-foreground"
              title={
                o.observed_at ? new Date(o.observed_at).toLocaleString() : ""
              }
            >
              {relativeTime(o.observed_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DevActionRow({ action }: { action: DevAction }) {
  const [expanded, setExpanded] = useState(false);
  const [outcomeState, setOutcomeState] = useState<OutcomeState>({
    loading: false,
    outcomes: null,
    error: null,
  });

  const loadOutcomes = useCallback(async () => {
    setOutcomeState({ loading: true, outcomes: null, error: null });
    try {
      const resp = await httpClient.fetch(devActionDetailUrl(action.action_id));
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as DevActionDetail;
      setOutcomeState({
        loading: false,
        outcomes: data.outcomes ?? [],
        error: null,
      });
    } catch (err) {
      setOutcomeState({
        loading: false,
        outcomes: null,
        error: err instanceof Error ? err.message : "fetch failed",
      });
    }
  }, [action.action_id]);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      // Lazy-load outcomes the first time the row is opened.
      if (next && outcomeState.outcomes === null && !outcomeState.loading) {
        void loadOutcomes();
      }
      return next;
    });
  }, [loadOutcomes, outcomeState.outcomes, outcomeState.loading]);

  const duration = formatDuration(action.duration_ms);
  const startedLabel = relativeTime(action.started_at);

  return (
    <li
      data-ui-bridge-id="operations.dev-action-row"
      data-action-id={action.action_id}
      data-category={action.category ?? "unknown"}
      className="rounded-md border border-border/40 bg-muted/10"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/30 rounded-md"
        data-ui-bridge-id="operations.dev-action-toggle"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>

        <span
          className="font-mono font-medium truncate min-w-[8rem] max-w-[14rem]"
          data-ui-bridge-id="operations.dev-action-kind"
          title={action.kind}
        >
          {action.kind}
        </span>

        <Badge
          variant={categoryVariant(action.category)}
          className="text-[10px] shrink-0"
          data-ui-bridge-id="operations.dev-action-category"
        >
          {categoryLabel(action.category)}
        </Badge>

        <div className="flex-1 min-w-0">
          <StateChips
            stateIds={action.state_ids}
            statesUnknown={action.states_unknown}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
          {duration && (
            <span
              className="tabular-nums"
              data-ui-bridge-id="operations.dev-action-duration"
            >
              {duration}
            </span>
          )}
          {action.requester_id && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="font-mono max-w-[7rem] truncate"
                  data-ui-bridge-id="operations.dev-action-requester"
                >
                  {shortId(action.requester_id)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="font-mono text-[11px]">
                {action.requester_id}
              </TooltipContent>
            </Tooltip>
          )}
          <span
            className="tabular-nums"
            data-ui-bridge-id="operations.dev-action-started-at"
            title={
              action.started_at
                ? new Date(action.started_at).toLocaleString()
                : ""
            }
          >
            {startedLabel}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/40">
          <OutcomeList state={outcomeState} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

/**
 * Dev-action ledger tile for the operator/fleet dashboard. Renders the
 * recent dev actions from coord's `dev_action_snapshots` ledger — kind,
 * the active dev-state set (chips), a color-coded D3 `category` badge,
 * duration, requester, and relative time — with per-action outcome
 * signatures expandable on click via the `:action_id` detail endpoint.
 *
 * Plan `2026-06-07-twin-dev-event-cause-effect-ledger.md`. Models on
 * `DeviceStatusTile` (same section/header/list shape + a tick clock for
 * relative-time refresh) but holds its own poll stream
 * (`useDevActionsStream`) since the ledger is a standalone surface.
 */
export function DevActionsTile() {
  const { actions, seeded, error, refetch } = useDevActionsStream();
  const [, setNowTick] = useState(0);

  // Tick every 15s so relative-time labels refresh without a server event.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => actions, [actions]);
  // Failures/contradictions are the signal an operator cares about — surface a
  // count in the header so it stays visible even when the panel is collapsed.
  const failures = useMemo(
    () =>
      rows.filter(
        (a) => a.category === "failure" || a.category === "contradiction"
      ).length,
    [rows]
  );

  return (
    <CollapsiblePanel
      data-ui-bridge-id="operations.dev-actions-tile"
      data-testid="operations-dev-actions-tile"
      storageKey="fleet:dev-actions"
      icon={<ListChecks className="w-4 h-4 text-muted-foreground" />}
      title="Dev actions"
      summary={
        <>
          <Badge variant="outline" className="text-[10px]">
            {rows.length}
          </Badge>
          {failures > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {failures} failed
            </Badge>
          )}
        </>
      }
      headerActions={
        <>
          {error && (
            <Badge variant="destructive" className="text-[10px]">
              error
            </Badge>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30"
            data-ui-bridge-id="operations.dev-actions-refresh"
            aria-label="Refresh dev actions"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </>
      }
    >
      {!seeded && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-2 py-3">
          Loading dev actions&hellip;
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border/40 bg-muted/10 p-3 text-xs text-muted-foreground">
          No dev actions recorded yet. Agents record actions into the ledger via
          coord; rows appear here as they execute.
        </div>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          data-ui-bridge-id="operations.dev-actions-list"
        >
          {rows.map((action) => (
            <DevActionRow key={action.action_id} action={action} />
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
