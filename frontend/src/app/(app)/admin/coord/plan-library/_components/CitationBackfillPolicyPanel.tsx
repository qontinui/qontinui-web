"use client";

import { useState } from "react";
import { AlertTriangle, DatabaseZap, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCitationScopeBackfillPolicy } from "../_hooks/useCitationScopeBackfillPolicy";
import {
  CITATION_SCOPE_BACKFILL_WRITE_DEFAULT_LEVEL,
  CITATION_SCOPE_BACKFILL_WRITE_LEVELS,
  type CitationScopeBackfillWriteLevel,
} from "../types";

const LEVEL_COPY: Record<
  CitationScopeBackfillWriteLevel,
  { label: string; blurb: string }
> = {
  off: {
    label: "Off",
    blurb:
      "The agent door refuses (403). An agent cannot run the backfill at all, not even to plan it.",
  },
  dry_run: {
    label: "Dry run",
    blurb:
      "The agent door only plans: it reports which citations it would fill and which work units would lose their shipped status, and writes nothing.",
  },
  live: {
    label: "Live",
    blurb:
      "The agent door writes: it fills missing delivery scopes on this tenant's PR citations, which can demote work units from shipped and make them dispatchable again — spending quota.",
  },
};

/**
 * The `citation_scope_backfill_write` dial — sits next to plan capture because
 * both are tenant-wide decisions about what AGENTS may do to this corpus.
 *
 * The delivery-scope backfill fills NULL `delivery_scope` on PR citations, and
 * doing so can demote a work unit's derived `shipped` status — which makes it
 * dispatchable again and spends quota. That is a cost decision, so the
 * operator records it once here instead of being asked every time a
 * mechanical reconcile needs it (plan
 * `2026-09-23-delivery-scope-backfill-write-is-operator-only-so-a-mechanical-reconcile-needs-a-human`).
 *
 * It governs ONLY the agent door. The operator SSO door
 * (`/admin/coord/citations/backfill-delivery-scope`) is unaffected at every
 * level, and the copy says so, because "off" here does not mean "nobody can
 * run the backfill".
 *
 * Same resolved-value discipline as `CapturePolicyPanel`: what is shown is what
 * coord RESOLVES; a failed read is UNKNOWN, never `off`; a failed read-back
 * after a write is UNKNOWN, never the written level.
 */
export function CitationBackfillPolicyPanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] =
    useState<CitationScopeBackfillWriteLevel | null>(null);
  const {
    policy,
    loading,
    saving,
    error,
    readbackError,
    lastWrite,
    reload,
    setLevel,
  } = useCitationScopeBackfillPolicy();

  // Trimmed the way coord's enforcement parses it (`parse_fail_closed`), so a
  // stored " live " is shown as the level the door actually applies.
  const current = policy?.effective_level.trim() ?? null;
  const canEdit = policy?.can_edit === true;
  const noRow = policy?.resolved_scope === "none";
  // A no-row answer that is NOT coord's declared default for this domain means
  // the answering coord build does not know the dial yet (an unregistered
  // domain resolves `off`). Say that, rather than naming the default level.
  const noRowPredatesDial =
    noRow && current !== CITATION_SCOPE_BACKFILL_WRITE_DEFAULT_LEVEL;
  // A repo band answering does NOT mean it governs: coord's agent door
  // resolves this domain with no repo in hand, so repo rows never apply to it.
  // (Unlike CapturePolicyPanel, whose "repo overrides tenant" warning would be
  // false here.)
  const repoBandAnswered = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="citation-backfill-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <DatabaseZap className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">
              Citation delivery-scope backfill (agents)
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Whether an <em>agent</em> may fill missing delivery scopes on this
              tenant&apos;s PR citations. Filling them can demote work units
              from shipped, making them dispatchable again and spending quota.
              This governs the agent door only — the operator backfill is
              unaffected at every level.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="citation-backfill-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {CITATION_SCOPE_BACKFILL_WRITE_LEVELS.map((level) => {
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
                  data-testid={`citation-backfill-level-${level}`}
                  title={
                    canEdit
                      ? LEVEL_COPY[level].blurb
                      : policy
                        ? "Coord reports you are not an admin of this tenant."
                        : "Your role could not be read, so whether this write would be accepted is unknown."
                  }
                >
                  {saving && pending === level && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  {LEVEL_COPY[level].label}
                </Button>
              );
            })}

            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Agents resolve</span>
              <Badge
                variant={current === "live" ? "default" : "outline"}
                data-testid="citation-backfill-effective"
              >
                {current ?? "unknown"}
              </Badge>
              <span>from the</span>
              <Badge variant="outline" data-testid="citation-backfill-scope">
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="citation-backfill-readonly"
            >
              {policy
                ? "Read-only: coord reports you are not an admin of this tenant, so the write would be refused (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {noRow && !noRowPredatesDial && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="citation-backfill-no-row"
            >
              No policy row exists for this tenant yet. Agents fall back to{" "}
              <code>{current}</code> — coord&apos;s per-domain default, not a
              choice anyone made. Pick a level to write an explicit row.
            </p>
          )}

          {/* Unknown to this coord build: the displayed level is not the
              dial's default, and a write may not be honoured by the door. */}
          {noRowPredatesDial && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="citation-backfill-no-row-unrecognised"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                No policy row exists, and coord answered <code>{current}</code>{" "}
                rather than this dial&apos;s default,{" "}
                <code>{CITATION_SCOPE_BACKFILL_WRITE_DEFAULT_LEVEL}</code>. The
                coord build answering likely predates the dial, so what the
                agent door does is unknown until it is deployed.
              </p>
            </div>
          )}

          {repoBandAnswered && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="citation-backfill-repo-band"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A <strong>repo</strong>-band row answered this read, but the
                agent door resolves with no repo, so repo rows never govern it.
                What the door does is set by the tenant row (or, failing that,
                the system row) — refresh after writing here to confirm.
              </p>
            </div>
          )}

          {fallingBackToSystem && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="citation-backfill-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="citation-backfill-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The write to <code>{lastWrite?.written_level}</code> was
                accepted, but reading back what agents resolve failed (
                {readbackError}). The value above is the last one we could
                confirm — it may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="citation-backfill-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the backfill policy: {error}.{" "}
                {policy
                  ? "Showing the last value read — it may be out of date."
                  : "The current level is unknown."}
              </p>
            </div>
          )}

          {policy != null && policy.keys_not_shown.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="citation-backfill-keys-not-shown"
            >
              Coord also returned {policy.keys_not_shown.join(", ")} with this
              read.{" "}
              {policy.keys_not_shown_source === "fleet_resources_row"
                ? "Those belong to the fleet_resources row, not to this dial, and are not shown here."
                : "Those are not shown here."}
            </p>
          )}

          {/* `current === null` means the read FAILED — it does not mean `off`. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="citation-backfill-blurb"
          >
            {current === null
              ? "The resolved level could not be read, so what the agent door does is unknown."
              : (LEVEL_COPY[current as CitationScopeBackfillWriteLevel]
                  ?.blurb ??
                `The resolved level is "${current}", which is not one this console recognises. Coord's agent door treats an unrecognised level as off.`)}
          </p>
        </div>
      )}
    </section>
  );
}
