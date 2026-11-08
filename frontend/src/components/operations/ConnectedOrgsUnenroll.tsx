"use client";

/**
 * "Stop governing" — the un-enroll half of the Connected Organizations card
 * (plan `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped`
 * Phase 8).
 *
 * D6 of that plan put the control on the card's ENROLLED rows: they come from
 * the tenant's own governance rows, and the inverse — Re-enroll on the
 * un-enrolled rows — is on the same card (served policy `ux-priorities`
 * `a-control-belongs-with-what-it-governs`). `ConnectedOrgs.tsx` owns the
 * rows and the shared accounts re-read poll; this module owns what is
 * separable from them:
 *
 * - **Who removed a repo, in words** ({@link unenrolledDetail}). An
 *   un-enrolled row used to print coord's raw principal (`operator:5f0c…`).
 *   Two principals record an un-enrollment BECAUSE GitHub stopped covering the
 *   repo ({@link COVERAGE_UNENROLL_PRINCIPALS}): the
 *   `installation_repositories: removed` webhook, today, and the coverage pass
 *   the same plan adds (Phases 2-3). Those rows say "GitHub App access was
 *   removed". Every other principal is a DECISION, and the row names the kind
 *   of actor; the raw label and reason stay in the row's `title`. The
 *   derivation lives here, unit-tested, not inline in JSX (R8 of
 *   `frontend/docs/console-ui-style-guide.md`).
 * - **Why a coverage row offers no Re-enroll** ({@link coverageReturnHint}).
 *   Coord's restore clears the tombstone before it enrolls, and a repo GitHub
 *   does not list enrolls nothing — so a Re-enroll clicked while GitHub still
 *   excludes the repo would only delete the record a later re-add converges
 *   on. Such a row says what DOES bring the repo back instead.
 * - **The consent dialog** ({@link StopGoverningDialog}), on the console's
 *   confirmation primitive, with a required reason, and the project it names
 *   PINNED as the request's tenant.
 * - **The un-enrollment's state on its row** ({@link useUnenroll}): the dialog,
 *   the request, the read-back and its terminal outcome.
 * - **What a failed or unconfirmed un-enrollment says** — the refusal, the
 *   may-have-landed answer, and the read-back's UNKNOWN — derived from what
 *   coord and the web proxy actually answered ({@link unenrollFailureOf}).
 *
 * Status honesty (served policy `ux-priorities`
 * `a-status-signal-must-observe-the-state-it-names`): the card says coord no
 * longer governs a repo only once a re-read LISTS it as un-enrolled. A `204`
 * is the request having been accepted, not that state, and a read-back that
 * gives up says UNKNOWN — never done.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { BackendErrorMessage, UNKNOWN_AMBER } from "@/components/console";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import { operationsErrorReading } from "@/lib/api/operations/base";
import {
  unenrollRepo,
  UnpinnedTenantError,
  type AccountRepo,
  type UnenrollNotFoundBody,
} from "@/lib/api/operations/prMergeOnboarding";
import { isActiveTenantCoordAdmin } from "@/lib/coord-admin";
import type { BackendErrorReading } from "@/lib/errors/backend-error-message";
import { readActiveTenantId } from "@/services/http-client";

/**
 * The longest reason the web proxy forwards, counted after trimming — the
 * backend's `UNENROLL_REASON_MAX` (`operations/__init__.py`), a transport
 * bound because the reason travels to coord in the query string (the
 * parameter the same plan's Phase 7 adds to coord's door). The input carries
 * it as `maxLength`, so a reason the browser lets through is never refused for
 * its length.
 */
export const UNENROLL_REASON_MAX = 500;

// ---------------------------------------------------------------------------
// Who removed a repo, in words
// ---------------------------------------------------------------------------

