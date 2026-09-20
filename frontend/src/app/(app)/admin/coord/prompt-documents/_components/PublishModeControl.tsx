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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Send } from "lucide-react";
import {
  isPublishMode,
  PUBLISH_MODE_CONFIRMED,
  PUBLISH_MODE_HELP,
  PUBLISH_MODE_LABEL,
  PUBLISH_MODES,
  type PromptDocumentSummary,
  type PublishMode,
} from "../types";

/**
 * Per-document publish mode — the operator's judgement about whether THIS
 * document may distribute itself to every other tenant.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D2/D4.
 *
 * ## Why this is a prop-taking component and its sibling dials are not
 *
 * `PolicyUpstreamDialControl` and `PolicyWriteDialControl` take no props: each
 * renders ONE tenant-wide setting and owns the hook that reads it. This control
 * renders once per document row, and the thing it renders is a field of the row
 * the list already holds. A hook per row would be one fleet-policy read per
 * document on every page load, and — worse — each copy would hold its own idea
 * of the value, so a row could disagree with the list it sits in. So the value
 * comes down as `doc` and the write goes back up as `onSet`, and the list stays
 * the single owner of document state.
 *
 * ## The four states, and why "(undecided)" is rendered but never offered
 *
 * | Stored | Means |
 * |---|---|
 * | `auto` | a settled edit publishes itself, with no click |
 * | `manual` | only a click publishes it; publish-all still covers it |
 * | `never` | never published, by anyone; publish-all leaves it out |
 * | `null`/absent | **nobody has ruled**, and coord's first worker pass will |
 *
 * The fourth is a real state coord reports, and it is deliberately NOT a menu
 * item. There is no wire encoding to return a document to undecided — coord has
 * none either — so an option offering it would be a control whose click coord
 * cannot carry out. It is the same reason `AgentWriteAccessControl` renders
 * `(default)` without offering it, and the same reason the badge names the
 * state rather than folding it into the nearest decided mode: an undecided
 * document shown as `manual` claims a decision nobody took, and one shown as
 * `auto` claims a document is distributing itself when coord may be about to
 * rule otherwise.
 *
 * **What undecided actually resolves to is coord's rule, not a default this
 * component may state.** The first worker pass sets `manual` when the body has
 * lint hits OR the document is an upstream carve-out, and `auto` otherwise —
 * measured at 18 `manual` against 8 `auto` on the qontinui corpus. Deriving
 * that here would mean shipping a second copy of coord's carve-out list into
 * the browser, which is exactly the mistake `agent_write_source` exists to
 * avoid. So the badge says "undecided" and the menu says what each choice does.
 *
 * ## Why `auto` is confirmed
 *
 * It is the only mode at which this tenant's body leaves this tenant with
 * nobody clicking. The page already confirms that property twice — `full` on
 * the policy-write dial, `auto` on the upstream dial — and this is the outbound
 * direction, which is the larger of the two: an upstream `auto` changes one
 * tenant's copy of a document and is one click from reverted, while an outbound
 * `auto` hands a body to every tenant in the fleet and a publication cannot be
 * withdrawn.
 *
 * `manual` and `never` are the safe directions and apply on one click.
 *
 * ## An unrecognized mode is UNKNOWN, and disables the picker
 *
 * A coord release may add a mode this build predates. Offering a picker over a
 * value we cannot read would move the control without the operator knowing
 * where it sits — the same predictability gate the sibling access control names
 * — so the badge shows the raw string and the menu is closed.
 */

interface PublishModeControlProps {
  /** The row this control belongs to. Only its `publish_mode` is read. */
  doc: PromptDocumentSummary;
  /** True while any document write is in flight — disables the picker. */
  saving: boolean;
  /**
   * What the auto-publisher WILL set on its first pass over this document,
   * from coord's status read. Only ever present while the mode is undecided.
   *
   * Never derived here. Coord decides it from its carve-out predicate and its
   * five lint patterns, and a browser copy of either would name the wrong
   * default with total confidence the day one changes — the same reason
   * `agent_write_source` is computed server-side.
   */
  undecidedDefault?: string | null;
  /**
   * Set this document's mode. Resolves `true` when coord accepted it.
   *
   * Takes only the mode: the `(kind, name)` address and the change note are the
   * list's to supply, for the same reason `onSetAgentWriteTier` takes only a
   * tier — a row that addressed its own write could address the wrong one.
   */
  onSet: (mode: PublishMode) => Promise<boolean>;
}

type Resolved =
  | { state: "undecided" }
  | { state: "known"; mode: PublishMode }
  | { state: "unknown"; raw: string };

/** What the row's stored value actually says. Reads; never derives. */
function resolve(doc: PromptDocumentSummary): Resolved {
  const raw = doc.publish_mode;
  // `null` AND absent. Absent is a coord predating `pdpub_03`, or one serving
  // across the deploy window — both are "nobody has ruled", not a mode.
  if (raw === null || raw === undefined) return { state: "undecided" };
  if (isPublishMode(raw)) return { state: "known", mode: raw };
  return { state: "unknown", raw };
}

