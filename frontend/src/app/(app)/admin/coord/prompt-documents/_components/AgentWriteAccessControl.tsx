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
import { Lock, LockOpen } from "lucide-react";
import {
  isAgentWriteTier,
  type AgentWriteTier,
  type PromptDocumentSummary,
} from "../types";

/**
 * Per-document agent write access — the operator's control over whether agents
 * may write this document via `coord_write_prompt_document`.
 *
 * ## Why this shows a SOURCE and not just a checkbox
 *
 * The underlying setting is three-state, not two:
 *
 * | `agent_writable` | Means |
 * |---|---|
 * | `true` | the operator opened this document |
 * | `false` | the operator protected this document |
 * | `null` | **the operator has never ruled on it** — coord's built-in default decides |
 *
 * A two-state checkbox has to render `null` as one of the other two, and either
 * choice lies. Shown as unchecked, every unconfigured document looks
 * deliberately protected; shown as checked, it looks deliberately opened — and
 * an operator who then "changes nothing" has in fact pinned a value that used
 * to track coord's default. So the badge always names both halves: the state
 * in force, and who put it there.
 *
 * That is the [policy: ux-priorities] predictability gate, not decoration: a
 * control whose current value you cannot read correctly cannot be changed
 * safely.
 *
 * ## The badge reads coord's TIER; the toggle still writes the boolean
 *
 * The same predictability gate is why the badge resolves
 * `agent_write_effective_tier` rather than `agent_write_effective`. The boolean
 * is coord's own LEGACY projection of the tier and is lossy in the permissive
 * direction: `allow_with_notification` projects to `true`, so a boolean read
 * shows a document on the notification tier as plainly open. The per-KIND
 * control on this page makes that tier settable, and a kind set to it resolves
 * every document under it — so the state the boolean cannot express is one this
 * page now produces.
 *
 * `agent_write_source` is read the same way, for the same reason: coord answers
 * `"operator_kind"` when a tenant setting on the KIND decided, and folding that
 * into `"default"` tells an operator that nobody has ruled on a document their
 * own kind-wide setting is deciding — wrong attribution and wrong remedy at
 * once, since the setting is not on the row the badge is attached to.
 *
 * The WRITE stays two-state. Coord accepts an explicit `agent_write_tier` on
 * the PATCH, but it also resolves this control's legacy `true` as "at least
 * allow" precisely so a two-state client stays correct, and a per-document tier
 * picker is a separate decision from rendering the tier honestly. The one place
 * that costs something is disclosed at the point of the click: protecting a
 * document that carries a stored `allow_with_notification` discards it, and
 * re-opening from here restores plain `allow`.
 *
 * ## Why overriding a built-in protection is confirmed
 *
 * Some documents are protected by a compile-time constant in coord rather than
 * by a setting. Opening one is legitimate — the operator owns this decision —
 * but it is not an ordinary row edit, and a control that made it one click
 * would make the fleet's most consequential setting its least deliberate.
 *
 * ## Why the confirmation names TWO reasons
 *
 * Coord's `AGENT_UNWRITABLE_DOCUMENTS` holds two families, protected for two
 * genuinely different reasons:
 *
 * - **meta-policies** (`kind: "policy"`) define how every other document is
 *   classified and applied, so appending to one can redefine what a rule
 *   *means* — the added text is itself the authority;
 * - **session briefings** (`kind: "session_briefing"`) are PUSHED into the
 *   system prompt of every session the runner hosts, before the agent decides
 *   anything. Every other document in the store is pulled by an agent that
 *   chose to read it. An agent that could write one would be editing the
 *   instructions the NEXT session runs under.
 *
 * The mechanics are kind-generic and stay that way — the control keys purely on
 * the `agent_write_*` fields coord derives. The COPY cannot be: telling an
 * operator that `session_briefing/runner-session` "defines how every other
 * document is classified" is simply false, and it is false at the one moment
 * they are deciding whether to drop the fleet's strongest write protection.
 */
