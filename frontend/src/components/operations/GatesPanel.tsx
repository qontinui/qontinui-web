"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  BellOff,
  CheckCircle2,
  Clock,
  ShieldCheck,
  SignpostBig,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import {
  gateApproveUrl,
  gateMuteUrl,
  gateSnoozeUrl,
  gateUnmuteUrl,
  relativeTime,
} from "./utils";
import { gateAnchor, humanizePredicate } from "./gatesPredicate";
import { useGatesStream } from "./useGatesStream";
import type { GateRow, GateVerdict } from "./types";

const log = createLogger("GatesPanel");

// ---------------------------------------------------------------------------
// Verdict badge
// ---------------------------------------------------------------------------

function verdictVariant(
  verdict: GateVerdict,
): "outline" | "success" | "destructive" {
  switch (verdict) {
    case "cleared":
      return "success";
    case "failed":
      return "destructive";
    case "open":
    default:
      return "outline";
  }
}

// ---------------------------------------------------------------------------
// Snooze presets
// ---------------------------------------------------------------------------

const SNOOZE_PRESETS: { label: string; secs: number }[] = [
  { label: "1 hour", secs: 3_600 },
  { label: "1 day", secs: 86_400 },
  { label: "1 week", secs: 604_800 },
];

/** ISO timestamp `secs` from now — the `until` value for a snooze. */
function snoozeUntilIso(secs: number): string {
  return new Date(Date.now() + secs * 1_000).toISOString();
}

// ---------------------------------------------------------------------------
// Per-gate action state
// ---------------------------------------------------------------------------

type ActionState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

interface GateRowProps {
  gate: GateRow;
  /** Refetch the whole list after a successful action (server is source
   *  of truth — we refetch rather than optimistically mutate so the row
   *  reflects coord's real post-action state). */
  onActed: () => void;
}

