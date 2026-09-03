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
import { AlertTriangle, Lock, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  usePromptDocumentKindTiers,
  type KindTierRow,
  type KindTiersResponse,
} from "../_hooks/usePromptDocumentKindTiers";
import {
  AGENT_WRITE_TIERS,
  isAgentWriteTier,
  type AgentWriteTier,
} from "../types";
import { tierHelp, tierLabel } from "../_lib/agentWriteTier";

/**
 * The per-KIND agent authorship tier — the operator's only lever over a kind
 * whose name space is OPEN.
 *
 * ## Why it is not the same control as `AgentWriteAccessControl`
 *
 * That one sets `agent_write_tier` on a document ROW, so it can only be pointed
 * at a document that already exists. Six kinds (`product_intent`, `initiative`,
 * `success_metric`, `domain_spec`, `audience_profile`, `decision_record`) are
 * denied kind-wide by a coord compile-time default, and their name spaces are
 * open — so an agent's first write to a NEW name is refused and there is
 * nothing to flip: the row the flip would live on is the row the refused write
 * would have created. This control is the only setting that can be expressed
 * before the document exists.
 *
 * The two compose in the documented resolution order — floor, then
 * per-document, then per-kind, then coord's compile-time default — which is why
 * this sits BELOW the document list rather than replacing anything in it: a
 * per-document `deny` still wins over a permissive kind tier, and an operator
 * has to be able to see both to predict either.
 *
 * ## Three things the operator must be able to read off it
 *
 * **1. What `allow_with_notification` actually does, in coord's own words.**
 * Every response carries `notification_enforced` + `warning`, and this component
 * renders that prose rather than a local paraphrase — in BOTH directions. That
 * matters more now than it did when the flag was always `false`: coord#1702
 * shipped the precondition, so `notification_enforced` is `true` and the
 * `warning` became a positive statement PLUS one residual the tier genuinely
 * cannot promise away — the subtractive `policy_write` dial, applied after
 * authorization, which can still refuse a write the tier permitted.
 *
 * Hiding the box on the enforced arm dropped that residual entirely, and three
 * hardcoded copies of "NOT YET ENFORCED" went on asserting the old world. A
 * control that misreports what the click does is worse than no control, and
 * that is true in both directions: the permissive one is more dangerous, the
 * restrictive one just makes the operator distrust the console.
 *
 * **2. A FLOOR is not a setting.** `claude_settings` is denied kind-wide by a
 * rule no stored tier lifts, because a document of that kind is a permission
 * allowlist a machine copies into its own harness configuration. Coord refuses
 * the write with a 409 rather than storing it, so the control is rendered DEAD
 * — a live-looking control whose click changes nothing is the exact lie
 * `is_kind_wide_agent_deny` is exposed to the display path to prevent.
 *
 * **3. "Unset" and "unreadable" are different facts.** Both arrive as
 * `tier: null`. An unset kind falls through to coord's compile-time default; a
 * kind whose stored value coord cannot interpret is fail-closed to `deny` on the
 * enforcement path. Rendering the second as the first would show an operator
 * their built-in default while every agent write is in fact being refused. Only
 * `unreadable` separates them, and it is rendered as its own state.
 */

/**
 * Tiers whose selection is confirmed rather than applied on the click.
 *
 * `tierHelp` and `tierLabel` used to live here. They now come from
 * `../_lib/agentWriteTier`, shared with the per-DOCUMENT control: both surfaces
 * set the same coord vocabulary, and two spellings of what a tier means is
 * precisely how the per-document badge and its toggle came to disagree.
 */
const CONFIRMED_TIERS: readonly AgentWriteTier[] = [
  "allow",
  "allow_with_notification",
];