export interface AgentWriteAccessControlProps {
  doc: PromptDocumentSummary;
  /** Disabled while any save is in flight. */
  saving: boolean;
  /** Persist the new value. Resolves `true` when the write landed. */
  onSet: (next: boolean) => Promise<boolean>;
}

/**
 * What coord reports as the RESOLVED tier for this document — three outcomes,
 * and the third is the one a bare `AgentWriteTier | null` would swallow.
 *
 * ## Why this reads the tier and not the boolean
 *
 * `agent_write_effective` is coord's LEGACY two-state projection of
 * `agent_write_effective_tier`, and coord's own wire documentation calls it
 * lossy on purpose: `allow_with_notification` projects to `true`. A surface
 * reading the boolean therefore renders a document on the notification tier as
 * plainly open, which is a permissive-direction misreport of what the operator
 * set — the exact failure the per-KIND control on this page refuses to make
 * about its own rows.
 *
 * That is not a hypothetical window. The per-kind control ships
 * `allow_with_notification` as a settable tier, and a kind set to it resolves
 * every document under it to that tier. The control that produces the state is
 * on this page; the display that could not represent it was too.
 *
 * ## An unrecognized tier is UNKNOWN, never open
 *
 * `PromptDocumentSummary` is a cast over `JSON.parse` output, not a check, so a
 * coord serving a tier this build predates arrives here as an arbitrary string.
 * Enforcement fail-closes on a value it cannot read, so the honest display is
 * UNKNOWN — and the toggle must go dead, because its current position is not
 * something this build can state.
 */
type ResolvedAccess =
  | { state: "known"; tier: AgentWriteTier }
  | { state: "unreported" }
  | { state: "unrecognized"; raw: string };

function resolveAccess(doc: PromptDocumentSummary): ResolvedAccess {
  if (doc.agent_write_effective_tier !== undefined) {
    return isAgentWriteTier(doc.agent_write_effective_tier)
      ? { state: "known", tier: doc.agent_write_effective_tier }
      : { state: "unrecognized", raw: String(doc.agent_write_effective_tier) };
  }
  // A coord that predates the tier schema sends only the boolean. It cannot
  // express `allow_with_notification` at all, so `allow` here means "at least
  // allow" — the same reading coord gives a legacy `true` on the way IN.
  if (doc.agent_write_effective !== undefined) {
    return {
      state: "known",
      tier: doc.agent_write_effective ? "allow" : "deny",
    };
  }
  return { state: "unreported" };
}

/** The badge's base noun for a resolved tier. */
function tierNoun(tier: AgentWriteTier): string {
  switch (tier) {
    case "deny":
      return "Protected";
    case "allow":
      return "Agent-writable";
    case "allow_with_notification":
      return "Agent-writable, notify";
  }
}

/**
 * WHICH level decided, in one word for the badge.
 *
 * `"operator_kind"` gets its own word rather than sharing `"default"`'s. Coord
 * added that source when the per-kind tier shipped, and folding it into
 * `"default"` — which is what `source === "operator"` as a two-way test does —
 * labels a kind an operator deliberately opened or closed as "no operator has
 * ruled on this document", promises that the row tracks coord's default when a
 * stored kind tier does the opposite, and points the remedy at a control that
 * cannot change the setting that decided.
 *
 * `null` for a source coord did not report: the tier is still renderable, the
 * ATTRIBUTION is not, and inventing one is the same overstatement in a quieter
 * place.
 */
function sourceWord(source: PromptDocumentSummary["agent_write_source"]) {
  switch (source) {
    case "operator":
      return "set";
    case "operator_kind":
      return "kind";
    case "default":
      return "default";
    default:
      return null;
  }
}

/**
 * The disclosure appended to any badge sitting on the notification tier.
 *
 * It states what the tier IS and points at the control that reports whether the
 * precondition is ENFORCED — it does not claim enforcement either way. Coord
 * ships `notification_enforced` on the per-kind response and nowhere on the
 * document one, so a claim made here would be a local paraphrase with no source
 * behind it, and it would go stale in the permissive direction the moment Phase
 * 2 of `2026-08-27-tenant-level-agent-authorable-stores` lands.
 */