/**
 * The two principals that record an un-enrollment because GitHub stopped
 * covering the repo (plan
 * `2026-11-08-coord-keeps-governing-repos-a-narrowed-installation-dropped` D4):
 * `webhook:installation_repositories`, the `installation_repositories:
 * removed` arm's principal (`WEBHOOK_UNENROLL_PRINCIPAL`, in coord's
 * `github_accounts.rs` today), and `reconcile:installation_coverage`, the
 * principal of the periodic coverage pass that plan adds — Phase 2 names it
 * and moves both constants to `pr_merge::unenroll`, Phase 3 is the pass.
 * Matched exactly; every other principal is a decision.
 */
export const COVERAGE_UNENROLL_PRINCIPALS = [
  "webhook:installation_repositories",
  "reconcile:installation_coverage",
] as const;

/** Whether `by` is one of {@link COVERAGE_UNENROLL_PRINCIPALS}, exactly. */
export function isCoveragePrincipal(by: string | null | undefined): boolean {
  return (
    typeof by === "string" &&
    (COVERAGE_UNENROLL_PRINCIPALS as readonly string[]).includes(by)
  );
}

/**
 * The actor classes coord's principal labels carry: `operator:<id>` (the HTTP
 * door under an operator's sign-in), and `agent:<id>` / `device:<id>` /
 * `service:<sub>` (coord's MCP tool and device credentials). A `Map`, so a
 * label such as `constructor:x` cannot reach an object prototype key.
 */
const DECISION_ACTORS = new Map<string, string>([
  ["operator", "an operator"],
  ["agent", "an agent"],
  ["device", "a paired device"],
  ["service", "a service"],
]);

/**
 * Who DECIDED an un-enrollment, in words. The id after a known class is not a
 * name anyone reads, so the row names the class. A label of no known shape is
 * shown as coord recorded it — an invented class would be a claim the card
 * cannot back — and an absent one is said to be absent.
 */
export function decisionActorWords(by: string | null | undefined): string {
  const label = typeof by === "string" ? by.trim() : "";
  if (label === "") return "someone coord did not record";
  const sep = label.indexOf(":");
  const words = sep > 0 ? DECISION_ACTORS.get(label.slice(0, sep)) : undefined;
  return words ?? label;
}

type TombstoneFields = Pick<AccountRepo, "unenrolled_by" | "unenroll_reason">;

/**
 * An un-enrolled row's detail line, given the time already formatted. A
 * coverage row says GitHub's access went (its recorded reason is coord's own
 * vocabulary, `installation_repositories: removed`, so it is not repeated);
 * a decision row says who decided and why.
 */
export function unenrolledDetail(row: TombstoneFields, when: string): string {
  if (isCoveragePrincipal(row.unenrolled_by)) {
    return `removed ${when}: GitHub App access was removed`;
  }
  const reason = row.unenroll_reason?.trim() || "no reason recorded";
  return `removed ${when} by ${decisionActorWords(row.unenrolled_by)}: ${reason}`;
}

/** The wire values behind {@link unenrolledDetail}, for the row's `title`. */
export function unenrolledDetailTitle(row: TombstoneFields): string {
  const by = row.unenrolled_by?.trim() || "principal not recorded";
  const reason = row.unenroll_reason?.trim();
  return reason ? `${by} — ${reason}` : by;
}

/**
 * What a coverage row shows in place of Re-enroll: the step that brings the
 * repo back. From the same plan's Phase 4 on, coord lifts a coverage
 * un-enrollment when GitHub names the repo again, so the operator's lever is
 * on GitHub, not here.
 */
export function coverageReturnHint(repo: string): string {
  return `Add ${repo} to the coord GitHub App's repository access to bring it back — coord re-enrolls it when GitHub covers it again.`;
}

// ---------------------------------------------------------------------------
// The read-back: where coord's accounts read lists a repo
// ---------------------------------------------------------------------------

export type RepoSighting = "enrolled" | "unenrolled" | "absent";

