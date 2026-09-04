"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { usePolicyWritePolicy } from "../_hooks/usePolicyWritePolicy";
import {
  POLICY_WRITE_CONFIRMED_LEVELS,
  POLICY_WRITE_DEFAULT_LEVEL,
  POLICY_WRITE_LEVEL_HELP,
  POLICY_WRITE_SELECTABLE_LEVELS,
  type PolicyWriteLevel,
} from "../types";

/**
 * The tenant-wide agent policy-write autonomy dial.
 *
 * Plan `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4.
 *
 * ## Why it lives on THIS page
 *
 * It answers half of one question, and `AgentWriteAccessControl` — a few inches
 * above — answers the other half:
 *
 * | Control | Asks | Granularity |
 * |---|---|---|
 * | `agent_write_tier` | may an agent write THIS document, and on which tier? | per document |
 * | `policy_write` (here) | what happens to a write it is allowed to make? | per tenant |
 *
 * The two compose, and they compose in one direction only: **the dial is
 * subtractive.** It can never grant an agent authority over a document the
 * per-document control protects — coord checks `agent_write_denial` first and
 * consults the dial only to narrow the result. So a document showing "protected"
 * above stays protected at every level here, `full` included.
 *
 * Splitting these onto two pages is exactly how an operator ends up believing
 * one of them is the whole answer.
 *
 * ## What the operator has to be able to read off this control
 *
 * Every block below exists because the level alone does not tell an operator
 * whether changing it will do anything, and a dial that cannot be read
 * correctly cannot be changed safely — the [policy: ux-priorities]
 * predictability rule `AgentWriteAccessControl` states for its own setting.
 *
 * - **"No row" is a named default, never `off`.** Coord answers
 *   `effective_level: "off"` for two different facts — nobody ever wrote a row,
 *   and an operator turned it off — and for this domain they resolve in
 *   OPPOSITE directions. Rendering the raw value would tell every tenant that
 *   has never touched this dial that agent policy writes are disabled, when they
 *   are working normally.
 * - **A level coord cannot parse resolves to `off`, and says so.** The dial
 *   shows what the fleet enforces, and names the row that needs fixing.
 * - **Which scope band answered.** This control only ever writes the *tenant*
 *   band, so a narrower `repo` row winning means a write here changes a row that
 *   stays overridden — the operator has to be told before they conclude the dial
 *   is broken.
 */