/**
 * The badge for a row's CURRENT state.
 *
 * ## It renders coord's `effective_tier`, and does not re-derive it
 *
 * The first version of this function rebuilt the answer from `floor` /
 * `unreadable` / `tier` / `builtin_default_denies`. That put the
 * never-overstate-access rule in this file, where it was wrong twice: a stored
 * string outside the vocabulary fell through to a green `success` badge reading
 * "the operator has opened this kind", which is the exact input coord
 * fail-closes to `deny`; and `tier === null` claimed "allowed by default" off
 * one boolean, an access claim asserted against a server field that states the
 * answer directly.
 *
 * So the ANSWER comes from `effective_tier`, which coord derives through its own
 * resolver. The other fields survive only as the WHY — which step answered, and
 * whether the control below should be live.
 *
 * ## An `effective_tier` this console cannot read is UNKNOWN, never permissive
 *
 * `KindTierRow` is a cast over `JSON.parse` output, not a check. A coord serving
 * a tier this build predates, or a hand-written row, arrives here as an
 * arbitrary string. `isAgentWriteTier` is the guard, and an unrecognized value
 * renders as UNKNOWN — the same direction `usePolicyWritePolicy` takes for the
 * dial's own out-of-vocabulary case, and for the same reason: rendering the raw
 * value would show a row coord refuses every write to as the state in force.
 */
function describe(
  row: KindTierRow,
  enforced: boolean
): {
  label: string;
  variant: "outline" | "secondary" | "destructive" | "success";
  title: string;
} {
  // A coord that predates the derived fields sends neither. That is UNKNOWN —
  // this console will not re-derive an authority answer from the booleans, for
  // the reasons in the doc comment above.
  if (!isAgentWriteTier(row.effective_tier)) {
    return {
      label: "unknown",
      variant: "secondary",
      title:
        row.effective_tier === undefined
          ? "This coord does not report a resolved authorship tier for a kind. " +
            "The setting is UNKNOWN rather than open — do not read the absence " +
            "as permission."
          : `Coord resolved this kind to \`${String(row.effective_tier)}\`, ` +
            "which this console does not recognise. Treated as UNKNOWN; " +
            "enforcement fail-closes on a value it cannot read.",
    };
  }

  const permissive = row.effective_tier !== "deny";

  if (row.floor) {
    return {
      label: "denied — floor",
      variant: "destructive",
      title:
        "Denied by a coord rule no stored tier lifts. Documents of this kind " +
        "are copied into a machine's own harness configuration, so an agent " +
        "authoring one would author the permission rules agents then run under.",
    };
  }
  if (row.unreadable) {
    return {
      label: "unreadable",
      variant: "secondary",
      title:
        "A tenant setting EXISTS and coord cannot interpret its value. " +
        "Enforcement fail-closes to `deny` on it, so agent writes to this kind " +
        "are being refused. Set the tier again to correct the row.",
    };
  }
  // `settable: false` on a row coord did NOT mark as a floor. The two are the
  // same claim today, so this arm is unreachable — but they are separate wire
  // fields, and a row asserting one without the other used to render "allowed
  // by default" beside "No setting can open this kind." Say the honest thing
  // instead of picking whichever field is read first.
  if (!row.settable) {
    return {
      label: permissive ? `${row.effective_tier} — locked` : "denied — locked",
      variant: permissive ? "secondary" : "destructive",
      title:
        "Coord reports this kind as not settable without reporting it as a " +
        "floor. The tier in force is what coord resolved; no control here can " +
        "change it.",
    };
  }
  if (row.effective_source === "default") {
    return {
      label: permissive
        ? "not set — allowed by default"
        : "not set — denied by default",
      variant: permissive ? "outline" : "destructive",
      title:
        "No tenant setting. Coord's compile-time default decides, and it " +
        "tracks future changes to that default — which an explicit setting " +
        "would not.",
    };
  }
  if (!permissive) {
    return {
      label: "denied",
      variant: "destructive",
      title: "The operator has closed this kind to agent authorship.",
    };
  }
  return {
    label: tierLabel(row.effective_tier),
    variant: "success",
    title:
      row.effective_tier === "allow_with_notification"
        ? enforced
          ? "The operator has opened this kind. Coord enforces the notification " +
            "precondition: a write is refused unless it names a recent finding " +
            "the same session posted about the document."
          : "The operator has opened this kind. The notification precondition is " +
            "NOT enforced by this coord — the tier behaves as `allow`."
        : "The operator has opened this kind to agent authorship.",
  };
}

