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
import { AlertTriangle, Send } from "lucide-react";
import { usePolicyAutoPublishPolicy } from "../_hooks/usePolicyAutoPublishPolicy";
import {
  POLICY_AUTO_PUBLISH_CONFIRMED_LEVELS,
  POLICY_AUTO_PUBLISH_DEFAULT_LEVEL,
  POLICY_AUTO_PUBLISH_LEVEL_HELP,
  POLICY_AUTO_PUBLISH_SELECTABLE_LEVELS,
  type PolicyAutoPublishLevel,
} from "../types";

/**
 * The per-tenant dial for automatic publishing.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D5.
 *
 * ## Why it lives on THIS page, beside the other two dials
 *
 * The three are one question asked from three directions, and the documents
 * they govern are the documents listed a few inches above:
 *
 * | Control | Asks |
 * |---|---|
 * | `policy_write` | what may an agent INSIDE this tenant do to these documents? |
 * | `policy_upstream` | what may the fleet OUTSIDE this tenant do to them? |
 * | `policy_auto_publish` (here) | may this tenant's documents leave it on their own? |
 *
 * The third is the outbound twin of the second, and it is the one that only
 * means anything in the SYSTEM tenant: the auto-publisher publishes from there
 * and nowhere else, so a row written in a downstream tenant is inert. The
 * control says so rather than implying a lever that does nothing.
 *
 * ## What this switch does NOT stop, and why that is deliberate
 *
 * Publish-all, the single-document Publish button, and the auto-publisher's
 * daily recovery reconcile all keep running at `off`. D5 is explicit: the
 * switch stops the automatic path, not the manual one. The recovery reconcile
 * is the sharper case — it exists to re-run a fan-out lost when a MANUAL
 * publish's spawned task dies in a restart, a failure that logs nothing at all,
 * so gating it here would mean turning automatic publishing off silently
 * removed the safety net under the button the operator still presses.
 *
 * ## What the operator has to be able to read off this control
 *
 * The same four things the two sibling dials state, for the same reasons:
 *
 * - **"No row" is a named default (`on`), never `off`.** For THIS domain the
 *   trap is the whole feature: reading the resolver's bare `off` literally
 *   would mean the worker decides nothing, holds nothing and publishes nothing,
 *   with no error anywhere — indistinguishable from the eight silent days this
 *   plan exists to end.
 * - **A level coord cannot parse resolves to `off`, and says so.**
 * - **Which scope band answered**, so a write that will stay overridden is not
 *   mistaken for a broken dial.
 * - **A failed read-back is UNKNOWN**, not the level that was written.
 */