export function PolicyWriteDialControl() {
  const {
    policy,
    loading,
    saving,
    error,
    displayLevel,
    isDefaulted,
    unrecognizedLevel,
    readbackError,
    lastWrite,
    reload,
    setLevel,
  } = usePolicyWritePolicy();

  // Held between the operator picking a confirmed level and confirming it. The
  // RadioGroup stays controlled by `displayLevel` throughout, so cancelling
  // leaves the visible selection where the fleet actually is.
  const [pendingLevel, setPendingLevel] = useState<PolicyWriteLevel | null>(
    null
  );

  const canEdit = policy?.can_edit ?? false;

  // Coord resolves most-specific-first (repo < tenant < system). A `repo` row
  // winning is the one case where a tenant write lands and changes nothing the
  // fleet sees; a `system` row answering means this tenant has none of its own,
  // so a write here takes effect immediately. Getting these backwards would tell
  // the operator a write is futile in precisely the case where it wins.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  function onSelect(next: PolicyWriteLevel) {
    if (POLICY_WRITE_CONFIRMED_LEVELS.includes(next)) {
      setPendingLevel(next);
      return;
    }
    void setLevel(next);
  }

  return (
    <section
      className="space-y-4"
      data-testid="policy-write-dial"
      aria-labelledby="policy-write-dial-heading"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2
            id="policy-write-dial-heading"
            className="text-base font-semibold"
          >
            Agent policy-write autonomy
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How much of the policy-write surface agents may use across this
            tenant. This <strong>narrows</strong> what the per-document setting
            above allows — it never widens it, so a document marked protected
            stays protected at every level here.
          </p>
        </div>
      </div>

      {loading && !policy ? (
        <p className="text-sm text-muted-foreground">Reading the dial…</p>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">Could not read the dial.</p>
            <p className="text-muted-foreground">
              {error}{" "}
              {policy
                ? "The value below is the last one confirmed and may be stale."
                : "Nothing has been read yet, so the level in force is unknown — it is not off."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={reload}
            >
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      {readbackError ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          data-testid="policy-write-readback-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-muted-foreground">
            The write to{" "}
            <code className="font-mono">{lastWrite?.written_level}</code> was
            accepted, but reading it back failed ({readbackError}) — what
            devices actually resolve is <strong>unknown</strong> until this
            refreshes.
          </p>
        </div>
      ) : null}

      {/*
        A row exists whose level coord cannot parse. Coord's enforcement path
        refuses every write in that state (`parse_fail_closed` → `off`) while its
        domain-agnostic GET keeps handing back the raw string, so this is the one
        case where the stored value and the enforced value differ outright. Name
        both, and name the row, because nothing else on this page can.
      */}
      {unrecognizedLevel !== null ? (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-testid="policy-write-unrecognized-level"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-muted-foreground">
            The <span className="font-mono">{policy?.resolved_scope}</span>-band
            row stores the level{" "}
            <code className="font-mono">{unrecognizedLevel}</code>, which coord
            does not recognise. Coord refuses <strong>every</strong> agent
            policy write while that row is unreadable — an authority setting it
            cannot read is not permission — so the level in force is{" "}
            <span className="font-mono">off</span>.{" "}
            {policy?.resolved_scope === "tenant"
              ? "Setting a level below rewrites that row and clears this."
              : "This control writes the tenant band, so it cannot rewrite that row — the broken row has to be fixed at its own band."}
          </p>
        </div>
      ) : null}

      {policy ? (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="policy-write-in-force"
        >
          <span className="text-muted-foreground">In force:</span>
          <Badge variant="secondary" className="font-mono">
            {displayLevel}
          </Badge>
          {isDefaulted ? (
            <span className="text-muted-foreground">
              — coord&apos;s built-in default ({POLICY_WRITE_DEFAULT_LEVEL}); no
              one has set this tenant&apos;s dial
            </span>
          ) : unrecognizedLevel !== null ? (
            <span className="text-muted-foreground">
              — coord&apos;s fail-closed reading of an unrecognised{" "}
              <span className="font-mono">{policy.resolved_scope}</span>-band
              row
            </span>
          ) : (
            <span className="text-muted-foreground">
              — set at the{" "}
              <span className="font-mono">{policy.resolved_scope}</span> scope
              {policy.master_enabled ? "" : " (master disabled)"}
            </span>
          )}
        </div>
      ) : null}

      {/* A NARROWER row is winning, and this control only writes the tenant band. */}
      {overriddenByRepo ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
          data-testid="policy-write-overridden-by-repo"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-muted-foreground">
            A <strong>repo</strong>-band row is winning. This control writes the
            tenant band, and coord resolves the most specific band first — so a
            change here updates the tenant row while the repo row keeps
            overriding it.
          </p>
        </div>
      ) : null}

      {/* A BROADER row is answering — this tenant has none, so a write wins. */}
      {fallingBackToSystem ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="policy-write-system-fallback"
        >
          A fleet-wide <strong>system</strong>-band row is answering because
          this tenant has none of its own. Coord resolves the most specific band
          first, so setting a level here takes effect immediately.
        </p>
      ) : null}

      <RadioGroup
        value={displayLevel ?? undefined}
        onValueChange={(v) => onSelect(v as PolicyWriteLevel)}
        disabled={!canEdit || saving || loading}
        className="gap-3"
      >
        {POLICY_WRITE_SELECTABLE_LEVELS.map((level) => (
          <div key={level} className="flex items-start gap-3">
            <RadioGroupItem
              value={level}
              id={`policy-write-${level}`}
              className="mt-1"
            />
            <label
              htmlFor={`policy-write-${level}`}
              className="cursor-pointer text-sm"
            >
              <span className="font-mono font-medium">{level}</span>
              {POLICY_WRITE_CONFIRMED_LEVELS.includes(level) ? (
                <Badge variant="outline" className="ml-2 align-middle text-xs">
                  widens agent authority
                </Badge>
              ) : null}
              <span className="mt-0.5 block text-muted-foreground">
                {POLICY_WRITE_LEVEL_HELP[level]}
              </span>
            </label>
          </div>
        ))}
      </RadioGroup>

      {policy && !canEdit ? (
        <p className="text-xs text-muted-foreground">
          You do not have tenant-admin rights in this tenant, so the dial is
          read-only here.
        </p>
      ) : null}

      {/*
        Coord's GET for ANY domain also returns `controls`/`drain`/
        `current_version` read from the unrelated `fleet_resources` row. The
        backend strips them; this line exists so their absence is an answered
        question rather than a silent gap — the same reason
        `CapturePolicyPanel` carries it for the other domain.
      */}
      {policy && policy.keys_not_shown.length > 0 ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="policy-write-keys-not-shown"
        >
          Coord also returned {policy.keys_not_shown.join(", ")} with this read.{" "}
          {policy.keys_not_shown_source === "fleet_resources_row"
            ? "Those belong to the fleet_resources row, not to agent policy writes, and are not shown here."
            : "Those are not shown here."}
        </p>
      ) : null}

      {/*
        `full` is the only level that lets a change reach the fleet without the
        operator seeing it first, so it is confirmed rather than applied on a
        single click — the convention `AgentWriteAccessControl` sets a few inches
        above for overriding a built-in protection.

        The confirmation says what the level does and what it does NOT do. The
        second half matters more: an operator reading "agents may land a
        loosening" without the subtractive property in front of them can
        reasonably fear they are opening every protected document at once.
      */}
      <AlertDialog
        open={pendingLevel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLevel(null);
        }}
      >
        <AlertDialogContent data-testid="policy-write-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Let agents land policy changes you have not reviewed?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  At <span className="font-mono">full</span>, an agent may land
                  a classified <strong>loosening</strong> directly. You are
                  notified afterwards on the notifications tab instead of
                  approving it first. Every other level either refuses the write
                  or queues it for your approval.
                </p>
                <p>
                  This does <strong>not</strong> open any protected document.
                  Coord checks the per-document setting above first and consults
                  this dial only to narrow the answer, so a document marked
                  protected stays protected at{" "}
                  <span className="font-mono">full</span>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingLevel) void setLevel(pendingLevel);
                setPendingLevel(null);
              }}
            >
              Set to full
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
