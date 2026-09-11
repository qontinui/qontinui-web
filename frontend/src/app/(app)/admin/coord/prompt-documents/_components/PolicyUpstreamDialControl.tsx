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
import { AlertTriangle, CloudDownload } from "lucide-react";
import { usePolicyUpstreamPolicy } from "../_hooks/usePolicyUpstreamPolicy";
import {
  POLICY_UPSTREAM_CONFIRMED_LEVELS,
  POLICY_UPSTREAM_DEFAULT_LEVEL,
  POLICY_UPSTREAM_LEVEL_HELP,
  POLICY_UPSTREAM_SELECTABLE_LEVELS,
  type PolicyUpstreamLevel,
} from "../types";

/**
 * The per-tenant dial for upstream policy updates.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D6.
 *
 * ## Why it lives on THIS page, beside the policy-write dial
 *
 * The two are the same question asked from opposite ends, and the documents
 * they govern are the documents listed a few inches above:
 *
 * | Control | Asks |
 * |---|---|
 * | `policy_write` | what may an agent INSIDE this tenant do to these documents? |
 * | `policy_upstream` (here) | what may the fleet OUTSIDE this tenant do to them? |
 *
 * ## The property that decides whether this dial is safe to leave on `auto`
 *
 * **A document you have edited is never overwritten, at any level.** D4 makes
 * that unconditional: automatic adoption applies only to a body coord can prove
 * is byte-identical to the publication it already tracks, and a modified
 * document is badged instead. Two more things make the automatic arm reversible
 * rather than merely safe: the adoption lands as an ordinary new version, so
 * the previous wording stays in the history a few inches above and is
 * restorable in one click, and a notification is emitted after it.
 *
 * That is why `auto` is the default rather than a click gate: a click gate
 * means every downstream fleet runs stale policy until a human happens to look
 * (`product_intent/non-goals` §4), which is the same failure replicated per
 * tenant.
 *
 * ## What the operator has to be able to read off this control
 *
 * The same four things the sibling dial states, for the same reasons — see
 * `PolicyWriteDialControl`, whose shape this follows deliberately:
 *
 * - **"No row" is a named default, never `off`.** For THIS domain that trap is
 *   sharper than for the other one: D6 warns that an unregistered domain
 *   resolves `off` for every tenant, so publications would land and nothing
 *   would fan out, with no error anywhere.
 * - **A level coord cannot parse resolves to `off`, and says so.**
 * - **Which scope band answered**, so a write that will stay overridden is not
 *   mistaken for a broken dial.
 * - **A failed read-back is UNKNOWN**, not the level that was written.
 */
