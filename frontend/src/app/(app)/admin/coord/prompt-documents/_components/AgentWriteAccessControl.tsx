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
import type { PromptDocumentSummary } from "../types";

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
 * ## Why overriding a built-in protection is confirmed
 *
 * Three documents are protected by a compile-time constant in coord because
 * they define how every other document is classified and applied — appending to
 * them can redefine what a rule *means*, so the added text is itself the
 * authority. Opening one is legitimate (the operator owns this decision) but it
 * is not an ordinary row edit, and a control that made it one click would make
 * the fleet's most consequential setting its least deliberate.
 */
export interface AgentWriteAccessControlProps {
  doc: PromptDocumentSummary;
  /** Disabled while any save is in flight. */
  saving: boolean;
  /** Persist the new value. Resolves `true` when the write landed. */
  onSet: (next: boolean) => Promise<boolean>;
}

/** True once coord is returning the derived access fields at all. */
function coordReportsAccess(doc: PromptDocumentSummary): boolean {
  return doc.agent_write_effective !== undefined;
}

/** Badge copy for each of the four (effective × source) combinations. */
function describe(doc: PromptDocumentSummary): {
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
  if (!coordReportsAccess(doc)) {
    return {
      label: "Access unknown",
      variant: "outline",
      title:
        "This coord build does not report per-document agent write access yet, so its state cannot be shown. It is not necessarily protected — coord is applying its built-in default. The control becomes available once coord deploys the per-document access change.",
    };
  }
  const bySource = doc.agent_write_source === "operator";
  if (doc.agent_write_effective) {
    return bySource
      ? {
          label: "Agent-writable (set)",
          variant: "success",
          title:
            "An operator explicitly opened this document to agent writes. It stays open even if coord's built-in default changes.",
        }
      : {
          label: "Agent-writable (default)",
          variant: "outline",
          title:
            "No operator has ruled on this document, so coord's built-in default applies — ordinary documents are agent-writable. This tracks the default: if coord's default changes, so does this.",
        };
  }
  return bySource
    ? {
        label: "Protected (set)",
        variant: "destructive",
        title:
          "An operator explicitly protected this document. Agents cannot write it.",
      }
    : {
        label: "Protected (default)",
        variant: "secondary",
        title:
          "Protected by coord's built-in rule: this is a meta-policy — it defines how every other document is classified and applied — so agents cannot write it unless an operator overrides that.",
      };
}

export function AgentWriteAccessControl({
  doc,
  saving,
  onSet,
}: AgentWriteAccessControlProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { label, variant, title } = describe(doc);

  // Never offer a toggle whose current value we cannot read: the operator would
  // be flipping a switch without knowing which way it points, and coord would
  // reject the PATCH field anyway on a build that does not know it.
  const known = coordReportsAccess(doc);
  const opening = !doc.agent_write_effective;
  // Overriding a COMPILE-TIME protection is the deliberate case. Overriding an
  // operator's own earlier `false` is an ordinary change of mind.
  const overridesBuiltIn = opening && doc.agent_write_source === "default";

  const apply = async () => {
    await onSet(opening);
    setConfirmOpen(false);
  };

  return (
    <>
      <Badge
        variant={variant}
        title={title}
        className="shrink-0 text-[10px]"
        data-testid={`doc-access-${doc.kind}-${doc.name}`}
        data-source={doc.agent_write_source}
        data-effective={String(doc.agent_write_effective)}
      >
        {label}
      </Badge>

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        disabled={saving || !known}
        onClick={() => (overridesBuiltIn ? setConfirmOpen(true) : void apply())}
        title={
          !known
            ? "Unavailable until coord reports per-document agent write access"
            : opening
              ? "Allow agents to write this document"
              : "Protect this document from agent writes"
        }
        data-testid={`doc-access-toggle-${doc.kind}-${doc.name}`}
      >
        {opening ? (
          <LockOpen className="size-4" />
        ) : (
          <Lock className="size-4" />
        )}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Open a built-in protected document to agent writes?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <code>
                    {doc.kind}/{doc.name}
                  </code>{" "}
                  is protected by coord itself, not by a setting. It is a{" "}
                  <strong>meta-policy</strong>: it defines how every other
                  document is classified, tiered and applied — including the
                  limits on the agent write tool.
                </p>
                <p>
                  That is why appending to it is different in kind from
                  appending to an ordinary policy. A clause added here can
                  change what a rule <em>means</em>, so the added text is itself
                  the authority — the usual &ldquo;an append can only add, never
                  weaken&rdquo; guarantee does not constrain it.
                </p>
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
