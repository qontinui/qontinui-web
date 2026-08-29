"use client";

/**
 * LogRow — render a single `coord.agent_logs` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 5 (Wave 3b).
 *
 * Compact one-line shape: [level] [time] event_name  agent_id_short
 * Click the row to expand the structured payload as JSON.
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Folded onto `<RecordRow>` / `<RecordDetail>` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`. This row was
 * ALREADY close to R2 — a `px-2.5 py-1.5` line with click-to-expand — so what
 * changed is small and mostly about consistency:
 *
 * - the slot ORDER is now the primitive's (identity → label → status → reason
 *   → time → chevron) rather than this file's own arrangement;
 * - the whole line is one `<button>` instead of a `<div onClick>`, so the
 *   expand affordance is keyboard-reachable;
 * - the payload lives in `<RecordDetail>`'s `raw` slot, which is where R5 puts
 *   raw ids and machine payloads.
 *
 * **The agent cross-link moved into the detail (D1).** It used to be a
 * `<button>` inside the row; `<RecordRow>` renders the row itself as a
 * `<button>`, and a button inside a button is invalid HTML that browsers
 * silently re-parent. It keeps its `log-row-agent-link` testid and now reads
 * "Open full page ↗", which is the same affordance every other console record
 * offers for its detail route.
 *
 * Every `data-testid` this component authored is carried across (D4a) —
 * `agent-log-row`, `agent-log-payload`, `log-row-source-badge`,
 * `log-row-agent-link` — as are `log-level-*` and `data-log-level`, which
 * `tests/e2e/pages/admin.spec.ts` asserts and which ride on the level chip.
 *
 * **Two row-level `data-*` attributes did NOT survive, and neither had a
 * consumer.** `<RecordRow>` writes `data-row-key` and forwards no arbitrary
 * `data-*`, so the row's own `data-log-level` and `data-agent-id` are gone.
 * Verified by grep across `src/`, `tests/` and all four committed page specs
 * before dropping them: nothing selects either (`data-log-level` still exists
 * INSIDE the row, on the level chip). Recorded here rather than silently,
 * because "no consumer today" is a measurement with a date on it.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { LevelBadge } from "@/components/admin/coord/LevelBadge";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  type Attention,
} from "@/components/console";

export interface AgentLogRow {
  log_id?: string | number;
  agent_id: string;
  agent_session_id?: string | null;
  device_id?: string | null;
  level?: string;
  event?: string;
  payload?: Record<string, unknown> | null;
  occurred_at?: string;
  /**
   * `true` when the agent has no `coord.agent_worktrees` row — an
   * interactive / runner-managed or PTY-CLI session rather than a
   * coord-spawned agent. Derived by coord's `get_recent`; `undefined`
   * on older coord shapes (then the badge is omitted).
   */
  is_interactive?: boolean;
  // Coord may use `ts` or `created_at` in older shapes — tolerate both.
  ts?: string;
  created_at?: string;
}

function shortId(id?: string | null, take = 8): string {
  if (!id) return "";
  return id.length > take ? `${id.slice(0, take)}…` : id;
}

/**
 * The left-edge accent, by log level. This is R4's mechanism, and the mapping
 * is R3's: `error` is the only level a human must act on, `warn` is the one
 * that says something else is degrading.
 *
 * A log line carries a LEVEL, not a `RowStatus` — the level IS the severity
 * model on this surface, and inventing a kind union to wrap five well-known
 * strings would be ceremony, not safety. So this maps level → **attention**
 * and hands that to the shared accent, rather than hand-spelling the border
 * literals as it used to: §4.1 is explicit that nothing outside `statusRow`
 * may mint a red or an amber, and two of these three lines were doing exactly
 * that. Tint drift here would have passed every audit, because
 * `paletteDisagreements` only ever sees a kind→class table and this file has
 * none.
 *
 * It also means the row gets `data-attention` for free, on the same terms as
 * every other console row.
 */
