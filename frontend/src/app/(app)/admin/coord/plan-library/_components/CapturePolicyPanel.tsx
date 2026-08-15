"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePlanCapturePolicy } from "../_hooks/usePlanCapturePolicy";
import { PLAN_CAPTURE_LEVELS, type PlanCaptureLevel } from "../types";

const LEVEL_COPY: Record<PlanCaptureLevel, { label: string; blurb: string }> = {
  off: {
    label: "Off",
    blurb:
      "No capture clause is added to a runner briefing. Agents write nothing to the library; the deterministic scan is unaffected.",
  },
  record: {
    label: "Record",
    blurb:
      "Every session spawned from now on carries the capture clause: save prompts, reports and plans, and record the edge to what produced them.",
  },
};

/**
 * The `plan_capture` toggle — first-class at the top of the page.
 *
 * What is shown is the value coord RESOLVES, not the value last written.
 * Three states the panel is careful to keep distinct, because collapsing any
 * of them into "off" would misreport the fleet:
 *
 * * `resolved_scope: "none"` — no row exists at all. Devices resolve `off` by
 *   the poller's fail-safe, but nobody chose that.
 * * a scope band that is not `tenant` — someone else's row (system-band) is
 *   winning, so this tenant's setting is not what is in force.
 * * a failed read-back after a write — the write landed, the resolved value is
 *   UNKNOWN. The panel says so rather than painting the written level.
 *
 * The band is tenant-wide by design (the clause is baked into a briefing once
 * per session at spawn, and a session is not repo-scoped), so there is no
 * per-repo control here — only a report of which band actually won.
 */
export function CapturePolicyPanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<PlanCaptureLevel | null>(null);
  const {
    policy,
    loading,
    saving,
    error,
    readbackError,
    lastWrite,
    reload,
    setLevel,
  } = usePlanCapturePolicy();

  const current = policy?.effective_level ?? null;
  const canEdit = policy?.can_edit === true;
  const noRow = policy?.resolved_scope === "none";
  // Coord resolves MOST-SPECIFIC-wins (repo > tenant > system). The two
  // non-tenant outcomes therefore mean OPPOSITE things for a tenant write, and
  // must not share one warning:
  //   repo   — a narrower row is overriding; a tenant write stays overridden.
  //   system — this tenant has no row at all; a tenant write WILL take effect.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="plan-capture-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Radio className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Plan capture</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Whether a spawning runner session is told to save its prompts,
              reports and plans into this library. The clause is baked into the
              briefing once, at spawn — so a change here affects sessions
              started <em>after</em> it, not the ones already running.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="plan-capture-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {PLAN_CAPTURE_LEVELS.map((level) => {
              const active = current === level;
              return (
                <Button
                  key={level}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  disabled={saving || !canEdit}
                  onClick={() => {
                    setPending(level);
                    setLevel(level).finally(() => setPending(null));
                  }}
                  data-testid={`plan-capture-level-${level}`}
                  title={
                    canEdit
                      ? LEVEL_COPY[level].blurb
                      : "Coord reports you are not an admin of this tenant."
                  }
                >
                  {/* Only the level being written spins — a spinner on both
                      buttons reads as "something is happening" without saying
                      which way it is going. */}
                  {saving && pending === level && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  {LEVEL_COPY[level].label}
                </Button>
              );
            })}

            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Devices resolve</span>
              <Badge
                variant={current === "record" ? "default" : "outline"}
                data-testid="plan-capture-effective"
              >
                {current ?? "unknown"}
              </Badge>
              <span>from the</span>
              <Badge variant="outline" data-testid="plan-capture-scope">
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {/*
            The buttons are disabled whenever `can_edit` is false — INCLUDING
            when the read failed and we simply do not know the operator's role.
            A disabled control with no stated reason is its own small lie, and
            the two reasons are not the same, so they are said separately.
          */}
          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="plan-capture-readonly"
            >
              {policy
                ? "Read-only: coord reports you are not an admin of this tenant, so the write would be refused (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {/* "Off because nobody wrote a row" ≠ "off because someone chose off". */}
          {noRow && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="plan-capture-no-row"
            >
              No policy row exists for this tenant yet. Devices fall back to{" "}
              <code>off</code> — that is the poller&apos;s fail-safe, not a
              choice anyone made. Pick a level to write one.
            </p>
          )}

          {/* A NARROWER row is winning — a tenant write stays overridden. */}
          {overriddenByRepo && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="plan-capture-overridden-by-repo"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A <strong>repo</strong>-band row is winning. Coord resolves the
                most specific band first, so writing here changes the tenant row
                but the repo row will keep overriding it.
              </p>
            </div>
          )}

          {/* A BROADER row is answering — this tenant has none, so a write wins. */}
          {fallingBackToSystem && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="plan-capture-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {/* A write that landed with no confirmed resolution. UNKNOWN. */}
          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="plan-capture-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The write to <code>{lastWrite?.written_level}</code> was
                accepted, but reading back what devices resolve failed (
                {readbackError}). The value above is the last one we could
                confirm — it may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="plan-capture-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the capture policy: {error}.{" "}
                {policy
                  ? "Showing the last value read — it may be out of date."
                  : "The current level is unknown."}
              </p>
            </div>
          )}

          {/*
            Coord's GET for ANY domain also returns `controls`/`drain`/
            `current_version` read from the unrelated `fleet_resources` row.
            The backend strips them; this line exists so their absence is an
            answered question rather than a silent gap.
          */}
          {policy != null && policy.keys_not_shown.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="plan-capture-keys-not-shown"
            >
              Coord also returned {policy.keys_not_shown.join(", ")} with this
              read.{" "}
              {policy.keys_not_shown_source === "fleet_resources_row"
                ? "Those belong to the fleet_resources row, not to plan capture, and are not shown here."
                : "Those are not shown here."}
            </p>
          )}

          {/*
            `current === null` means the read FAILED — it does not mean `off`.
            Defaulting the blurb to the off copy there would describe the fleet
            with confidence on no evidence, which is the same mistake as
            rendering an unreachable coord as "no work unit".
          */}
          <p className="text-xs text-muted-foreground" data-testid="plan-capture-blurb">
            {current === null
              ? "The resolved level could not be read, so what a spawning session is told is unknown."
              : (LEVEL_COPY[current as PlanCaptureLevel]?.blurb ??
                `The resolved level is "${current}", which is not one this console recognises.`)}
          </p>
        </div>
      )}
    </section>
  );
}
