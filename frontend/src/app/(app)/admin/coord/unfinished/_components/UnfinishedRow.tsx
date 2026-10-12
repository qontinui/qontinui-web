"use client";

import { Loader2, RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordDetail, RecordRow, RowTime } from "@/components/console";
import {
  resumeBlockedReason,
  transcriptText,
  verdictLabel,
} from "../_lib/unfinished";
import type { UnfinishedSession } from "@/lib/api/operations/unfinished";

interface Props {
  row: UnfinishedSession;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  canAct: boolean;
  onResume: (row: UnfinishedSession) => void;
  onDismiss: (row: UnfinishedSession) => void;
}

/**
 * One unfinished session. `liveness: "unknown"` is shown as such — the process
 * could not be shown gone, which is not the same as gone.
 */
export function UnfinishedRow({
  row,
  expanded,
  onToggle,
  busy,
  canAct,
  onResume,
  onDismiss,
}: Props) {
  const blocked = resumeBlockedReason(row);
  const gone = row.liveness === "process_gone";
  const where = row.hostname ?? "unknown host";
  const what = row.work_unit_slug ?? row.worktree_path ?? row.claude_session_id;

  return (
    <RecordRow
      data-testid="unfinished-row"
      rowKey={row.claude_session_id}
      expanded={expanded}
      onToggle={onToggle}
      identity={<span className="font-mono text-[11px]">{where}</span>}
      label={
        <span title={what}>
          <span className="font-mono">{what}</span>
          {row.account_label && (
            <span className="text-muted-foreground">
              {" "}
              — {row.account_label}
            </span>
          )}
        </span>
      }
      status={
        <>
          <Badge
            variant="outline"
            data-testid="unfinished-liveness"
            data-liveness={row.liveness}
            title={
              gone
                ? `Process shown gone (basis: ${row.liveness_basis ?? "unstated"})`
                : "Could not show the process gone or alive"
            }
          >
            {gone ? "process gone" : "liveness unknown"}
          </Badge>
          <span
            className="hidden text-[11px] text-muted-foreground sm:inline"
            data-testid="unfinished-verdict"
          >
            sweep: {verdictLabel(row.resume_verdict)}
          </span>
        </>
      }
      time={
        <RowTime
          at={row.closed_at}
          verb="Closed"
          absent={{
            label: "close time unknown",
            title: "Coord recorded no close time — unknown, not never",
          }}
        />
      }
    >
      <RecordDetail
        data-testid="unfinished-detail"
        why={
          <p className="text-xs text-muted-foreground">
            Closed without being marked finished. Resume respawns it on its
            original device under its original account; Dismiss marks it
            finished (reason &quot;dismissed&quot;) so it stops appearing.
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !canAct || blocked !== null}
              title={
                blocked ?? (canAct ? "Respawn this session" : "Admin only")
              }
              onClick={() => onResume(row)}
              data-testid="unfinished-resume"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Resume
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canAct}
              title={canAct ? "Mark finished (dismissed)" : "Admin only"}
              onClick={() => onDismiss(row)}
              data-testid="unfinished-dismiss"
            >
              <XCircle className="size-3.5" />
              Dismiss
            </Button>
            {blocked && (
              <span
                className="text-xs text-muted-foreground"
                data-testid="unfinished-resume-blocked"
              >
                {blocked}
              </span>
            )}
          </div>
        }
        history={
          <div className="text-xs text-muted-foreground">
            Last acted:{" "}
            <RowTime
              at={row.last_acted_at}
              verb="Last acted"
              absent={{
                label: "unknown",
                title: "Coord recorded no last-acted time — unknown, not never",
              }}
            />{" "}
            · last resume attempt:{" "}
            <RowTime at={row.last_resume_attempt_at} verb="Attempted" /> · last
            verdict: {verdictLabel(row.resume_verdict)}
          </div>
        }
        raw={
          <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground/60">
            <div>claude {row.claude_session_id}</div>
            <div>coord {row.coord_session_id}</div>
            <div>device {row.device_id ?? "unknown"}</div>
            <div>config_dir {row.config_dir ?? "unknown"}</div>
            <div>working_dir {row.working_dir ?? "unknown"}</div>
            <div>worktree {row.worktree_path ?? "unknown"}</div>
            <div>{transcriptText(row)}</div>
          </div>
        }
      />
    </RecordRow>
  );
}