function levelAttention(level?: string): Attention {
  const l = (level ?? "info").toLowerCase();
  if (l === "error") return "author";
  if (l === "warn" || l === "warning") return "waiting";
  return "none";
}

/** A one-line preview of the payload, for the row's `reason` slot. */
function payloadPreview(payload?: Record<string, unknown> | null): string {
  if (!payload || typeof payload !== "object") return "";
  const keys = Object.keys(payload);
  if (keys.length === 0) return "";
  return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ", …" : "");
}

export interface LogRowProps {
  log: AgentLogRow;
  /** When set, the detail offers a cross-link to the per-agent view. */
  onAgentClick?: (agent_id: string) => void;
  /** When true, agent_id chip is omitted (we're already on a per-agent view). */
  hideAgentId?: boolean;
  expanded: boolean;
  onToggle: () => void;
}

export function LogRow({
  log,
  onAgentClick,
  hideAgentId = false,
  expanded,
  onToggle,
}: LogRowProps) {
  const occurredAt = log.occurred_at ?? log.ts ?? log.created_at ?? null;
  const hasPayload =
    log.payload != null &&
    typeof log.payload === "object" &&
    Object.keys(log.payload).length > 0;

  return (
    <RecordRow
      data-testid="agent-log-row"
      // KEPT, unlike the other rows that dropped theirs, because this row has
      // a call site with no `<RecordList>` above it: the agent-detail page
      // hand-rolls its `.map` and hoists expansion itself. Inside `/agents`'
      // list the list's key wins and this expression is dead — which is the
      // fix, since the two disagreed (the list's `??` chain has no
      // `created_at` leg, this one does).
      rowKey={String(log.log_id ?? `${log.agent_id}-${occurredAt ?? ""}`)}
      expanded={expanded}
      onToggle={onToggle}
      attention={levelAttention(log.level)}
      // The level IS this row's identity chip: it is the one short token that
      // classifies a log line, and `<RecordRow>` supplies the chip chrome
      // around it (hence `inline` — see `LevelBadge`).
      identity={<LevelBadge level={log.level} inline />}
      label={
        <span
          className="font-medium text-foreground"
          title={log.event ?? "(no event)"}
        >
          {log.event ?? "(no event)"}
        </span>
      }
      status={
        <>
          {log.is_interactive !== undefined && (
            <Badge
              data-testid="log-row-source-badge"
              variant={log.is_interactive ? "info" : "secondary"}
              className="text-[10px] px-1 py-0 leading-tight shrink-0"
              title={
                log.is_interactive
                  ? "Interactive / PTY-CLI session (no coord worktree)"
                  : "Coord-spawned agent (has a worktree)"
              }
            >
              {log.is_interactive ? "interactive" : "spawned"}
            </Badge>
          )}
          {!hideAgentId && (
            <span
              className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground shrink-0"
              title={`agent ${log.agent_id}`}
            >
              agent {shortId(log.agent_id, 8)}
            </span>
          )}
        </>
      }
      reason={payloadPreview(log.payload) || undefined}
      reasonTestId="agent-log-payload-preview"
      time={<RowTime at={occurredAt} verb="Logged" />}
    >
      <RecordDetail
        why={
          <div className="text-xs">
            <span className="text-muted-foreground">Event: </span>
            <span className="text-foreground/90">
              {log.event ?? "(no event)"}
            </span>
          </div>
        }
        actions={
          !hideAgentId && onAgentClick ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAgentClick(log.agent_id)}
              data-testid="log-row-agent-link"
              title={`Open the live view for agent ${log.agent_id}`}
            >
              Open full page
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          ) : undefined
        }
        raw={
          hasPayload ? (
            <pre
              data-testid="agent-log-payload"
              className="text-[11px] font-mono bg-muted/30 border border-border rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground/80"
            >
              {JSON.stringify(log.payload, null, 2)}
            </pre>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              (no payload)
            </p>
          )
        }
      />
    </RecordRow>
  );
}

export default LogRow;