const NOTIFY_TIER_NOTE =
  " This document is on the `allow_with_notification` tier: agents may write it, and the write is intended to carry a notification reference. Whether the deployed coord enforces that precondition is stated by the “Agent authorship by kind” control below — this badge does not claim it.";

/** Badge copy for each (resolved tier × deciding level) combination. */
function describe(
  doc: PromptDocumentSummary,
  resolved: ResolvedAccess
): {
  label: string;
  variant: "outline" | "secondary" | "destructive" | "success";
  title: string;
} {
  // Deploy window: this page can be live against a coord that predates the
  // feature and omits the fields entirely. Say so rather than guessing — an
  // absent value is UNKNOWN, and both confident renderings are wrong in a way
  // the operator cannot detect. "Protected" would be the worse guess: it
  // reports the corpus as locked down while coord is still allowing writes.
  // Same posture the `degraded` notice on this page already takes for an
  // unprovisioned document store.
  if (resolved.state === "unreported") {
    return {
      label: "Access unknown",
      variant: "outline",
      title:
        "This coord build does not report per-document agent write access yet, so its state cannot be shown. It is not necessarily protected — coord is applying its built-in default. The control becomes available once coord deploys the per-document access change.",
    };
  }

  // A tier coord resolved and this build cannot read. Same direction as the
  // per-kind control takes for the same input, and for the same reason:
  // enforcement fail-closes on a value it cannot parse, so rendering the raw
  // string would show a document coord refuses every agent write to as the
  // state in force.
  if (resolved.state === "unrecognized") {
    return {
      label: "Access unknown",
      variant: "secondary",
      title: `Coord resolved this document to \`${resolved.raw}\`, which this console does not recognise. Treated as UNKNOWN rather than open — enforcement fail-closes on a tier it cannot read.`,
    };
  }

  const { tier } = resolved;
  const word = sourceWord(doc.agent_write_source);
  const label = word ? `${tierNoun(tier)} (${word})` : tierNoun(tier);
  const notify = tier === "allow_with_notification" ? NOTIFY_TIER_NOTE : "";
  const denied = tier === "deny";

  // Coord reported a tier but not which level produced it. The tier is still
  // renderable; the ATTRIBUTION is not, and inventing one would be the same
  // overstatement the unrecognized arm above refuses to make about the tier.
  if (word === null) {
    return {
      label,
      variant: "outline",
      title: `Coord resolved this document to \`${tier}\` but did not report which level decided, so the reason cannot be shown.${notify}`,
    };
  }

  if (doc.agent_write_source === "operator") {
    return {
      label,
      variant: denied ? "destructive" : "success",
      title:
        (denied
          ? "An operator explicitly protected this document. Agents cannot write it."
          : "An operator explicitly opened this document to agent writes. It stays open even if coord's built-in default changes.") +
        notify,
    };
  }

  // The setting that decided is on the KIND, not on this row — so the remedy
  // is not on this row either. Saying "no operator has ruled on this document"
  // here (which is what folding this source into `default` does) is false in
  // both halves: an operator did rule, and a stored kind tier does not track
  // coord's default.
  if (doc.agent_write_source === "operator_kind") {
    return {
      label,
      variant: denied ? "destructive" : "success",
      title:
        (denied
          ? "A tenant setting on this document's KIND protects it — not a setting on this document. Change it under “Agent authorship by kind” below, or set this document explicitly to override the kind."
          : "A tenant setting on this document's KIND opened it — not a setting on this document. Change it under “Agent authorship by kind” below, or set this document explicitly to override the kind.") +
        notify,
    };
  }

  return denied
    ? {
        label,
        variant: "secondary",
        title: `Protected by coord's built-in rule: ${builtInReason(doc.kind)} — so agents cannot write it unless an operator overrides that.`,
      }
    : {
        label,
        variant: "outline",
        title:
          "No operator has ruled on this document or on its kind, so coord's built-in default applies — ordinary documents are agent-writable. This tracks the default: if coord's default changes, so does this." +
          notify,
      };
}