/**
 * Is the notification precondition ENFORCED by the coord that answered?
 *
 * Strict `=== true`, so an ABSENT flag is not enforced. `KindTierRow` and its
 * response are casts over `JSON.parse`, not checks: a coord that predates the
 * field sends nothing, and reading that absence as enforcement would claim a
 * guarantee off a missing key — in the permissive direction, which is the one
 * that matters.
 */
function isEnforced(data: KindTiersResponse): boolean {
  return data.notification_enforced === true;
}

/**
 * Coord's own disclosure prose, with a local fallback per enforcement state.
 *
 * The box renders in BOTH states now, and that is the fix rather than a
 * cosmetic change. Coord#1702 shipped the precondition and deliberately KEPT
 * this field rather than deleting it with the caveat it used to carry, because
 * the honest answer became a positive fact plus one residual: the subtractive
 * `policy_write` dial runs AFTER authorization and can still refuse a write the
 * tier permitted, with its own codes. Rendering only the un-enforced arm threw
 * that residual away the moment it became the only thing left to say.
 *
 * The fallbacks keep the box meaningful if coord ever drops the prose while
 * keeping the flag — an amber box containing an icon and no text reads as a
 * rendering bug rather than as a disclosure.
 */
function disclosureText(data: KindTiersResponse): string {
  if (data.warning) return data.warning;
  return isEnforced(data)
    ? "`allow_with_notification` is enforced by this coord: a write on that tier " +
        "is refused unless it carries a notification reference naming a recent " +
        "finding the same session posted about the document."
    : "`allow_with_notification` is not enforced by this coord: the tier resolves, " +
        "but the notification precondition is not checked, so a kind on that tier " +
        "accepts unannounced agent writes.";
}

/**
 * The names under a kind that a kind-wide `allow` will NOT reach — coord's
 * compiled-in per-document denies, answered at resolution step 2b, ABOVE the
 * per-kind table.
 *
 * Read defensively rather than trusted: this is a cast over `JSON.parse`, so a
 * coord that predates the field sends nothing (which is UNKNOWN, and rendering
 * nothing is the honest answer for it) and a malformed value must not throw
 * inside a render.
 */
function protectedDocuments(row: KindTierRow): string[] {
  const raw = row.protected_documents;
  return Array.isArray(raw)
    ? raw.filter((n): n is string => typeof n === "string")
    : [];
}

/**
 * What CLEARING this kind produces, named rather than implied.
 *
 * `builtin_default_denies` is the one wire field on `KindTierRow` that says
 * which way coord's compile-time answer falls, and it is the only thing that
 * makes "coord's built-in default applies again" a statement rather than a
 * gesture. Without it, clearing an OPEN kind whose built-in default denies is a
 * closing action rendered as a neutral one — and the asymmetry this control is
 * built on (opening is confirmed, closing and clearing are not) only holds if
 * the operator can see which direction a click goes.
 */
function clearTitle(row: KindTierRow): string {
  // No floor arm: the button only renders inside `row.settable`, and a floored
  // kind is not settable. Writing one would add a branch nothing can reach.
  const base =
    "Remove the tenant setting so coord's built-in default applies again";
  return row.builtin_default_denies
    ? `${base} — for this kind that default DENIES agent authorship, so clearing CLOSES it.`
    : `${base} — for this kind that default ALLOWS agent authorship, so clearing leaves it open and tracking coord's default.`;
}