export function PolicyAutoPublishDialControl({
  onLevelChanged,
}: {
  /**
   * Called after a write FROM THIS CONTROL lands, so the page can re-take the
   * auto-publish status read — the list's badges key on the switch coord
   * resolves. A change made anywhere else (another tab, a repo- or
   * system-scope row) is not seen until the page reloads.
   */
  onLevelChanged?: () => void;
} = {}) {
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
  } = usePolicyAutoPublishPolicy();

  // Held between the operator picking a confirmed level and confirming it. The
  // RadioGroup stays controlled by `displayLevel` throughout, so cancelling
  // leaves the visible selection where the tenant actually is.
  const [pendingLevel, setPendingLevel] =
    useState<PolicyAutoPublishLevel | null>(null);

  const applyLevel = async (next: PolicyAutoPublishLevel) => {
    if (await setLevel(next)) onLevelChanged?.();
  };

  const canEdit = policy?.can_edit ?? false;

  // Coord resolves most-specific-first (repo < tenant < system). A `repo` row
  // winning is the one case where a tenant write lands and changes nothing;
  // a `system` row answering means this tenant has none of its own, so a write
  // here takes effect immediately.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  function onSelect(next: PolicyAutoPublishLevel) {
    if (POLICY_AUTO_PUBLISH_CONFIRMED_LEVELS.includes(next)) {
      setPendingLevel(next);
      return;
    }
    // `off` is the safe direction and applies on one click. A kill switch that
    // needs a confirmation to pull is a kill switch nobody pulls in time.
    void applyLevel(next);
  }

  return (
    <section
      className="space-y-4"
      data-testid="policy-auto-publish-dial"
      aria-labelledby="policy-auto-publish-dial-heading"
    >
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2
            id="policy-auto-publish-dial-heading"
            className="text-base font-semibold"
          >
            Automatic publishing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Whether a document set to <span className="font-mono">auto</span>{" "}
            publishes itself to the fleet once its edits have settled — 24 hours
            after a loosening, 6 hours after any other change. Turning this off
            stops the automatic path only:{" "}
            <strong>Publish all changed and the per-document Publish</strong>{" "}
            button keep working, and so does the daily reconcile that recovers a
            fan-out lost to a restart. This dial governs publishing, so it means
            something in the system tenant and nothing anywhere else.
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
          data-testid="policy-auto-publish-readback-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-muted-foreground">
            The write to{" "}
            <code className="font-mono">{lastWrite?.written_level}</code> was
            accepted, but reading it back failed ({readbackError}) — what this
            tenant actually resolves is <strong>unknown</strong> until this
            refreshes.
          </p>
        </div>
      ) : null}

      {/*
        A row exists whose level coord cannot parse. Resolve it the way the most
        restrictive reading demands and name the row, because nothing else on
        this page can.
      */}
      {unrecognizedLevel !== null ? (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-testid="policy-auto-publish-unrecognized-level"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-muted-foreground">
            The <span className="font-mono">{policy?.resolved_scope}</span>-band
            row stores the level{" "}
            <code className="font-mono">{unrecognizedLevel}</code>, which coord
            does not recognise. What this dial authorises is this tenant&apos;s
            bodies reaching every other tenant with no human in the loop — an
            authority setting it cannot read is not permission to do that — so
            the level in force is <span className="font-mono">off</span>.{" "}
            {policy?.resolved_scope === "tenant"
              ? "Setting a level below rewrites that row and clears this."
              : "This control writes the tenant band, so it cannot rewrite that row — the broken row has to be fixed at its own band."}
          </p>
        </div>
      ) : null}

      {policy ? (
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="policy-auto-publish-in-force"
        >
          <span className="text-muted-foreground">In force:</span>
          <Badge variant="secondary" className="font-mono">
            {displayLevel}
          </Badge>
          {isDefaulted ? (
            <span className="text-muted-foreground">
              — coord&apos;s built-in default (
              {POLICY_AUTO_PUBLISH_DEFAULT_LEVEL}); no one has set this
              tenant&apos;s dial
            </span>
          ) : unrecognizedLevel !== null ? (
            <span className="text-muted-foreground">
              — the fail-closed reading of an unrecognised{" "}
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
          data-testid="policy-auto-publish-overridden-by-repo"
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
          data-testid="policy-auto-publish-system-fallback"
        >
          A fleet-wide <strong>system</strong>-band row is answering because
          this tenant has none of its own. Coord resolves the most specific band
          first, so setting a level here takes effect immediately.
        </p>
      ) : null}

      <RadioGroup
        value={displayLevel ?? undefined}
        onValueChange={(v) => onSelect(v as PolicyAutoPublishLevel)}
        disabled={!canEdit || saving || loading}
        className="gap-3"
      >
        {POLICY_AUTO_PUBLISH_SELECTABLE_LEVELS.map((level) => (
          <div key={level} className="flex items-start gap-3">
            <RadioGroupItem
              value={level}
              id={`policy-auto-publish-${level}`}
              className="mt-1"
              data-testid={`policy-auto-publish-level-${level}`}
            />
            <label
              htmlFor={`policy-auto-publish-${level}`}
              className="cursor-pointer text-sm"
            >
              <span className="font-mono font-medium">{level}</span>
              {POLICY_AUTO_PUBLISH_CONFIRMED_LEVELS.includes(level) ? (
                <Badge variant="outline" className="ml-2 align-middle text-xs">
                  sends documents to the fleet without a click
                </Badge>
              ) : null}
              <span className="mt-0.5 block text-muted-foreground">
                {POLICY_AUTO_PUBLISH_LEVEL_HELP[level]}
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
        question rather than a silent gap, exactly as the sibling dials carry it.
      */}
      {policy && policy.keys_not_shown.length > 0 ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="policy-auto-publish-keys-not-shown"
        >
          Coord also returned {policy.keys_not_shown.join(", ")} with this read.{" "}
          {policy.keys_not_shown_source === "fleet_resources_row"
            ? "Those belong to the fleet_resources row, not to automatic publishing, and are not shown here."
            : "Those are not shown here."}
        </p>
      ) : null}

      <AlertDialog
        open={pendingLevel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLevel(null);
        }}
      >
        <AlertDialogContent data-testid="policy-auto-publish-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Let settled edits publish themselves to the fleet?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  At <span className="font-mono">on</span>, every document set
                  to <span className="font-mono">auto</span> publishes itself
                  once its edits have settled — 24 hours after a loosening, 6
                  hours after any other change — and every tenant in the fleet
                  is offered the result.{" "}
                  <strong>
                    An agent&apos;s edit publishes on the same terms
                  </strong>{" "}
                  as yours; the wait is a delay, not a review step.
                </p>
                <p>
                  <strong>A publication cannot be withdrawn.</strong> What still
                  stands between an edit and the fleet: the wait, a hold on any
                  new fleet-specific token, each document&apos;s own publish
                  mode, and the receiving side — which never overwrites a
                  document another tenant has edited, and queues the permission
                  and autonomy surfaces as proposals rather than applying them.
                </p>
                <p className="text-muted-foreground">
                  This is reversible: set the dial back to{" "}
                  <span className="font-mono">off</span> and the worker stops on
                  its next pass. Publications already made stay made.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="policy-auto-publish-confirm-accept"
              onClick={() => {
                if (pendingLevel) void applyLevel(pendingLevel);
                setPendingLevel(null);
              }}
            >
              Turn on
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