/**
 * The reason coord's compile-time list protects THIS document, in one clause.
 *
 * Two families, two reasons — see the module header. Written as a function
 * rather than a lookup keyed on the whole kind set because only the two
 * protected families ever reach it; anything else falls through to the
 * meta-policy wording it had before, which is the historical default and is
 * only reachable if coord starts protecting a third family without this being
 * updated.
 */
function builtInReason(kind: PromptDocumentSummary["kind"]): string {
  return kind === "session_briefing"
    ? "this text is pushed into the system prompt of every session the runner hosts, before the agent decides anything, so an agent that could write it would be editing the instructions the next session runs under"
    : "this is a meta-policy — it defines how every other document is classified and applied";
}

/**
 * The toggle's title — what THIS click does, including the two things the click
 * does that the badge above does not say.
 *
 * Kept out of the component body because it is a five-way branch on facts that
 * are each individually easy to drop, and a title that silently loses one of
 * them is indistinguishable from a title that never had it.
 */
function toggleTitle({
  resolved,
  opening,
  overridesKind,
  dropsNotifyTier,
}: {
  resolved: ResolvedAccess;
  opening: boolean;
  overridesKind: boolean;
  dropsNotifyTier: boolean;
}): string {
  if (resolved.state === "unrecognized") {
    return `Unavailable: coord resolved this document to \`${resolved.raw}\`, a tier this console does not recognise, so which way this toggle points is unknown.`;
  }
  if (resolved.state === "unreported") {
    return "Unavailable until coord reports per-document agent write access";
  }
  if (opening) {
    return overridesKind
      ? "Allow agents to write this document. Its kind is closed by a tenant setting — this writes a per-document setting that overrides the kind for this document alone."
      : "Allow agents to write this document";
  }
  if (dropsNotifyTier) {
    return "Protect this document from agent writes. This clears its stored `allow_with_notification` tier, and re-opening it from here restores plain `allow` — this two-state control cannot write the notification tier back.";
  }
  return overridesKind
    ? "Protect this document from agent writes. Its kind is open by a tenant setting — this writes a per-document setting that overrides the kind for this document alone."
    : "Protect this document from agent writes";
}

