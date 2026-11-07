"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConditionStatus } from "../types";

type BadgeVariant = "success" | "destructive" | "warning" | "info" | "outline";

interface StatusMeta {
  variant: BadgeVariant;
  label: string;
}

/** Map each status this page knows to a badge variant + human label. */
const STATUS_META: Record<ConditionStatus, StatusMeta> = {
  pass: { variant: "success", label: "Pass" },
  fail: { variant: "destructive", label: "Fail" },
  error: { variant: "warning", label: "Error" },
  running: { variant: "info", label: "Running" },
  unknown: { variant: "outline", label: "Unknown" },
};

function isKnownStatus(word: string): word is ConditionStatus {
  return Object.hasOwn(STATUS_META, word);
}

/**
 * The badge treatment for a status word. A word this page does not know (a
 * status added after this build, a misspelling, `PASS`) renders as itself on
 * the neutral treatment: never a pass style, and never a throw.
 */
function statusMeta(status: string): StatusMeta {
  return isKnownStatus(status)
    ? STATUS_META[status]
    : { variant: "outline", label: status };
}

/**
 * What each cause coord records in a run's `unknown_detail` means, for an
 * operator who cannot read the source: what happened, then what to do next.
 * `runner_refused:<reason>` carries the runner's reason, so `causeSentence`
 * matches it by prefix instead of listing it here.
 */
const CAUSE_SENTENCES: ReadonlyMap<string, string> = new Map([
  [
    "no_report_within_deadline",
    "The check agent sent no report before the run's deadline. Check that " +
      "the runner paired to this project is online, then run the group again.",
  ],
  [
    "publish_refused",
    "The run was refused before it reached a runner, so nothing was checked. " +
      "Check that a runner paired to this project is online and that " +
      "regression-test runs are turned on for it, then run the group again.",
  ],
  [
    "spawn_failed",
    "The runner could not start the check agent, so nothing was checked. " +
      "Check that the runner is running and up to date, then run the group " +
      "again.",
  ],
  [
    "legacy_status",
    "This run's agent reported a status that is not a verdict, before " +
      "results were checked against the conditions. Run the group again for " +
      "a checked result.",
  ],
  [
    "no_secret_capable_runner",
    "No runner can type this group's credentials yet. Update a runner to a " +
      "build that substitutes secrets.",
  ],
]);

const RUNNER_REFUSED = "runner_refused:";

/** The sentence for a cause, or `undefined` when this page has none for it. */
function causeSentence(cause: string): string | undefined {
  if (cause.startsWith(RUNNER_REFUSED)) {
    const why = cause.slice(RUNNER_REFUSED.length).trim();
    const named = why ? ` (${why})` : "";
    return (
      `The runner refused the check${named}, so nothing was checked. Run the ` +
      "group again once that runner accepts work, or pair another runner to " +
      "this project."
    );
  }
  return CAUSE_SENTENCES.get(cause);
}

/**
 * The same, for each unknown code a run carries in `unknown_reason` (a member
 * of the shared unknown-code set). Used when the run names no mapped cause.
 */
const CODE_SENTENCES: ReadonlyMap<string, string> = new Map([
  [
    "not_reported",
    "Some conditions got no verdict from the check agent. Expand the run to " +
      "see which, then run the group again.",
  ],
  [
    "no_results",
    "The check agent reported no verdicts, or the group had no enabled " +
      "conditions when it ran. Check that the group has enabled conditions, " +
      "then run it again.",
  ],
  [
    "no_expectation",
    "The check agent gave a verdict without first committing what it would " +
      "check, so the verdict could not be judged. Run the group again.",
  ],
  [
    "no_event_before_timeout",
    "No report arrived before the run's deadline. Check that the runner " +
      "paired to this project is online, then run the group again.",
  ],
  [
    "producer_not_run",
    "The check never ran. Check that a runner paired to this project is " +
      "online and accepting work, then run the group again.",
  ],
  [
    "producer_failed",
    "The check could not be started. Check that the runner paired to this " +
      "project is running and up to date, then run the group again.",
  ],
  [
    "model_reply_unparseable",
    "The check agent's reply could not be read as a verdict. Run the group " +
      "again.",
  ],
  [
    "capability_unavailable_in_build",
    "No runner paired to this project has a build that can run this check. " +
      "Update a runner, then run the group again.",
  ],
]);

/** A non-blank string, trimmed. Anything else is absent: the wire is unchecked. */
function present(word: unknown): string | null {
  return typeof word === "string" ? word.trim() || null : null;
}

/**
 * The sentence a badge adds after "<label> — ". A mapped cause's sentence
 * replaces its code's (the code is then not shown); without a mapped cause,
 * the code's sentence. A word with no sentence renders as itself, and an
 * unmapped cause shows in brackets after its code's text.
 */
function reasonSentence(
  reason: string | null | undefined,
  detail: string | null | undefined
): string | null {
  const code = present(reason);
  const cause = present(detail);
  const forCause = cause ? causeSentence(cause) : undefined;
  if (forCause) return forCause;
  const forCode = code ? (CODE_SENTENCES.get(code) ?? code) : null;
  if (forCode && cause) return `${forCode} (${cause})`;
  return forCode ?? cause;
}

interface StatusBadgeProps {
  /**
   * A run's or group's status. Any string, not only a `ConditionStatus`: the
   * backend proxy passes coord's word through unchanged.
   */
  status: string | null | undefined;
  /** A run's `unknown_reason`: why it reads unknown, as an unknown code. */
  reason?: string | null;
  /** A run's `unknown_detail`: the cause coord recorded beside that code. */
  detail?: string | null;
  /** Label shown when there is no status yet (default "Never run"). */
  emptyLabel?: string;
}

/**
 * Status pill for a group's last run or an individual run. Colors come from the
 * shared badge variants (`success`/`destructive`/`warning`/`info`/`outline`) —
 * never hardcoded. A missing status renders a neutral "Never run" pill; an
 * `unknown` status, or any word this page does not know, renders neutral too.
 * A run's reason follows its label as a sentence naming the next action.
 */
export function StatusBadge({
  status,
  reason,
  detail,
  emptyLabel = "Never run",
}: StatusBadgeProps) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {emptyLabel}
      </Badge>
    );
  }
  const meta = statusMeta(status);
  const sentence = reasonSentence(reason, detail);
  return (
    <Badge
      variant={meta.variant}
      className={cn(
        meta.variant === "outline" && "text-muted-foreground",
        // A reason is prose: let it wrap inside the row rather than overflow.
        sentence && "shrink whitespace-normal text-left"
      )}
    >
      {sentence ? `${meta.label} — ${sentence}` : meta.label}
    </Badge>
  );
}