export function KindAuthorshipTierControl() {
  const { data, loading, saving, error, setTier, clearTier } =
    usePromptDocumentKindTiers();
  const [pending, setPending] = useState<{
    kind: string;
    tier: AgentWriteTier;
  } | null>(null);

  // The pending kind's named denies, resolved from the SAME read the rows
  // render — not carried on `pending`, so a reload between opening the dialog
  // and confirming shows the fresh answer rather than the one that was true
  // when the button was clicked.
  const pendingReserved = pending
    ? protectedDocuments(
        data?.kinds.find((k) => k.kind === pending.kind) ??
          ({ kind: pending.kind } as KindTierRow)
      )
    : [];

  // COORD'S vocabulary, intersected with what this console knows how to label.
  // Rendering the local constant instead offers a button coord will 400 the
  // moment the two sets diverge, and hides a tier coord accepts — and
  // `types.ts` already warns that these strings are a wire contract, so
  // renaming one here does not rename it there. Falls back to the local list
  // only when coord sent no vocabulary at all, which is the pre-field coord.
  const offeredTiers: readonly AgentWriteTier[] = data?.vocabulary
    ? data.vocabulary.filter(isAgentWriteTier)
    : AGENT_WRITE_TIERS;

  // ONE read of the flag, threaded into every place that describes what the
  // tier does. Three separate hardcoded copies is how this console ended up
  // asserting "NOT YET ENFORCED" for a precondition coord had already shipped.
  const enforced = data ? isEnforced(data) : false;

  return (
    <section
      className="space-y-4"
      data-testid="kind-authorship-tier-control"
      aria-labelledby="kind-authorship-tier-heading"
    >
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2
            id="kind-authorship-tier-heading"
            className="text-base font-semibold"
          >
            Agent authorship by kind
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Whether agents may author documents of a kind — including names that
            do not exist yet. The per-document control above can only be set on
            a document that already exists, so for a kind with an open name
            space this is the only setting there is. A per-document{" "}
            <code>deny</code> still wins over a permissive kind tier.
          </p>
        </div>
      </div>

      {/*
        Coord's OWN words, not a local paraphrase — in BOTH enforcement states.

        This used to render only while `notification_enforced` was falsy, on the
        reasoning that the notice would disappear on its own once Phase 2
        landed. Phase 2 landed (coord#1702) and the field did NOT become
        content-free: coord kept it deliberately, because the honest answer is
        now a positive fact PLUS one residual the tier cannot promise away — the
        subtractive `policy_write` dial runs after authorization and can still
        refuse a write this tier permitted, with its own codes. Hiding the box
        threw that away and left the operator with three stale hardcoded
        paraphrases instead.

        The STYLING is what keys off the flag, not the presence: amber and a
        warning icon while the precondition is unenforced, neutral and a shield
        while it is. `data-enforced` carries the same fact to the tests so they
        pin which arm rendered rather than only that something did.
      */}
      {data && (
        <div
          className={
            enforced
              ? "flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
              : "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          }
          data-testid="kind-tier-notification-disclosure"
          data-enforced={enforced ? "true" : "false"}
          role="status"
        >
          {enforced ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          )}
          <p className="text-muted-foreground">{disclosureText(data)}</p>
        </div>
      )}

      {error && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-muted-foreground"
          data-testid="kind-tier-error"
          role="alert"
        >
          {error} — the settings below may be stale or absent. This is UNKNOWN,
          not &ldquo;no kind has a setting&rdquo;.
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {data && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.kinds.map((row) => {
            const badge = describe(row, enforced);
            const reserved = protectedDocuments(row);
            return (
              <li
                key={row.kind}
                className="flex flex-wrap items-center gap-3 p-3"
                data-testid={`kind-tier-row-${row.kind}`}
              >
                <code className="text-sm font-medium">{row.kind}</code>
                <Badge variant={badge.variant} title={badge.title}>
                  {row.floor && <Lock className="mr-1 size-3" />}
                  {badge.label}
                </Badge>
                {/*
                  The names a kind-wide `allow` does NOT reach. Coord answers
                  these at resolution step 2b, ABOVE the per-kind table, and
                  sends them precisely so this control stops reading as "allow
                  opens every document of this kind" — `policy` renders
                  `settable: true` and `floor: false`, so without this an
                  operator would reasonably read an `allow` as opening
                  `policy/session-protocol`, `policy/security-and-autonomy` and
                  `policy/escalation-bar`, the three documents that ARE the
                  authority interpreting every other document. It does not.

                  Empty for most kinds, including all six intent kinds, whose
                  compiled-in answer is the liftable `KindDefault` this lever
                  exists to lift — so this renders nothing in the common case.
                */}
                {reserved.length > 0 && (
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`kind-tier-protected-${row.kind}`}
                    title={
                      "Coord denies these documents BY NAME, above the per-kind " +
                      "tier. Opening this kind does not reach them; their only " +
                      "lever is the per-document tier on each row."
                    }
                  >
                    <Lock className="mr-1 inline size-3" />
                    {reserved.length} document
                    {reserved.length === 1 ? "" : "s"} stay closed:{" "}
                    <code>{reserved.join(", ")}</code>
                  </span>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {row.settable ? (
                    <>
                      {offeredTiers.map((tier) => (
                        <Button
                          key={tier}
                          size="sm"
                          variant={row.tier === tier ? "default" : "outline"}
                          disabled={saving || row.tier === tier}
                          title={tierHelp(tier, {
                            subject: "kind",
                            notifyEnforced: enforced,
                          })}
                          onClick={() => {
                            if (CONFIRMED_TIERS.includes(tier)) {
                              setPending({ kind: row.kind, tier });
                            } else {
                              void setTier(row.kind, tier);
                            }
                          }}
                        >
                          {tierLabel(tier)}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          saving || (row.tier === null && !row.unreadable)
                        }
                        title={clearTitle(row)}
                        onClick={() => void clearTier(row.kind)}
                      >
                        clear
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No setting can open this kind.
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Opening a kind is confirmed, closing one is not. The asymmetry is the
        point: `deny` and `clear` are the recoverable directions, while opening
        a kind grants authorship over every name under it — including every name
        nobody has invented yet — which is precisely the reach that makes this
        control worth having and worth pausing over.
      */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Open <code>{pending?.kind}</code> to agent authorship?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Agents will be able to author <em>every</em> document of this
                  kind, including names that do not exist yet. Every write is
                  versioned and attributed, and this setting is reversible from
                  this page.
                </p>
                {/*
                  What the kind-wide `allow` will NOT reach, named at the moment
                  of the click. This is the confirmation for the one action that
                  grants authorship over every name under a kind, so the carve-
                  out belongs HERE and not only in the row above it: an operator
                  opening `policy` is entitled to know, before confirming, that
                  the three meta-policies stay closed — and equally that nothing
                  else does.
                */}
                {pendingReserved.length > 0 && (
                  <p data-testid="kind-tier-dialog-protected">
                    Coord denies <code>{pendingReserved.join(", ")}</code> by
                    name, above this setting — opening the kind does not reach{" "}
                    {pendingReserved.length === 1 ? "it" : "them"}.
                  </p>
                )}
                {/*
                  Coord's own prose on the tier being confirmed, in either
                  enforcement state. The amber styling is the part that keys off
                  the flag; the TEXT is shown either way, because on the
                  enforced arm it carries the residual `policy_write` dial
                  caveat and that is exactly what an operator picking this tier
                  needs before the click rather than after.
                */}
                {pending?.tier === "allow_with_notification" && data && (
                  <p className={enforced ? undefined : "text-amber-600"}>
                    {disclosureText(data)}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) void setTier(pending.kind, pending.tier);
                setPending(null);
              }}
            >
              Open the kind
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