/**
 * Where coord's latest accounts read lists `repo`, compared ASCII-case-
 * insensitively. Coord suppresses an enrollment case-insensitively while a
 * removal deletes the spelling it is given, so a case-variant enrollment can
 * survive its own removal (plan
 * `2026-11-06-coord-repo-unenroll-matches-the-slug-exactly-so-a-case-variant-enrollment-survives-its-own-removal`).
 * Any ENROLLED spelling therefore wins: a variant coord still governs means
 * the removal is not done, whatever else is listed.
 */
export function repoSighting(
  repo: string,
  enrolled: readonly AccountRepo[],
  unenrolled: readonly AccountRepo[]
): RepoSighting {
  const key = repo.toLowerCase();
  const matchesRepo = (r: AccountRepo) => r.repo.toLowerCase() === key;
  if (enrolled.some(matchesRepo)) return "enrolled";
  if (unenrolled.some(matchesRepo)) return "unenrolled";
  return "absent";
}

/** What the read-back last saw when it gave up; `unread` = its last re-read failed. */
export type UnenrollUnconfirmed =
  | Exclude<RepoSighting, "unenrolled">
  | "unread";

/** The terminal state of a read-back that observed the repo un-enrolled. */
export function unenrollDoneText(repo: string): string {
  return `Coord no longer governs ${repo}: it is listed below as un-enrolled. Re-enroll it there to undo.`;
}

/** The terminal state of a read-back that gave up: UNKNOWN, with what it saw. */
export function unenrollUnknownText(
  repo: string,
  seen: UnenrollUnconfirmed,
  waitedSecs: number
): string {
  const head = `Whether coord stopped governing ${repo} is UNKNOWN`;
  const tail = "Refresh the page and check before trying again.";
  switch (seen) {
    case "enrolled":
      return `${head}: after ${waitedSecs} s of re-reading, coord still lists it as enrolled. ${tail}`;
    case "absent":
      return `${head}: coord no longer lists it as enrolled, but does not list it as un-enrolled either, so the un-enrollment was not observed. ${tail}`;
    case "unread":
      return `${head}: coord's repositories could not be re-read, so the card cannot see whether it is still enrolled. ${tail}`;
  }
}

// ---------------------------------------------------------------------------
// A failed un-enrollment, classified
// ---------------------------------------------------------------------------

/** A rejected un-enrollment, as the card renders it. */
export interface UnenrollFailure {
  /** The HTTP status, or `null` when no answer arrived (a network error, an abort). */
  status: number | null;
  /** The machine code the body named (`strategy_admin_required`), if any. */
  code: string | null;
  /** What `BackendErrorMessage` renders: the web's refusal envelope, or coord's own words. */
  reading: BackendErrorReading;
  /** Coord's 404 `tombstoned` flag; `null` = not reported (or not a 404). */
  tombstoned: boolean | null;
  /**
   * Refused in the browser before any request was built: the tenant was blank
   * (`UnpinnedTenantError`), so nothing was sent and no backend answered.
   */
  unpinned: boolean;
  /** Whether the removal may have been applied despite the failure. */
  mayHaveLanded: boolean;
}

/** A machine code (`strategy_admin_required`), as opposed to a sentence. */
const CODE_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The web proxy's own refusals after which the removal may still have been
 * applied: the write timed out after it was sent, or its answer was lost or
 * not JSON. Its other refusal, `coord_unreachable`, means coord never saw the
 * request.
 */
const WEB_MAY_HAVE_LANDED = new Set([
  "coord_write_timeout",
  "answer_lost",
  "answer_not_json",
]);

function mayHaveLanded(
  err: unknown,
  status: number | null,
  reading: BackendErrorReading
): boolean {
  // Refused before any request was built: nothing left the browser.
  if (err instanceof UnpinnedTenantError) return false;
  if (reading.kind === "refusal" && reading.refusal.source === "web_backend") {
    return WEB_MAY_HAVE_LANDED.has(reading.refusal.discriminator ?? "");
  }
  // No answer at all: the request may have reached the backend before the
  // connection went.
  if (status === null) return true;
  // A 4xx refuses before anything is removed. A coord 5xx does not say
  // whether the removal's transaction committed.
  return status >= 500;
}

