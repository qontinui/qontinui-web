"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { usePolicyWritePolicy } from "../_hooks/usePolicyWritePolicy";
import {
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
 * | `agent_writable` | may an agent write THIS document at all? | per document |
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
 * ## Why "no row" is rendered as a named default, not as `off`
 *
 * Coord answers `effective_level: "off"` for two different facts — nobody ever
 * wrote a row, and an operator turned it off — and for this domain they resolve
 * in OPPOSITE directions. Rendering the raw value would tell every tenant that
 * has never touched this dial that agent policy writes are disabled, when they
 * are working normally. The badge therefore always names the state AND its
 * source, the same [policy: ux-priorities] predictability rule
 * `AgentWriteAccessControl` states for its own three-state setting: a control
 * whose current value you cannot read correctly cannot be changed safely.
 */
export function PolicyWriteDialControl() {
  const {
    policy,
    loading,
    saving,
    error,
    displayLevel,
    isDefaulted,
    readbackError,
    reload,
    setLevel,
  } = usePolicyWritePolicy();

  const canEdit = policy?.can_edit ?? false;

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
              {error} The value below is the last one confirmed and may be
              stale.
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
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-muted-foreground">
            The last write went through, but reading it back failed (
            {readbackError}) — what devices actually resolve is{" "}
            <strong>unknown</strong> until this refreshes.
          </p>
        </div>
      ) : null}

      {policy ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">In force:</span>
          <Badge variant="secondary" className="font-mono">
            {displayLevel}
          </Badge>
          {isDefaulted ? (
            <span className="text-muted-foreground">
              — coord&apos;s built-in default ({POLICY_WRITE_DEFAULT_LEVEL}); no
              one has set this tenant&apos;s dial
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

      <RadioGroup
        value={displayLevel ?? undefined}
        onValueChange={(v) => setLevel(v as PolicyWriteLevel)}
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
              <span className="mt-0.5 block text-muted-foreground">
                {POLICY_WRITE_LEVEL_HELP[level]}
              </span>
            </label>
          </div>
        ))}
      </RadioGroup>

      {/*
        `full` is deliberately absent from the list above. Saying so beats
        leaving a gap in a documented total order — an operator who has read the
        levels elsewhere will otherwise wonder whether this console is out of
        date.
      */}
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">full</span> — landing a classified loosening
        with a notification instead of a proposal — is not selectable yet. Its
        only safety property is that you are told afterwards, and policy-change
        notifications have not shipped. Coord clamps it to{" "}
        <span className="font-mono">tightening_only</span> server-side until
        they do, so setting it by hand would not take effect either.
      </p>

      {policy && !canEdit ? (
        <p className="text-xs text-muted-foreground">
          You do not have tenant-admin rights in this tenant, so the dial is
          read-only here.
        </p>
      ) : null}
    </section>
  );
}