export function AgentWriteAccessControl({
  doc,
  saving,
  onSet,
}: AgentWriteAccessControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const resolved = resolveAccess(doc);
  const { label, variant, title } = describe(doc, resolved);

  // Never offer a toggle whose current value we cannot read: the operator would
  // be flipping a switch without knowing which way it points, and coord would
  // reject the PATCH field anyway on a build that does not know it. An
  // unrecognized tier is the same situation arriving by a different route — the
  // value is there and this build cannot say which way it points.
  const known = resolved.state === "known";
  const opening = known ? resolved.tier === "deny" : false;
  // Overriding a COMPILE-TIME protection is the deliberate case.
  //
  // Keyed on `agent_write_builtin_default` — what the code says regardless of
  // any override — NOT on `agent_write_source === "default"`. The latter looks
  // equivalent and is not: `source` flips to "operator" the first time the
  // document is written and never flips back, so that version of this guard
  // would confirm the first time a meta-policy was opened and stay silent
  // forever after. Open it, protect it again, and the third click would re-open
  // a meta-policy with no prompt at all — the exact thing this dialog exists to
  // prevent. Whether a document IS a meta-policy does not change when the row
  // is written.
  const overridesBuiltIn = opening && doc.agent_write_builtin_default === false;
  /** Which of coord's two protected families this row belongs to. */
  const isBriefing = doc.kind === "session_briefing";
  /**
   * The state in force was decided by a setting on the KIND, so either click
   * here writes a per-document setting that overrides it. Worth saying: the
   * operator is not changing the setting they can see the effect of.
   */
  const overridesKind = doc.agent_write_source === "operator_kind";
  /**
   * Protecting this document would DISCARD a stored `allow_with_notification`,
   * and this two-state toggle cannot put it back.
   *
   * Coord resolves the legacy `true` this control writes as "at least allow",
   * which preserves a stored notification tier — but only while it is still
   * stored. Protect the document and the stored tier becomes `deny`; re-open it
   * and "at least allow" resolves to plain `allow`. The round trip is lossy in
   * the permissive direction, and nothing on this page restores the tier, so
   * the operator has to be told before the first click, not after the second.
   */
  const dropsNotifyTier =
    !opening && doc.agent_write_tier === "allow_with_notification";

  const apply = async () => {
    // Only dismiss on success. `onSet` resolves false on any failure (the hook
    // catches and toasts), and closing the dialog anyway is a stronger success
    // signal than the toast is a failure one — the operator sees the dialog go
    // away and the badge unchanged, and reads that as "it worked, the badge is
    // stale" rather than "it failed".
    if (await onSet(opening)) {
      setConfirmOpen(false);
    }
  };

  return (
    <>
      <Badge
        variant={variant}
        title={title}
        className="shrink-0 text-[10px]"
        data-testid={`doc-access-${doc.kind}-${doc.name}`}
        data-source={doc.agent_write_source ?? "unknown"}
        data-effective={
          doc.agent_write_effective === undefined
            ? "unknown"
            : String(doc.agent_write_effective)
        }
        data-tier={known ? resolved.tier : "unknown"}
      >
        {label}
      </Badge>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={saving || !known}
        onClick={() => (overridesBuiltIn ? setConfirmOpen(true) : void apply())}
        title={toggleTitle({
          resolved,
          opening,
          overridesKind,
          dropsNotifyTier,
        })}
        data-testid={`doc-access-toggle-${doc.kind}-${doc.name}`}
      >
        {/*
          The icon shows the CURRENT state, not the action — the conventional
          toggle affordance. Showing the action instead put an open padlock next
          to a "Protected (default)" badge, two glyphs disagreeing about the same
          fact in the same row. The action lives in the title and the confirm
          dialog.
        */}
        {known && resolved.tier !== "deny" ? (
          <LockOpen className="size-4" />
        ) : (
          <Lock className="size-4" />
        )}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBriefing
                ? "Open the session briefing to agent writes?"
                : "Open a built-in protected document to agent writes?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <code>
                    {doc.kind}/{doc.name}
                  </code>{" "}
                  is protected by coord itself, not by a setting.{" "}
                  {isBriefing ? (
                    <>
                      It is a <strong>session briefing</strong>: this text is
                      appended to, or prepended into, the system prompt of every
                      session the runner hosts.
                    </>
                  ) : (
                    <>
                      It is a <strong>meta-policy</strong>: it defines how every
                      other document is classified, tiered and applied —
                      including the limits on the agent write tool.
                    </>
                  )}
                </p>
                {isBriefing ? (
                  <p>
                    Every other document in this store is <em>pulled</em> by an
                    agent that chose to read it. A briefing is <em>pushed</em>{" "}
                    into every agent before it can decide anything — so an agent
                    allowed to write this one would be editing the instructions
                    the <em>next</em> session runs under, with no operator in
                    the loop.
                  </p>
                ) : (
                  <p>
                    That is why appending to it is different in kind from
                    appending to an ordinary policy. A clause added here can
                    change what a rule <em>means</em>, so the added text is
                    itself the authority — the usual &ldquo;an append can only
                    add, never weaken&rdquo; guarantee does not constrain it.
                  </p>
                )}
                <p className="text-muted-foreground">
                  This is reversible and every write stays versioned and
                  attributed. You can protect it again at any time, and the
                  change is recorded as a new version either way.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it protected</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void apply();
              }}
              disabled={saving}
              data-testid="confirm-open-meta-policy"
            >
              Allow agent writes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