/** Read a rejected `unenrollRepo` call back into what the card renders. */
export function unenrollFailureOf(err: unknown): UnenrollFailure {
  const status = httpStatusOf(err);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(httpBodyOf(err) ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — the reading below still words it
  }
  const reading = operationsErrorReading(err);
  const code =
    [body.error, body.detail].find(
      (v): v is string => typeof v === "string" && CODE_RE.test(v)
    ) ?? null;
  // Coord's 404 shape, read defensively: a field of any other type is "not
  // reported", never `false`.
  const notFound: Partial<Record<keyof UnenrollNotFoundBody, unknown>> =
    status === 404 ? body : {};
  const tombstoned =
    typeof notFound.tombstoned === "boolean" ? notFound.tombstoned : null;
  return {
    status,
    code,
    reading,
    tombstoned,
    unpinned: err instanceof UnpinnedTenantError,
    mayHaveLanded: mayHaveLanded(err, status, reading),
  };
}

/**
 * The sentence a failure adds to coord's or the web's own words: what a 404
 * did and did not record, what the known refusals ask of the operator, and
 * that a may-have-landed failure is being re-read. `null` when there is
 * nothing to add.
 */
export function unenrollFailureDetail(
  f: UnenrollFailure,
  repo: string
): string | null {
  if (f.unpinned) return "No project was selected, so nothing was sent.";
  if (f.status === 404) {
    const recorded =
      f.tombstoned === true
        ? `Coord recorded an un-enrollment of ${repo} for this project anyway, so it is not re-enrolled automatically; Re-enroll on this card lifts it.`
        : f.tombstoned === false
          ? "Coord recorded nothing."
          : "Whether coord recorded an un-enrollment was not reported.";
    return `Coord found no enrollment of ${repo} in this project to remove. ${recorded}`;
  }
  switch (f.code) {
    case "strategy_admin_required":
      return "Coord requires the administrator role in the selected project to stop governing a repository.";
    case "not_coord_tenant_admin":
      return "You are not an administrator of the selected project.";
    case "reason_required":
      return "A reason is required.";
    case "reason_too_long":
      return `The reason is longer than ${UNENROLL_REASON_MAX} characters.`;
    case "invalid_repo":
      return `${repo} is not an owner/name repository.`;
    default:
      break;
  }
  return f.mayHaveLanded
    ? `The un-enrollment may have been applied anyway, so the card re-reads ${repo} to find out.`
    : null;
}

/**
 * One failure, rendered: the status, the backend's words, and the detail. A
 * refusal made in the browser (`unpinned`) has no backend words, only its
 * sentence: its error message names internals the operator cannot act on.
 */
