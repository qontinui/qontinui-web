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
    };

/** Why a failed read failed. */
export function sourceIssueOf(error: unknown): SourceIssue {
  if (error instanceof RunnerRelayError) {
    if (error.code === RUNNER_NEEDS_LOCAL) return { kind: "not-carried" };
    if (error.runner?.reason === EGRESS_OFF_REFUSAL) {
      return { kind: "withheld", message: error.runner.message ?? null };
    }
  }
  const { cause, requestId } = explainRelayFailure(error, "");
  return { kind: "failed", cause: cause ?? null, requestId: requestId ?? null };
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
 */
export function noRunnerReason(target: RunnerTarget): string | null {
  switch (target.kind) {
    case "runner":
      return null;
    case "pending":
      return "the runner list has not answered yet";
    case "default_local":
      return "no runner is paired with this account, so there is no device to reach over the relay";
    case "unavailable":
      if (target.message) return target.message;
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