export function PolicyUpstreamDialControl() {
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
  } = usePolicyUpstreamPolicy();

  // Held between the operator picking a confirmed level and confirming it. The
  // RadioGroup stays controlled by `displayLevel` throughout, so cancelling
  // leaves the visible selection where the tenant actually is.
  const [pendingLevel, setPendingLevel] = useState<PolicyUpstreamLevel | null>(
    null
  );

  const canEdit = policy?.can_edit ?? false;

  // Coord resolves most-specific-first (repo < tenant < system). A `repo` row
  // winning is the one case where a tenant write lands and changes nothing;
  // a `system` row answering means this tenant has none of its own, so a write
  // here takes effect immediately.
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  function onSelect(next: PolicyUpstreamLevel) {
    if (POLICY_UPSTREAM_CONFIRMED_LEVELS.includes(next)) {
      setPendingLevel(next);
      return;
    }
    void setLevel(next);
  }

  return (
    <section
      className="space-y-4"
      data-testid="policy-upstream-dial"
      aria-labelledby="policy-upstream-dial-heading"
    >
      <div className="flex items-start gap-3">
        <CloudDownload className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2
            id="policy-upstream-dial-heading"
            className="text-base font-semibold"
          >
            Upstream policy updates
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What happens when the fleet publishes a newer version of a document
            you hold. A document you have <strong>edited</strong> is never
            overwritten at any level here — it is shown to you as an update
            available and you decide. Only a document that still matches what it
            was given can be updated for you, and that update is an ordinary
            version you can restore away from.
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
          data-testid="policy-upstream-readback-error"
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
          data-testid="policy-upstream-unrecognized-level"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-muted-foreground">
            The <span className="font-mono">{policy?.resolved_scope}</span>-band
            row stores the level{" "}
            <code className="font-mono">{unrecognizedLevel}</code>, which coord
            does not recognise. What this dial authorises is coord writing a
            body into this tenant from a publication — an authority setting it
            cannot read is not permission to do that — so the level in force is{" "}
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
          data-testid="policy-upstream-in-force"
        >
          <span className="text-muted-foreground">In force:</span>
          <Badge variant="secondary" className="font-mono">
            {displayLevel}
          </Badge>
          {isDefaulted ? (
            <span className="text-muted-foreground">
              — coord&apos;s built-in default ({POLICY_UPSTREAM_DEFAULT_LEVEL});
              no one has set this tenant&apos;s dial
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
          data-testid="policy-upstream-overridden-by-repo"
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
          data-testid="policy-upstream-system-fallback"
        >
          A fleet-wide <strong>system</strong>-band row is answering because
          this tenant has none of its own. Coord resolves the most specific band
          first, so setting a level here takes effect immediately.
        </p>
      ) : null}

      <RadioGroup
        value={displayLevel ?? undefined}
        onValueChange={(v) => onSelect(v as PolicyUpstreamLevel)}
        disabled={!canEdit || saving || loading}
        className="gap-3"
      >
        {POLICY_UPSTREAM_SELECTABLE_LEVELS.map((level) => (
          <div key={level} className="flex items-start gap-3">
            <RadioGroupItem
              value={level}
              id={`policy-upstream-${level}`}
              className="mt-1"
            />
            <label
              htmlFor={`policy-upstream-${level}`}
              className="cursor-pointer text-sm"
            >
              <span className="font-mono font-medium">{level}</span>
              {POLICY_UPSTREAM_CONFIRMED_LEVELS.includes(level) ? (
                <Badge variant="outline" className="ml-2 align-middle text-xs">
                  can change a document without a click
                </Badge>
              ) : null}
              <span className="mt-0.5 block text-muted-foreground">
                {POLICY_UPSTREAM_LEVEL_HELP[level]}
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
        question rather than a silent gap, exactly as the sibling dial carries
        it.
      */}
      {policy && policy.keys_not_shown.length > 0 ? (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="policy-upstream-keys-not-shown"
        >
          Coord also returned {policy.keys_not_shown.join(", ")} with this read.{" "}
          {policy.keys_not_shown_source === "fleet_resources_row"
            ? "Those belong to the fleet_resources row, not to upstream policy updates, and are not shown here."
            : "Those are not shown here."}
        </p>
      ) : null}

      {/*
        `auto` is the only level at which a document here changes without anyone
        here clicking, so it is confirmed rather than applied on a single click
        — the convention this page already holds for `full` on the policy-write
        dial and for overriding a built-in protection in the list above.

        The confirmation says what it does and what it does NOT do. The second
        half matters more: an operator reading "updates apply automatically"
        without the never-overwrite-an-edit property in front of them can
        reasonably fear their own wording is about to be replaced fleet-wide.
      */}
      <AlertDialog
        open={pendingLevel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLevel(null);
        }}
      >
        <AlertDialogContent data-testid="policy-upstream-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Let published updates apply without your click?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  At <span className="font-mono">auto</span>, a document you
                  have <strong>never edited</strong> takes a new publication on
                  its own. It lands as an ordinary new version — the previous
                  wording stays in this page&apos;s version history and is
                  restorable in one click — and you are told afterwards rather
                  than asked first.
                </p>
                <p>
                  This does <strong>not</strong> touch a document you have
                  edited. Only a body that still matches, byte for byte, the
                  publication it already tracks is ever replaced; anything else
                  is shown to you as an update available and waits for your
                  decision.
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
              Set to auto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
