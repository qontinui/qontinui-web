"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  MoreHorizontal,
  RotateCcw,
  ShieldCheck,
  SignpostBig,
} from "lucide-react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import {
  gateApproveUrl,
  gateMuteUrl,
  gateReopenUrl,
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

// ---------------------------------------------------------------------------
// Mark-met attestation dialog
// ---------------------------------------------------------------------------

interface MarkMetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full condition text the operator is attesting (verbatim). */
  conditionText: string;
  /** True when this is an `agent` gate being cleared via operator override —
   *  surfaces the extra warning line. */
  override: boolean;
  /** Confirm handler — the gate-clearing action. Named `onConfirm` (not a
   *  destructive verb) so the eslint rule keys off the `DestructiveButton`
   *  wrapper, which is where the synthetic-click gate must live. */
  onConfirm: () => void;
  disabled: boolean;
}

/**
 * Attestation confirm dialog for clearing a gate. Quotes the gate's full
 * condition verbatim so the operator sees exactly what they're asserting is
 * true. `AlertDialogCancel` is the default-focused action (predictability:
 * the safe choice is the default); the confirm sits inside a
 * `DestructiveButton` so UI-Bridge synthetic clicks stay gated and the
 * `@qontinui-web/no-unwrapped-destructive-handler` rule is satisfied.
 */
function MarkMetDialog({
  open,
  onOpenChange,
  conditionText,
  override,
  onConfirm,
  disabled,
}: MarkMetDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark this condition met?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <blockquote className="border-l-2 pl-3 text-sm font-mono text-foreground">
                {conditionText}
              </blockquote>
              <p>
                You are attesting this condition is satisfied. Coord will stop
                watching this gate.
              </p>
              {override && (
                <p className="text-amber-500">
                  This gate is normally cleared by an agent when the work
                  completes. Override only if you&apos;re certain.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* Confirm is a real state-change (clears the gate). The custom
              eslint rule + the synthetic-click gate both require it to sit
              inside <DestructiveButton>; `asChild` merges Radix's
              close-on-action behavior onto it. */}
          <AlertDialogAction asChild>
            <DestructiveButton onClick={onConfirm} disabled={disabled}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Condition is met
            </DestructiveButton>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function GateRowView({ gate, onActed }: GateRowProps) {
  const [action, setAction] = useState<ActionState>({ kind: "idle" });
  // Mark-met attestation dialog (operator-confirm). Driven controlled so the
  // overflow-menu "Operator override" item can open the SAME dialog.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const predicateText = useMemo(
    () => humanizePredicate(gate.predicate),
    [gate.predicate],
  );

  // The full condition text the operator is attesting. `gate.predicate.prompt`
  // is the operator_approval gate's verbatim condition (also surfaced by
  // `humanizePredicate`); fall back to the humanized line for typed gates.
  const conditionText = gate.predicate?.prompt ?? predicateText;

  const isSnoozed = useMemo(() => {
    if (!gate.snoozed_until) return false;
    const until = new Date(gate.snoozed_until).getTime();
    return !Number.isNaN(until) && until > Date.now();
  }, [gate.snoozed_until]);

  const isApprovable =
    gate.predicate?.kind === "operator_approval" && gate.verdict === "open";

  // Audience split (Phase 3.4). `operator` (or absent — defensive default
  // while the coord deploy lags) → primary `Mark met…` button. `agent` → no
  // primary clear affordance; the operator override lives behind the ⋯ menu.
  const isAgentGate = gate.clearance_audience === "agent";

  // Re-open is offered on cleared/failed rows still in the list window
  // (best-effort recovery; see the honesty caveat on the control). The Undo
  // toast, which captures the gate_id in closure, is the primary recovery.
  const isReopenable = gate.verdict === "cleared" || gate.verdict === "failed";

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
          return false;
        }
        setAction({ kind: "idle" });
        onActed();
        return true;
      } catch (err) {
        log.warn("gate action threw", url, err);
        setAction({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [onActed],
  );

  // Mark-met: clear the gate via approve, then offer an Undo toast that
  // reopens it. The gate_id is captured in the closure, so Undo survives the
  // row scrolling out of the 100-row list window (the row-level Re-open below
  // is only best-effort for rows still in the window).
  const onApprove = useCallback(() => {
    const id = gate.gate_id;
    void runAction(gateApproveUrl(id), undefined).then((ok) => {
      if (ok) {
        toast("Gate cleared", {
          action: {
            label: "Undo",
            onClick: () => void runAction(gateReopenUrl(id), undefined),
          },
        });
      }
    });
  }, [runAction, gate.gate_id]);

  // Re-open a cleared/failed gate (row-level recovery; mirror of the Undo
  // toast). Server-side clones the gate into a fresh open one.
  const onReopen = useCallback(() => {
    void runAction(gateReopenUrl(gate.gate_id), undefined);
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
        {/* Operator gates (or absent audience → defensive default): primary
            `Mark met…` opens the attestation dialog. */}
        {isApprovable && !isAgentGate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            data-action="mark-met"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark met…
          </Button>
        )}

        {/* Agent gates: NO primary clear affordance. The operator override
            lives behind the ⋯ menu and opens the SAME attestation dialog plus
            a warning line. */}
        {isApprovable && isAgentGate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label="More actions"
                data-action="overflow"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Operator override</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setConfirmOpen(true)}>
                Operator override: mark met…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Re-open: best-effort recovery for cleared/failed rows still in the
            list window. NOTE: cleared rows pushed past the 100-row window
            won't show this — the Undo toast (holding the gate_id in closure)
            is the primary recovery. A still-true typed gate may re-clear at
            the next sweep. */}
        {isReopenable && (
          <Button
            size="sm"
            variant="outline"
            onClick={onReopen}
            disabled={busy}
            data-action="reopen"
            title="Clone this gate into a fresh open gate. A still-satisfied typed gate may re-clear at the next sweep."
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Re-open
          </Button>
        )}

        {/* Shared attestation dialog — opened by the primary `Mark met…`
            button or the agent-gate operator-override menu item. */}
        {isApprovable && (
          <MarkMetDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            conditionText={conditionText}
            override={isAgentGate}
            onConfirm={onApprove}
            disabled={busy}
          />
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