function GateRowView({ gate, onActed }: GateRowProps) {
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  const predicateText = useMemo(
    () => humanizePredicate(gate.predicate),
    [gate.predicate],
  );

  const isSnoozed = useMemo(() => {
    if (!gate.snoozed_until) return false;
    const until = new Date(gate.snoozed_until).getTime();
    return !Number.isNaN(until) && until > Date.now();
  }, [gate.snoozed_until]);

  const isApprovable =
    gate.predicate?.kind === "operator_approval" && gate.verdict === "open";

  // POST helper — every action surfaces its error inline (honesty: never a
  // silent failure) and refetches the list on success.
  const runAction = useCallback(
    async (url: string, body: Record<string, unknown> | undefined) => {
      setAction({ kind: "busy" });
      try {
        const res = await httpClient.fetch(url, {
          method: "POST",
          body: body ? JSON.stringify(body) : JSON.stringify({}),
        });
        if (!res.ok) {
          const text = await res.text();
          log.warn("gate action failed", url, res.status, text);
          setAction({ kind: "error", message: `HTTP ${res.status}` });
          return;
        }
        setAction({ kind: "idle" });
        onActed();
      } catch (err) {
        log.warn("gate action threw", url, err);
        setAction({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [onActed],
  );

  const onApprove = useCallback(() => {
    void runAction(gateApproveUrl(gate.gate_id), undefined);
  }, [runAction, gate.gate_id]);

  const onToggleMute = useCallback(() => {
    const url = gate.muted
      ? gateUnmuteUrl(gate.gate_id)
      : gateMuteUrl(gate.gate_id);
    void runAction(url, undefined);
  }, [runAction, gate.gate_id, gate.muted]);

  const onSnooze = useCallback(
    (secs: number) => {
      void runAction(gateSnoozeUrl(gate.gate_id), {
        until: snoozeUntilIso(secs),
      });
    },
    [runAction, gate.gate_id],
  );

  const busy = action.kind === "busy";

  return (
    <div
      className="flex flex-col gap-1.5 px-3 py-2 border rounded-md"
      data-gate-id={gate.gate_id}
      data-gate-verdict={gate.verdict}
      data-gate-muted={gate.muted ? "true" : "false"}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant={verdictVariant(gate.verdict)}
          className="font-mono text-[10px] uppercase tracking-wide"
        >
          {gate.verdict}
        </Badge>
        <span className="text-sm font-mono truncate min-w-0 flex-1">
          {predicateText}
        </span>

        {/* Muted / snoozed indicators — render defensively (fields may be
            absent while the coord deploy lags). */}
        {gate.muted && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <BellOff className="h-3 w-3" />
            muted
          </Badge>
        )}
        {isSnoozed && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <Clock className="h-3 w-3" />
            snoozed · {relativeTime(gate.snoozed_until)}
          </Badge>
        )}
      </div>

      {/* Honesty-about-uncertainty: always show when it was last checked +
          the verdict reason, never a bare status. */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span title={gate.evaluated_at ?? "not yet evaluated"}>
          {gate.evaluated_at
            ? `checked ${relativeTime(gate.evaluated_at)}`
            : "not yet evaluated"}
        </span>
        {gate.verdict_reason && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{gate.verdict_reason}</span>
          </>
        )}
      </div>

      {/* Actions — light + reversible. */}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {isApprovable && (
          // Approve is a real state-change (clears the gate). The custom
          // eslint rule requires destructive-named handlers to sit inside a
          // <DestructiveButton> so UI-Bridge synthetic clicks are gated; this
          // also fits the action's weight (it advances the plan).
          <DestructiveButton size="sm" onClick={onApprove} disabled={busy}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </DestructiveButton>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={onToggleMute}
          disabled={busy}
          data-action={gate.muted ? "unmute" : "mute"}
        >
          <BellOff className="h-3.5 w-3.5" />
          {gate.muted ? "Unmute" : "Mute"}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy}>
              <Clock className="h-3.5 w-3.5" />
              Snooze
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Snooze until…</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SNOOZE_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.secs}
                onClick={() => onSnooze(preset.secs)}
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {action.kind === "error" && (
          <span className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {action.message}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group (plan anchor or claim anchor)
// ---------------------------------------------------------------------------

interface GroupedGates {
  key: string;
  label: string;
  kind: "plan" | "claim";
  gates: GateRow[];
}

function groupGates(gates: GateRow[]): GroupedGates[] {
  const byKey = new Map<string, GroupedGates>();
  for (const gate of gates) {
    const anchor = gateAnchor(gate);
    const existing = byKey.get(anchor.key);
    if (existing) {
      existing.gates.push(gate);
    } else {
      byKey.set(anchor.key, {
        key: anchor.key,
        label: anchor.label,
        kind: anchor.kind,
        gates: [gate],
      });
    }
  }
  // Plan anchors first, then claim anchors; alphabetical within each class.
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "plan" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Gates panel for the operations surface. Lists the tenant's gates grouped
 * by plan anchor (`plan_id · phase_name`) and claim anchor
 * (`claim_kind · resource_key`), with light reversible actions (approve /
 * mute / snooze). Plan
 * `2026-06-05-plan-gate-web-surface-and-productization` Phase 2.
 *
 * The tenant is resolved server-side from the operator's bearer (the web
 * proxy never forwards a client tenant_id); this panel only ever sees the
 * caller's own gates.
 */
export function GatesPanel() {
  const { gates, error, refetch } = useGatesStream();

  const onActed = useCallback(() => {
    void refetch();
  }, [refetch]);

  const groups = useMemo(
    () => (gates ? groupGates(gates) : []),
    [gates],
  );

  const loading = gates === null && error === null;
  const count = gates?.length ?? 0;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        {/* data-content-role + data-content-id anchor this CardTitle <div>
            (not a semantic <hN>) in the UI-Bridge content registry with a
            stable, text-independent id (`heading-gates`) — the Spec-CI
            operations spec asserts it as the panel's empty-state-safe anchor. */}
        <CardTitle
          className="flex items-center gap-2 text-base"
          data-content-role="heading"
          data-content-id="heading-gates"
        >
          <ShieldCheck className="h-4 w-4" />
          Gates
          <Badge variant="outline" className="ml-2 font-mono text-xs">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Error state — surfaced honestly, polling continues underneath. */}
        {error && (
          <p className="text-xs text-red-300 mb-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Couldn&apos;t load gates: {error}
          </p>
        )}

        {/* Loading state — first fetch hasn't resolved. */}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading gates…</p>
        ) : count === 0 ? (
          /* Empty state. data-content-id gives the registry a stable anchor
             (the text is long + may be reworded); this is what Spec-CI's
             hermetic EMPTY-database run asserts, since no gate rows exist. */
          <p
            className="text-xs text-muted-foreground"
            data-content-id="gates-empty-state"
          >
            No gates registered. Defer a plan phase or arm an observation from
            a runner session to see it tracked here.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <SignpostBig className="h-3.5 w-3.5" />
                  <span className="truncate font-mono">{group.label}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {group.kind}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {group.gates.map((gate) => (
                    <GateRowView
                      key={gate.gate_id}
                      gate={gate}
                      onActed={onActed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