export function UnenrollFailureText({
  failure,
  repo,
}: {
  failure: UnenrollFailure;
  repo: string;
}) {
  const detail = unenrollFailureDetail(failure, repo);
  return (
    <>
      {failure.status !== null && `${failure.status} — `}
      {!failure.unpinned && <BackendErrorMessage error={failure.reading} />}
      {detail !== null && (
        <span
          className="block"
          data-testid="unenroll-failure-detail"
          data-ui-bridge-id="operations.connected-org-unenroll-failure-detail"
          data-refusal-code={failure.code ?? undefined}
        >
          {detail}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The un-enrollment's outcome on its account row
// ---------------------------------------------------------------------------

/**
 * An un-enrollment's progress, kept per account row: the request in flight,
 * the read-back running (after a `204`, or after a failure that may have
 * landed), and the three terminal states.
 */
export type UnenrollOutcome =
  | { kind: "sending"; repo: string }
  | { kind: "reading-back"; repo: string; failure: UnenrollFailure | null }
  | { kind: "done"; repo: string }
  | {
      kind: "unknown";
      repo: string;
      seen: UnenrollUnconfirmed;
      waitedSecs: number;
      failure: UnenrollFailure | null;
    }
  | { kind: "refused"; repo: string; failure: UnenrollFailure };

/** Whether `o` is still in flight — every action on its account waits for it. */
export function unenrollInFlight(
  o: UnenrollOutcome | null
): o is Extract<UnenrollOutcome, { kind: "sending" | "reading-back" }> {
  return o !== null && (o.kind === "sending" || o.kind === "reading-back");
}

/**
 * The account row's accounts re-read poll, which its enroll, restore and
 * un-enroll share (`ConnectedOrgs.tsx` `useAccountsPoll`): one at a time, so
 * starting one clears the last.
 */
export interface AccountsPoll {
  /**
   * Re-read the accounts on a timer until `clear()` or the cap. `immediate`
   * reads once at the start too; at the cap `onGiveUp` runs, told whether the
   * poll's last read failed (the list on screen is then older than that read).
   */
  start: (options: {
    immediate: boolean;
    onGiveUp: (lastReadFailed: boolean) => void;
  }) => void;
  clear: () => void;
  /** The poll's whole budget, in seconds — what an UNKNOWN says it waited. */
  budgetSecs: number;
}

/** An account row's un-enrollment, as {@link useUnenroll} hands it to the row. */
export interface UnenrollState {
  /** The last un-enrollment on this account: in flight or terminal. */
  outcome: UnenrollOutcome | null;
  /** The repo whose un-enrollment is in flight (the request, then its read-back). */
  unenrolling: string | null;
  /** The enrolled repo whose consent dialog is open. */
  dialogRepo: string | null;
  openDialog: (repo: string) => void;
  closeDialog: () => void;
  /** The dialog's consent: send the DELETE pinned to `tenantId`, then read back. */
  confirm: (repo: string, reason: string, tenantId: string) => Promise<void>;
  /** Forget a terminal outcome: another action on the account is starting. */
  clearOutcome: () => void;
}

/**
 * The state of one account row's un-enrollments.
 *
 * The dialog closes on confirm, and the row that started it leaves the
 * enrolled list, so the outcome lives here, on the account. The read-back
 * says done only once a re-read LISTS the repo as un-enrolled — the state the
 * outcome names, where the `204` only says the request was accepted. When the
 * poll gives up first the outcome is UNKNOWN, with what the reads last saw;
 * the sighting is checked before the give-up, so a read that lands in the same
 * render as the cap still counts. A refusal is re-read once, because a 404 can
 * still record an un-enrollment.
 */
export function useUnenroll({
  enrolled,
  unenrolled,
  otherBusy,
  poll,
  rereadOnce,
  onStart,
}: {
  enrolled: readonly AccountRepo[];
  unenrolled: readonly AccountRepo[];
  /** Another action on this account (an enroll, a restore) is in flight. */
  otherBusy: boolean;
  poll: AccountsPoll;
  /** One accounts re-read, which rejects when it fails. */
  rereadOnce: () => Promise<void>;
  /** Called as an un-enrollment starts, so the row clears its other messages. */
  onStart: () => void;
}): UnenrollState {
  const [outcome, setOutcome] = useState<UnenrollOutcome | null>(null);
  const [dialogRepo, setDialogRepo] = useState<string | null>(null);
  // Set when the read-back reached its cap; the effect below turns it into
  // UNKNOWN — unless the same render's read shows the repo un-enrolled.
  const [gaveUp, setGaveUp] = useState<{ lastReadFailed: boolean } | null>(
    null
  );
  // Synchronous re-entry guard: two confirms inside one render would both see
  // a stale "nothing in flight" and send two DELETEs.
  const guardRef = useRef(false);
  const unenrolling = unenrollInFlight(outcome) ? outcome.repo : null;
  const { start, clear, budgetSecs } = poll;

  const sighting =
    outcome?.kind === "reading-back"
      ? repoSighting(outcome.repo, enrolled, unenrolled)
      : null;
  useEffect(() => {
    if (outcome?.kind !== "reading-back" || sighting === null) return;
    if (sighting === "unenrolled") {
      clear();
      guardRef.current = false;
      setGaveUp(null);
      setOutcome({ kind: "done", repo: outcome.repo });
      return;
    }
    if (gaveUp !== null) {
      guardRef.current = false;
      setGaveUp(null);
      setOutcome({
        kind: "unknown",
        repo: outcome.repo,
        seen: gaveUp.lastReadFailed ? "unread" : sighting,
        waitedSecs: budgetSecs,
        failure: outcome.failure,
      });
    }
  }, [outcome, sighting, gaveUp, clear, budgetSecs]);

  // Coord commits the removal before it answers, so the read-back starts with
  // an immediate read rather than a tick later.
  const readBack = useCallback(
    () =>
      start({
        immediate: true,
        onGiveUp: (lastReadFailed) => setGaveUp({ lastReadFailed }),
      }),
    [start]
  );

  const confirm = useCallback(
    async (repo: string, reason: string, tenantId: string) => {
      if (guardRef.current || otherBusy || unenrolling !== null) return;
      guardRef.current = true;
      setDialogRepo(null);
      clear();
      setGaveUp(null);
      onStart();
      setOutcome({ kind: "sending", repo });
      try {
        await unenrollRepo(repo, reason, tenantId);
      } catch (err) {
        const failure = unenrollFailureOf(err);
        if (failure.mayHaveLanded) {
          // A timed-out or lost answer may still have removed the repo: the
          // read-back decides, exactly as after a 204.
          setOutcome({ kind: "reading-back", repo, failure });
          readBack();
          return;
        }
        guardRef.current = false;
        setOutcome({ kind: "refused", repo, failure });
        // A refusal coord answered can still change what it lists — a 404 may
        // record an un-enrollment — so re-read once. A failed re-read leaves
        // the list, and this refusal, on screen. One refused before anything
        // was sent changed nothing to re-read.
        if (!failure.unpinned) rereadOnce().catch(() => undefined);
        return;
      }
      setOutcome({ kind: "reading-back", repo, failure: null });
      readBack();
    },
    [otherBusy, unenrolling, clear, onStart, readBack, rereadOnce]
  );

  const openDialog = useCallback((repo: string) => setDialogRepo(repo), []);
  const closeDialog = useCallback(() => setDialogRepo(null), []);
  const clearOutcome = useCallback(() => setOutcome(null), []);

  return {
    outcome,
    unenrolling,
    dialogRepo,
    openDialog,
    closeDialog,
    confirm,
    clearOutcome,
  };
}

export function UnenrollOutcomeLine({
  outcome,
  "data-testid": testId,
}: {
  outcome: UnenrollOutcome;
  "data-testid": string;
}) {
  const stamp = {
    "data-testid": testId,
    "data-ui-bridge-id": "operations.connected-org-unenroll-outcome",
    "data-outcome": outcome.kind,
  };
  switch (outcome.kind) {
    case "sending":
      return (
        <p
          className="mt-1 pl-6 text-xs text-muted-foreground flex items-center gap-1"
          role="status"
          {...stamp}
        >
          <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />
          Stopping governance of {outcome.repo}…
        </p>
      );
    case "reading-back":
      return (
        <p
          className="mt-1 pl-6 text-xs text-muted-foreground"
          role="status"
          {...stamp}
        >
          <Loader2
            className="mr-1 inline h-3 w-3 animate-spin align-[-2px]"
            aria-hidden
          />
          {outcome.failure === null ? (
            `Coord accepted the un-enrollment of ${outcome.repo} — waiting for it to list ${outcome.repo} as un-enrolled…`
          ) : (
            <>
              The answer to the un-enrollment of {outcome.repo} did not confirm
              it (
              <UnenrollFailureText
                failure={outcome.failure}
                repo={outcome.repo}
              />
              ) — checking whether it was applied…
            </>
          )}
        </p>
      );
    case "done":
      return (
        <p
          className="mt-1 pl-6 text-xs text-muted-foreground"
          role="status"
          {...stamp}
        >
          {unenrollDoneText(outcome.repo)}
        </p>
      );
    case "unknown":
      return (
        <p
          className={`mt-1 ml-6 rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
          role="alert"
          {...stamp}
        >
          {unenrollUnknownText(outcome.repo, outcome.seen, outcome.waitedSecs)}
          {outcome.failure !== null && (
            <span className="block">
              <UnenrollFailureText
                failure={outcome.failure}
                repo={outcome.repo}
              />
            </span>
          )}
        </p>
      );
    case "refused":
      return (
        <p
          className="mt-1 pl-6 text-xs text-destructive"
          role="alert"
          {...stamp}
        >
          Coord did not stop governing {outcome.repo}:{" "}
          <UnenrollFailureText failure={outcome.failure} repo={outcome.repo} />
        </p>
      );
  }
}

// ---------------------------------------------------------------------------
// Who sees the controls
// ---------------------------------------------------------------------------

/**
 * Renders `children` only for an administrator OF THE ACTIVE TENANT — the
 * question the un-enroll and restore routes' gate asks
 * (`require_coord_tenant_admin_target` / `require_coord_tenant_admin`). Not
 * `CoordAdminOnly`, which answers "admin of ANY tenant" and would offer a
 * control that 403s (`lib/coord-admin.ts` names the trap). A rendering
 * boundary, not authorization: the backend decides.
 */
export function ActiveTenantAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { tenants, activeTenantId } = useTenant();
  if (!isActiveTenantCoordAdmin({ user, tenants, activeTenantId })) return null;
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// The consent dialog
// ---------------------------------------------------------------------------

export interface StopGoverningDialogProps {
  /** The repository the dialog is open for. Mount the dialog only while open. */
  repo: string;
  onCancel: () => void;
  /**
   * Called with the TRIMMED reason, never blank, and the tenant the dialog
   * named, which the request pins. Never called while no project is selected.
   */
  onConfirm: (repo: string, reason: string, tenantId: string) => void;
}

/**
 * The consent dialog for one un-enrollment. It says what stops, how it comes
 * back and what does not come back, names the project it applies to, and
 * requires a reason — the one place coord records WHY a repo stopped being
 * governed. The confirm is the primitive's `DestructiveButton`, so a synthetic
 * (UI Bridge or scripted) click is refused: a live un-enrollment is the
 * operator's own act.
 *
 * THE PROJECT IT NAMES IS THE PROJECT IT WRITES. The project is the sidebar's
 * selection as this page holds it (`useTenant`), and the confirm hands it on,
 * so the request pins it (`unenrollRepo`). Every other request on the page
 * carries the selection the BROWSER stores, which another tab can move, and
 * this page does not follow: when the two disagree at confirm, the page's
 * lists may no longer be this project's, so nothing is sent and the dialog
 * says to reload. The named project matters because the write lands there:
 * the 2026-11-08 cleanup this plan starts from ran with no selection and
 * wrote its un-enrollments into the operator's home tenant instead (plan,
 * Why).
 *
 * So there is no write without a project. While none is selected (the
 * project list has not loaded, or failed to, or the stored selection is
 * blank), the dialog says so and keeps its confirm disabled: a request with
 * no project named would take the browser's selection at send time, and on a
 * replay after a token refresh whichever selection the browser holds by then.
 * Blank is `unenrollRepo`'s own test, so the dialog never hands it a tenant it
 * refuses.
 *
 * Mount it only while open (it reads the tenant context), keyed on `repo`, so
 * every opening starts with an empty reason.
 */
export function StopGoverningDialog({
  repo,
  onCancel,
  onConfirm,
}: StopGoverningDialogProps) {
  const { tenants, activeTenantId } = useTenant();
  // The project the dialog names and the write pins; null while none is
  // selected, a blank selection included.
  const named = activeTenantId?.trim() ? activeTenantId : null;
  const project = tenants.find((t) => t.id === named);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [projectMoved, setProjectMoved] = useState(false);
  const trimmed = reason.trim();
  const missing = trimmed === "";

  return (
    <ConfirmDestructiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Stop governing ${repo}?`}
      description={
        <>
          <p className="break-words">
            Coord stops landing this repository&apos;s pull requests and stops
            watching it.
          </p>
          <p className="mt-2 break-words">
            It stays off until you re-enroll it on this card. Re-adding it to
            the GitHub App does not bring it back.
          </p>
        </>
      }
      confirmLabel="Stop governing"
      confirmDisabled={missing || named === null}
      onConfirm={() => {
        if (missing || named === null) return;
        const stored = readActiveTenantId() || null;
        if (stored !== named) {
          setProjectMoved(true);
          return;
        }
        onConfirm(repo, trimmed, named);
      }}
      testId="stop-governing-dialog"
      extra={
        <div className="space-y-1.5">
          <Label htmlFor="stop-governing-reason">
            Reason{" "}
            <span className="text-xs text-muted-foreground">(required)</span>
          </Label>
          <Textarea
            id="stop-governing-reason"
            rows={2}
            value={reason}
            maxLength={UNENROLL_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-required="true"
            aria-invalid={touched && missing ? true : undefined}
            aria-describedby="stop-governing-reason-hint"
            placeholder="e.g. archived — the service moved to another repository"
            data-testid="stop-governing-reason"
            data-ui-bridge-id="operations.connected-org-stop-governing-reason"
          />
          {touched && missing && (
            <p
              className="form-error"
              data-testid="stop-governing-reason-error"
              data-ui-bridge-id="operations.connected-org-stop-governing-reason-error"
            >
              A reason is required.
            </p>
          )}
          <p
            id="stop-governing-reason-hint"
            className="text-[11px] text-muted-foreground break-words"
          >
            Recorded with the un-enrollment, so whoever later finds {repo}{" "}
            un-enrolled can see why. At most {UNENROLL_REASON_MAX} characters.
          </p>
          {named === null && (
            <p
              className={`rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
              role="alert"
              data-testid="stop-governing-dialog-no-project"
              data-ui-bridge-id="operations.connected-org-stop-governing-no-project"
            >
              No project is selected in this browser yet, so there is no project
              to record this un-enrollment in, and nothing can be sent. The
              confirm unlocks once the project list loads; if it does not,
              reload the page.
            </p>
          )}
          {projectMoved && (
            <p
              className={`rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
              role="alert"
              data-testid="stop-governing-dialog-project-moved"
              data-ui-bridge-id="operations.connected-org-stop-governing-project-moved"
            >
              The project selected in this browser changed in another tab, so
              this page may no longer show the project named above. Nothing was
              sent. Reload the page, then try again.
            </p>
          )}
        </div>
      }
    >
      <p className="break-words">
        Repository: <span className="font-mono break-all">{repo}</span>
      </p>
      <p className="break-words">
        Project:{" "}
        <span
          className="font-medium break-words"
          data-testid="stop-governing-dialog-project"
        >
          {project
            ? project.name
            : named === null
              ? "none selected"
              : "the project selected in the sidebar"}
        </span>
        {named !== null && " — the un-enrollment is recorded there."}
      </p>
      <p className="break-words">
        Its per-repository merge settings are deleted: re-enrolled, it starts
        again from freshly detected defaults.
      </p>
    </ConfirmDestructiveDialog>
  );
}
