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
import { AlertTriangle, Lock, ShieldQuestion } from "lucide-react";
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
 * **1. `allow_with_notification` does not do what its name says — yet.** Coord
 * resolves the tier and does not enforce the notification precondition; every
 * response says so in `notification_enforced` / `warning`, and this component
 * renders coord's own words rather than a local paraphrase that could drift out
 * of date the moment Phase 2 lands. A control that misreports what the click
 * does, in the permissive direction, is worse than no control.
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

/** What each tier means, in the operator's terms. */
const TIER_HELP: Record<AgentWriteTier, string> = {
  deny: "Agents may not author documents of this kind. Coord refuses the write and names the remedy.",
  allow:
    "Agents may author documents of this kind, including names that do not exist yet. Every write is versioned and attributed.",
  allow_with_notification:
    "Intended: agents may author, but only with a notification reference. NOT YET ENFORCED — see the notice above.",
};

/** Tiers whose selection is confirmed rather than applied on the click. */
const CONFIRMED_TIERS: readonly AgentWriteTier[] = [
  "allow",
  "allow_with_notification",
];

function tierLabel(tier: AgentWriteTier): string {
  return tier.replace(/_/g, " ");
}

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
function describe(row: KindTierRow): {
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
        ? "The operator has opened this kind. The notification precondition is " +
          "NOT enforced by the deployed coord — this behaves as `allow`."
        : "The operator has opened this kind to agent authorship.",
  };
}

/**
 * Coord's own disclosure prose, with a local fallback.
 *
 * `notification_enforced` being ABSENT is falsy, so a coord that omits both
 * fields takes the warning branch — which is the right direction (fail toward
 * saying something, not toward silence) and the wrong content: it rendered an
 * amber box containing an icon and no text, which reads as a rendering bug
 * rather than as a disclosure. The fallback keeps the box meaningful if coord
 * ever drops the prose while keeping the flag.
 */
function disclosureText(data: KindTiersResponse): string {
  return (
    data.warning ??
    "`allow_with_notification` is not enforced by this coord: the tier resolves, " +
      "but the notification precondition is not checked, so a kind on that tier " +
      "accepts unannounced agent writes."
  );
}

export function KindAuthorshipTierControl() {
  const { data, loading, saving, error, setTier, clearTier } =
    usePromptDocumentKindTiers();
  const [pending, setPending] = useState<{
    kind: string;
    tier: AgentWriteTier;
  } | null>(null);

  // COORD'S vocabulary, intersected with what this console knows how to label.
  // Rendering the local constant instead offers a button coord will 400 the
  // moment the two sets diverge, and hides a tier coord accepts — and
  // `types.ts` already warns that these strings are a wire contract, so
  // renaming one here does not rename it there. Falls back to the local list
  // only when coord sent no vocabulary at all, which is the pre-field coord.
  const offeredTiers: readonly AgentWriteTier[] = data?.vocabulary
    ? data.vocabulary.filter(isAgentWriteTier)
    : AGENT_WRITE_TIERS;

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
        Coord's OWN words, not a local paraphrase. When Phase 2 lands and coord
        starts sending `notification_enforced: true`, this notice disappears on
        its own — a hardcoded copy here would have to be found and deleted, and
        would sit there being wrong in the permissive direction until it was.
      */}
      {data && !data.notification_enforced && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          data-testid="kind-tier-notification-disclosure"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
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
            const badge = describe(row);
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
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {row.settable ? (
                    <>
                      {offeredTiers.map((tier) => (
                        <Button
                          key={tier}
                          size="sm"
                          variant={row.tier === tier ? "default" : "outline"}
                          disabled={saving || row.tier === tier}
                          title={TIER_HELP[tier]}
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
                        title="Remove the tenant setting so coord's built-in default applies again."
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
                {pending?.tier === "allow_with_notification" &&
                  data &&
                  !data.notification_enforced && (
                    <p className="text-amber-600">{disclosureText(data)}</p>
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
