/**
 * Why a runner read on the UI Bridge dashboard has no answer to show, and the
 * labelled UNKNOWN it renders instead — one classification for every panel
 * (style guide R8: the words come from a pure module, not from JSX).
 *
 * Nothing here renders an empty panel, a zero or a "clear" for a read that did
 * not answer (common brief rule 12; served policy `verification-and-evidence`
 * `unknown-must-not-render-as-a-default`). Every arm names its reason:
 *
 * - **no runner** — nothing was asked; the reason is the runner target's own
 *   (the list has not answered, coord's resolver is down, nothing is paired);
 * - **not carried** — the runner refused the route over the relay (its 403,
 *   `RUNNER_NEEDS_LOCAL`). What that means depends on the route's
 *   {@link RelayCarriage}, and the text names the runner BUILD it came from,
 *   read from the runner's own `/health`, so an operator can tell "rebuild this
 *   runner" from "no build serves this yet";
 * - **withheld** — the runner answered with its egress refusal: the project's
 *   switch for that flow is off, so the answer was never sent;
 * - **failed** — anything else: the relay, the network, or the runner's own
 *   error, explained by the twin's relay-failure reader (the same words the
 *   digital twin's UI Bridge tab uses for the same failure).
 *
 * ## Which reasons a presentation may show (plan
 * `2026-10-23-console-presentation-spaces` D3.3)
 *
 * A reason is the page's own sentence about a fixed route, so it can be shown
 * to an outsider — EXCEPT where it quotes words from outside this page, which
 * can name a machine or a client. Two such sources, each closed here:
 *
 * - a **failed** read's cause quotes the outside world on every arm but one:
 *   a device id (the relay's "device not owned" answer), the runner's own
 *   refusal (its `app-not-found` names the app id it was asked for), a
 *   transport error (its message carries the request path), a status detail
 *   this page has never seen. Only the relay's "runner not connected" 503 is
 *   explained in fixed sentences. So `quotes` is true on every other arm, and
 *   a quoting reason renders through `RedactedText` (`SourceUnknown.tsx`) —
 *   withheld while presenting unless its subject's repository is cleared.
 *   This is an allow-list of one arm, not a block-list of risky ones: a new
 *   or reworded failure fails closed.
 * - a **no-runner** reason may be the dispatch refusal's own sentence, which
 *   names the runner the operator picked ("Your pick … is not currently
 *   listed"). While presenting, {@link noRunnerReason} gives the target's
 *   fixed phrase instead (`quoteMessage: false`).
 *
 * A **withheld** read's sentence is the runner's egress refusal message, a
 * compile-time constant per flow (qontinui-runner `egress.rs`
 * `refusal_message`, e.g. "Terminal streaming is off for this project"), and
 * a **not carried** one names only the route and the runner's build; neither
 * quotes.
 */

import { RUNNER_NEEDS_LOCAL } from "@/lib/runner/api-client";
import type { RunnerTarget } from "@/lib/runner/target";
import {
  EGRESS_OFF_REFUSAL,
  RunnerRelayError,
} from "@/app/(app)/digital-twin/_lib/runner-relay";
import { explainRelayFailure } from "@/app/(app)/digital-twin/_lib/relay-error-presentation";
import type { RunnerRoute } from "./relayReads";

/** The word every unknown reading leads with. */
export const UNKNOWN_WORD = "UNKNOWN";

export type SourceIssue =
  | { readonly kind: "no-runner"; readonly reason: string }
  | { readonly kind: "not-carried" }
  | { readonly kind: "withheld"; readonly message: string | null }
  | {
      readonly kind: "failed";
      readonly cause: string | null;
      readonly requestId: string | null;
      /**
       * Whether `cause` quotes words from outside this page's own sentences —
       * see the module doc. True on every arm but the relay's "runner not
       * connected".
       */
      readonly quotes: boolean;
    };

/**
 * The relay's fixed `detail` on its 503 for a runner holding no relay session
 * (backend `device_bridge_ws.py`; the twin's `relay-error-presentation.ts`
 * explains it in fixed sentences). Should the backend reword it, the failure
 * falls to `quotes: true` — withheld while presenting — never the other way.
 */
const RELAY_NOT_CONNECTED_DETAIL = "runner not connected";

function isRelayNotConnected(error: unknown): boolean {
  return (
    error instanceof RunnerRelayError &&
    error.status === 503 &&
    error.detail === RELAY_NOT_CONNECTED_DETAIL
  );
}

/** Why a failed read failed. */
export function sourceIssueOf(error: unknown): SourceIssue {
  if (error instanceof RunnerRelayError) {
    if (error.code === RUNNER_NEEDS_LOCAL) return { kind: "not-carried" };
    if (error.runner?.reason === EGRESS_OFF_REFUSAL) {
      return { kind: "withheld", message: error.runner.message ?? null };
    }
  }
  const { cause, requestId } = explainRelayFailure(error, "");
  return {
    kind: "failed",
    cause: cause ?? null,
    requestId: requestId ?? null,
    quotes: !isRelayNotConnected(error),
  };
}