function describe(
  resolved: Resolved,
  undecidedDefault?: string | null
): {
  label: string;
  variant: "secondary" | "outline" | "success" | "warning";
  title: string;
} {
  if (resolved.state === "undecided") {
    return {
      label: "Publish: undecided",
      variant: "outline",
      title: undecidedDefault
        ? // Coord named the answer, so say it. "Something will be decided" and
          // "`auto` will be set" are different facts, and only the second one
          // tells an operator whether they need to intervene before the next
          // worker pass — which is the only moment intervening is cheap.
          `Nobody has ruled on whether this document may distribute itself. Coord's first auto-publisher pass will set it to "${undecidedDefault}" and tell you. Set it here to decide it yourself instead.`
        : "Nobody has ruled on whether this document may distribute itself. Coord's first auto-publisher pass will decide — manual if the body carries fleet-specific tokens or the document is one the fleet never overwrites, auto otherwise — and tell you which. Set it here to decide it yourself instead.",
    };
  }
  if (resolved.state === "unknown") {
    return {
      label: `Publish: ${resolved.raw}`,
      variant: "warning",
      title: `Coord stores the publish mode "${resolved.raw}", which this console does not recognise. It is shown rather than guessed at, and the picker is closed: moving a control whose current value cannot be read is how a setting gets changed by accident.`,
    };
  }
  return {
    label: `Publish: ${PUBLISH_MODE_LABEL[resolved.mode]}`,
    variant: resolved.mode === "auto" ? "success" : "secondary",
    title: PUBLISH_MODE_HELP[resolved.mode],
  };
}

export function PublishModeControl({
  doc,
  saving,
  undecidedDefault,
  onSet,
}: PublishModeControlProps) {
  /** The mode awaiting confirmation, or `null` when nothing is pending. */
  const [pending, setPending] = useState<PublishMode | null>(null);
  const resolved = resolve(doc);
  const { label, variant, title } = describe(resolved, undecidedDefault);

  const choose = (mode: PublishMode) => {
    if (PUBLISH_MODE_CONFIRMED.includes(mode)) {
      setPending(mode);
      return;
    }
    void onSet(mode);
  };

  const disabled = saving || resolved.state === "unknown";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2"
            title={title}
            data-testid={`doc-publish-mode-${doc.kind}-${doc.name}`}
          >
            <Send className="size-3.5 text-muted-foreground" aria-hidden />
            <Badge variant={variant} className="text-[10px] font-medium">
              {label}
            </Badge>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-sm">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            May this document publish itself to every other tenant? A
            publication is immutable and cannot be withdrawn.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PUBLISH_MODES.map((mode) => (
            <DropdownMenuItem
              key={mode}
              onSelect={() => choose(mode)}
              className="flex flex-col items-start gap-0.5"
              data-testid={`doc-publish-mode-${mode}-${doc.kind}-${doc.name}`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {resolved.state === "known" && resolved.mode === mode ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span className="size-3.5" aria-hidden />
                )}
                {PUBLISH_MODE_LABEL[mode]}
              </span>
              <span className="pl-5 text-xs text-muted-foreground">
                {PUBLISH_MODE_HELP[mode]}
              </span>
            </DropdownMenuItem>
          ))}
          {resolved.state === "undecided" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Nobody has ruled on this document yet.
                {undecidedDefault
                  ? ` Coord's next auto-publisher pass will set it to "${undecidedDefault}".`
                  : ""}{" "}
                There is no way back to undecided once you choose — coord has no
                encoding for it.
              </DropdownMenuLabel>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        `auto` is the only mode at which a body leaves this tenant with nobody
        clicking, and the thing that makes it bigger than the upstream dial's
        `auto` is stated first: a publication cannot be withdrawn.
      */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent data-testid="publish-mode-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Let this document publish itself to the fleet?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  At <span className="font-mono">auto</span>,{" "}
                  <strong>
                    {doc.kind}/{doc.name}
                  </strong>{" "}
                  publishes itself once its edits have settled — 24 hours after
                  a loosening, 6 hours after any other change — and every tenant
                  in the fleet is offered the result. You are told afterwards
                  rather than asked first.
                </p>
                <p>
                  <strong>A publication cannot be withdrawn.</strong> A tenant
                  may already have adopted it, and an offline one certainly has;
                  a mistake is corrected by publishing again, not by taking it
                  back.
                </p>
                <p className="text-muted-foreground">
                  An agent&apos;s edit publishes on the same terms as yours —
                  the wait is a delay, not a review step. What still stands
                  between an edit and the fleet: the wait itself, a hold on any
                  new fleet-specific token, and the receiving side, which never
                  overwrites a document another tenant has edited.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="publish-mode-confirm-accept"
              onClick={() => {
                if (pending) void onSet(pending);
                setPending(null);
              }}
            >
              Set to auto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