/** Whether an issue's reason quotes words from outside this page (module doc). */
export function issueQuotes(issue: SourceIssue): boolean {
  return issue.kind === "failed" && issue.quotes;
}

/**
 * Whether two failed reads failed for the same reason — so two reads of one
 * runner that fail alike (the dominant case: the runner is not connected)
 * are said once. Request ids are deliberately not compared: each read is its
 * own request.
 */
export function sameIssue(a: SourceIssue, b: SourceIssue): boolean {
  switch (a.kind) {
    case "no-runner":
      return b.kind === "no-runner" && a.reason === b.reason;
    case "not-carried":
      return b.kind === "not-carried";
    case "withheld":
      return b.kind === "withheld" && a.message === b.message;
    case "failed":
      return b.kind === "failed" && a.cause === b.cause;
  }
}

/**
 * Why no runner can be asked, from the runner target the page holds — or
 * `null` when the target names a runner.
 *
 * An unavailable target can carry its refuser's own sentence (`message`),
 * which is the more specific answer and the operator's — but it can name the
 * runner the operator picked. With `quoteMessage: false` (presenting) the
 * target's fixed phrase for its reason is given instead: the same reason, in
 * words that name no machine.
 */
export function noRunnerReason(
  target: RunnerTarget,
  { quoteMessage = true }: { quoteMessage?: boolean } = {}
): string | null {
  switch (target.kind) {
    case "runner":
      return null;
    case "pending":
      return "the runner list has not answered yet";
    case "default_local":
      return "no runner is paired with this account, so there is no device to reach over the relay";
    case "unavailable":
      if (quoteMessage && target.message) return target.message;
      switch (target.reason) {
        case "list_unavailable":
          return "the runner list could not be loaded";
        case "resolver_unavailable":
          return "no runner is chosen and coord's device resolver did not answer";
        case "no_eligible_runner":
          return "none of your runners is available right now";
      }
  }
}

/** The runner's build, as this page read it from the runner's `/health`. */
export type BuildReading =
  | {
      readonly state: "known";
      readonly buildId: string | null;
      readonly gitSha: string | null;
    }
  | { readonly state: "unknown"; readonly reason: string };

/** The build, in words: `build <id>`, `commit <sha>`, or why it is unknown. */
export function buildLabel(build: BuildReading): string {
  if (build.state === "unknown") {
    return `a build this page could not read (${build.reason})`;
  }
  if (build.buildId) return `build ${build.buildId}`;
  if (build.gitSha) return `commit ${build.gitSha}`;
  return "a build that names no id";
}

/**
 * Why a read has no answer, as a STATUS WORD from a fixed vocabulary — what
 * a presentation shows in place of a reason whose sentence it must withhold
 * (D3.3: a redaction descriptor's status is never free text). A quoting
 * reason (module doc) renders through `RedactedText` with this word as its
 * descriptor's status.
 */
export function issueStatusWord(issue: SourceIssue): string {
  switch (issue.kind) {
    case "no-runner":
      return "no runner read";
    case "not-carried":
      return "not carried by the relay";
    case "withheld":
      return "withheld by the runner";
    case "failed":
      return "read failed";
  }
}

/** The status word for an app id the page refused to send. */
export const INVALID_APP_ID_STATUS = "not a valid app id";

/** `s` ending in exactly one full stop. */
function sentence(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** `s` with its first letter capitalised. */
function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Why `route` has no answer, in one or two sentences. It does NOT start with
 * the word UNKNOWN: the panel renders that as a badge beside it, so a reader
 * (and a UI Bridge text snapshot) reads "UNKNOWN" then the reason once.
 */
export function sourceIssueText(
  issue: SourceIssue,
  route: RunnerRoute,
  build: BuildReading
): string {
  const subject = route.subject;
  switch (issue.kind) {
    case "no-runner":
      return sentence(`Nothing was asked for ${subject}: ${issue.reason}`);
    case "withheld":
      return sentence(
        `The runner withheld ${subject}: ${
          issue.message ?? "this project's setting for that flow is off"
        }`
      );
    case "failed":
      return sentence(
        `${capitalised(subject)} could not be read: ${
          issue.cause ?? "the request failed and named no cause"
        }`
      );
    case "not-carried":
      switch (route.carriage) {
        case "dashboard":
          return `This runner's relay does not carry ${subject}, so it answered HTTP 403. It is running ${buildLabel(build)}, which predates the relay entries this page reads; a runner rebuilt from a newer build serves them.`;
        case "never":
          return `No runner's relay carries ${subject} yet, so this runner (${buildLabel(build)}) answered HTTP 403.`;
        case "always":
          return `This runner (${buildLabel(build)}) refused ${subject} over the relay with HTTP 403.`;
      }
  }
}
