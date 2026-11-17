"use client";

/**
 * "Remove from this tenant…" — the per-row button, the confirm dialog, and the
 * acknowledgements.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3. Calls `unbindFleetDevices` (through `useUnbindFleetDevices`) with
 * every device row the roster groups under the machine; coord removes THIS
 * tenant's binding of each and nothing else (D1, D3). Every rule about what the
 * dialog says and what an answer means is in `./removeMachineFromTenant.ts`.
 *
 * ## Why the state lives at the section, not in the row
 *
 * A removal ends in a roster re-read, and that re-read can drop the row (the
 * removal worked) or fail (the whole list turns UNKNOWN). Either unmounts the
 * row — so a dialog or an acknowledgement owned by the row would vanish with
 * the very answer it exists to show. `useRemoveMachineFromTenant` therefore
 * lives in `FleetRolesSection`, the dialog renders from a SNAPSHOT of the
 * machine taken when it opened, and each machine's last outcome is kept by its
 * machine key: shown in its row while the row exists, and in a section-level
 * list (`DetachedRemovalAcks`) when it does not.
 *
 * ## The confirm cannot be synthesised
 *
 * The confirm is a `DestructiveButton`, so a synthetic click (the UI Bridge
 * included) cannot fire the removal. The button's UI Bridge registration
 * declares its action `destructive` and its handler only OPENS the dialog.
 *
 * Rendered by its caller inside `OperatorOnly` + `CoordAdminOnly`, so neither
 * the controls nor their UI Bridge registration exist in presentation mode.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import {
  BackendErrorMessage,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import type { DispatchRolesRead, RoleMachine } from "./fleetDispatchRoles";
import {
  LAST_CI_HOST_TEXT,
  MAYBE_LAST_CI_HOST_TEXT,
  MAY_HAVE_APPLIED_TEXT,
  POINTER_UNREPORTED_TEXT,
  STILL_LISTED_HOME_TENANT_TEXT,
  STILL_LISTED_LAG_TEXT,
  unsentRowsListedText,
  STILL_LISTED_TEXT,
  STILL_LISTED_VIA_POINTER_TEXT,
  WORKSTATION_TEXT,
  combineSummaries,
  creditEarlierAttempt,
  mergeRefusalOver,
  notActedOnIds,
  possiblyAppliedIds,
  summarizeRows,
  confirmPhraseFor,
  isLastCiHost,
  listingText,
  livenessText,
  removalEffect,
  removalRows,
  unsettledIds,
  type RosterCompleteness,
  type UnbindRefusal,
  type UnbindRowResult,
  type UnbindSummary,
} from "./removeMachineFromTenant";
import {
  useUnbindFleetDevices,
  type UnbindOutcome,
  type UnbindState,
} from "./useUnbindFleetDevices";

const ROW_OUTCOME_TEXT: Record<UnbindRowResult["outcome"], string> = {
  removed: "removed",
  still_listed_via_pointer: STILL_LISTED_VIA_POINTER_TEXT,
  unbound_pointer_unknown: POINTER_UNREPORTED_TEXT,
  already_absent: "already absent",
  failed: "failed",
  refused_auth: "refused (auth)",
  not_attempted: "not attempted (aborted by an auth refusal)",
  answer_lost:
    "may have been removed — coord's answer was lost; reload to check",
  request_lost:
    "may have been removed — the route's answer to that request was lost",
  deadline_not_attempted: "not attempted (time limit) — retry",
  not_sent: "not sent (an earlier batch was refused)",
  not_sent_after_failure:
    "not sent (an earlier batch failed or its answer was lost)",
  request_rejected: "not attempted (the request was rejected)",
  removed_earlier: "absent now (the earlier attempt's answer was lost)",
  earlier_possibly_applied:
    "may have been removed earlier; this attempt failed",
  console_refused: "not attempted (this console refused the request)",
  unreported: "not reported",
};

/** One row's outcome in words, with what only the row itself knows. */
function rowText(r: UnbindRowResult): string {
  if (r.outcome === "request_rejected" && r.status !== null)
    return `not attempted (the request was rejected: HTTP ${r.status})`;
  if (r.outcome === "earlier_possibly_applied")
    return `may have been removed earlier; this attempt ${r.detail ?? "failed"}`;
  if (r.outcome === "answer_lost" && r.detail)
    return `may have been removed — ${r.detail}`;
  if (r.outcome === "unreported" && r.unreadable)
    return "not reported (the answer could not be read)";
  return ROW_OUTCOME_TEXT[r.outcome];
}

/** A refusal in one sentence, for the acknowledgement. */
function refusalSentence(r: UnbindRefusal): string {
  return [
    r.reading.sentence,
    r.partial?.sentence ?? null,
    // An auth abort's own sentence already says what may have happened.
    r.mayHaveApplied && !r.auth ? MAY_HAVE_APPLIED_TEXT : null,
  ]
    .filter((x): x is string => x !== null && x !== "")
    .join(" ");
}

/** One machine's last removal outcome, kept by its machine key. */
export interface RemovalAck {
  name: string;
  /** What the row shows: with an earlier session, "Earlier attempt: … This attempt: …". */
  sentence: string;
  /** This dialog session's own whole-machine sentence. */
  attemptSentence: string;
  /** Every id read `unbound` or `already_absent`. */
  settled: boolean;
  /** This session removed, or may have removed, something. */
  hadEffect: boolean;
  /** Ids this session left possibly removed (answer lost or unreported). */
  possiblyApplied: string[];
}

/** An earlier dialog session's acknowledgement, kept as it was. */
interface EarlierAttempt {
  sentence: string;
  hadEffect: boolean;
  possiblyApplied: string[];
}

/** What the dialog acts on: a snapshot taken when it opened. */
interface RemovalTarget {
  machine: RoleMachine;
  lastCiHost: "yes" | "maybe" | "no";
}

export interface RemoveMachineController {
  target: RemovalTarget | null;
  open: boolean;
  /**
   * The current attempt's answer as the dialog shows it: over a retry, merged
   * with the whole-machine rows before it (`combineSummaries`), so it is the
   * same machine-level summary the acknowledgement carries.
   */
  status: UnbindState;
  busy: boolean;
  /** The request itself is out (not just the roster re-read after it). */
  requesting: boolean;
  /** Ids a retry will send (only those not confirmed removed); `null` = all. */
  retryIds: string[] | null;
  /** The machine key whose dialog is open, or `null`. */
  openKey: string | null;
  /** The previous attempt's sentence, while retrying. */
  previous: string | null;
  acks: Readonly<Record<string, RemovalAck>>;
  /**
   * How many mounted row buttons are showing each machine's acknowledgement.
   * An ack no row shows — collapsed, gone, or the roster unknown — is listed
   * by `DetachedRemovalAcks` instead.
   */
  shownAcks: Readonly<Record<string, number>>;
  showAck: (key: string) => () => void;
  openFor: (
    m: RoleMachine,
    machines: readonly RoleMachine[],
    roster: RosterCompleteness
  ) => void;
  setOpen: (open: boolean) => void;
  confirm: () => Promise<void>;
}

/** The section-level state of every removal (see the module doc). */
export function useRemoveMachineFromTenant(
  /** The roster's re-read, called once each removal settles. */
  refresh: () => Promise<void>,
  /** The roster as the latest read left it (after `refresh` resolves). */
  readNow: () => DispatchRolesRead | null = () => null
): RemoveMachineController {
  const { status, busy, unbind, reset } = useUnbindFleetDevices(refresh);
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const [open, setOpenState] = useState(false);
  // Cleared by every `openFor`, which is the only way the target changes, so
  // a retry can never send another machine's ids.
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  // The machine-level rows so far: a retry's answer is merged over them, so
  // the acknowledgement counts the whole machine, not the retried subset.
  const [soFar, setSoFar] = useState<UnbindSummary | null>(null);
  // The whole-machine summary the CURRENT attempt is merged over (`null` for
  // a first attempt). What the dialog shows is that merge, never the retried
  // subset alone.
  const [base, setBase] = useState<UnbindSummary | null>(null);
  // The ids the current attempt sent — a rowless answer's unknowns.
  const [attemptIds, setAttemptIds] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string | null>(null);
  const [acks, setAcks] = useState<Record<string, RemovalAck>>({});
  // A reopened dialog is a fresh whole-machine attempt; the earlier
  // session's acknowledgement is kept beside it, never overwritten.
  const [earlier, setEarlier] = useState<EarlierAttempt | null>(null);
  const [shownAcks, setShownAcks] = useState<Record<string, number>>({});

  const showAck = useCallback((key: string) => {
    const bump = (d: number) =>
      setShownAcks((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + d }));
    bump(1);
    return () => bump(-1);
  }, []);

  const openFor = useCallback(
    (
      m: RoleMachine,
      machines: readonly RoleMachine[],
      roster: RosterCompleteness
    ) => {
      reset();
      setRetryIds(null);
      setSoFar(null);
      const prior = acks[m.key];
      setEarlier(
        prior !== undefined
          ? {
              sentence: prior.attemptSentence,
              hadEffect: prior.hadEffect,
              possiblyApplied: prior.possiblyApplied,
            }
          : null
      );
      setBase(null);
      setPrevious(null);
      setTarget({ machine: m, lastCiHost: isLastCiHost(machines, m, roster) });
      setOpenState(true);
    },
    [acks, reset]
  );

  // Only the REQUEST holds the dialog open; once its answer is shown, Cancel
  // and Escape work even while the roster re-read is still out.
  const requesting = status.state === "busy";
  const setOpen = useCallback(
    (o: boolean) => {
      if (!o && requesting) return;
      setOpenState(o);
    },
    [requesting]
  );

  const confirm = useCallback(async () => {
    if (target === null) return;
    const m = target.machine;
    const ids = retryIds ?? m.deviceIds;
    if (ids.length === 0) return;
    // A retry is merged over the whole-machine rows so far; its "previous
    // attempt" line is the whole-machine acknowledgement, not a subset.
    const baseNow = retryIds !== null ? soFar : null;
    setBase(baseNow);
    setAttemptIds([...ids]);
    setPrevious(retryIds !== null ? (acks[m.key]?.sentence ?? null) : null);
    const outcome: UnbindOutcome = await unbind(ids);
    if (outcome.state === "in_flight") return;
    // The machine's acknowledgement: this session's whole-machine sentence,
    // beside an earlier session's when there was one.
    const writeAck = (
      attemptSentence: string,
      settled: boolean,
      summary: UnbindSummary | null,
      mayHaveApplied: boolean
    ) => {
      const strip = (x: string) => x.replace(/\.\s*$/, "");
      const sentence =
        earlier !== null
          ? `Earlier attempt: ${strip(earlier.sentence)}. This attempt: ${attemptSentence}`
          : attemptSentence;
      const own =
        summary !== null
          ? possiblyAppliedIds(summary)
          : mayHaveApplied
            ? [...ids]
            : [];
      // What this session did not act on keeps the earlier session's word:
      // an id it may have removed stays "may have been removed".
      const notActed =
        summary !== null
          ? new Set(notActedOnIds(summary).map((id) => id.toLowerCase()))
          : mayHaveApplied
            ? new Set<string>()
            : new Set(ids.map((id) => id.toLowerCase()));
      const carried = (earlier?.possiblyApplied ?? []).filter(
        (id) =>
          notActed.has(id.toLowerCase()) &&
          !own.some((o) => o.toLowerCase() === id.toLowerCase())
      );
      const possiblyApplied = [...own, ...carried];
      // Reached coord for nothing: the earlier session's effect still stands.
      const reachedNothing =
        summary !== null
          ? summary.rows.length > 0 &&
            summary.rows.every((r) => notActed.has(r.deviceId.toLowerCase()))
          : !mayHaveApplied;
      const hadEffect =
        possiblyApplied.length > 0 ||
        (summary !== null &&
          summary.bindingsRemoved + summary.removedEarlier > 0) ||
        (reachedNothing && (earlier?.hadEffect ?? false));
      setAcks((prev) => ({
        ...prev,
        [m.key]: {
          name: m.name,
          sentence,
          attemptSentence,
          settled,
          hadEffect,
          possiblyApplied,
        },
      }));
      return sentence;
    };
    const settle = (s: UnbindSummary, summarySentence: string) => {
      // The re-read still lists the machine while some row says there was no
      // binding (already absent) or did not say whether the home tenant keeps
      // it listed: say so, without asserting a cause coord did not report.
      const read = readNow();
      // Still listed = the re-read's row for this machine still holds one of
      // the ids this removal sent (a row with no device rows holds none).
      // Ids coord explained (its home-tenant pointer keeps them listed) are
      // not an unexplained listing.
      const explained = new Set(
        s.rows
          .filter((r) => r.outcome === "still_listed_via_pointer")
          .map((r) => r.deviceId.toLowerCase())
      );
      const sent = new Set(
        m.deviceIds
          .map((id) => id.toLowerCase())
          .filter((id) => !explained.has(id))
      );
      const listedSent =
        read !== null && read.state === "known"
          ? read.machines
              .filter((x) => x.key === m.key)
              .flatMap((x) => x.deviceIds.map((id) => id.toLowerCase()))
              .filter((id) => sent.has(id))
          : [];
      const stillListedAfter = listedSent.length > 0;
      // The re-read may list this machine under rows the snapshot never held
      // (registered after the dialog opened): those were not sent, so the
      // machine is not gone whatever this removal's counts say.
      const snapshot = new Set(m.deviceIds.map((id) => id.toLowerCase()));
      const listedUnsent =
        read !== null && read.state === "known"
          ? read.machines
              .filter((x) => x.key === m.key)
              .flatMap((x) => x.deviceIds.map((id) => id.toLowerCase()))
              .filter((id) => !snapshot.has(id))
          : [];
      // Every still-listed id coord said it removed (pointer false): only a
      // list that has not caught up explains it — no home-tenant clause.
      const outcomeOf = new Map(
        s.rows.map((r) => [r.deviceId.toLowerCase(), r.outcome])
      );
      const onlyLag = listedSent.every((id) => outcomeOf.get(id) === "removed");
      const nothingRemoved = s.bindingsRemoved === 0 && s.removedEarlier === 0;
      // Still listed after a removal that answered for its ids — removed,
      // already absent, or with the pointer unreported — is worth saying.
      const homeTenant =
        stillListedAfter && s.alreadyAbsent + s.pointerUnknown + s.removed > 0;
      const listedNote = homeTenant
        ? `${summarySentence} ${
            onlyLag ? STILL_LISTED_LAG_TEXT : STILL_LISTED_HOME_TENANT_TEXT
          }`
        : summarySentence;
      const sentence = writeAck(
        listedUnsent.length > 0
          ? `${listedNote} ${unsentRowsListedText(listedUnsent.length)}`
          : listedNote,
        true,
        s,
        false
      );
      // Every id unbound or already absent. A binding the home-tenant
      // pointer keeps listed (or may keep listed), a machine still listed,
      // or an absence nothing confirmed is not a clean removal: a warning.
      if (
        s.stillListed + s.pointerUnknown + s.removedEarlier > 0 ||
        homeTenant ||
        listedUnsent.length > 0
      )
        toast.warning(`${m.name}: ${sentence}`);
      else if (nothingRemoved)
        // Nothing happened this time. After an earlier attempt that removed
        // (or may have removed) something, that is not calm news: a warning.
        (earlier?.hadEffect ? toast.warning : toast.info)(
          `${m.name}: ${sentence}`
        );
      else toast.success(`${m.name}: ${sentence}`);
      setRetryIds(null);
      setOpenState(false);
    };
    // Over a retry, each id's latest outcome across the attempts.
    const credit = (s: UnbindSummary) =>
      earlier !== null ? creditEarlierAttempt(s, earlier.possiblyApplied) : s;
    const whole = (s: UnbindSummary) =>
      credit(baseNow !== null ? combineSummaries(m.deviceIds, baseNow, s) : s);
    if (outcome.state === "answered") {
      const s = whole(outcome.summary);
      setSoFar(s);
      if (s.allSettled) {
        settle(s, s.sentence);
        return;
      }
      writeAck(s.sentence, false, s, false);
      setRetryIds(unsettledIds(s));
      return;
    }
    const refusal = outcome.refusal;
    // Over a retry, every refusal — with rows or without — is merged over
    // the whole-machine rows, so the dialog and the ack keep the totals.
    const merged: UnbindRefusal =
      baseNow !== null
        ? mergeRefusalOver(m.deviceIds, baseNow, refusal, ids)
        : refusal;
    const r: UnbindRefusal =
      merged.partial !== null
        ? { ...merged, partial: credit(merged.partial) }
        : merged;
    if (r.partial !== null) setSoFar(r.partial);
    else if (r.mayHaveApplied)
      // No rows, but it may have acted: remember every id as unreported, so
      // a retry that finds them absent credits this attempt.
      setSoFar(
        whole(
          summarizeRows(
            ids.map((deviceId) => ({
              deviceId,
              outcome: "unreported",
              status: null,
              error: null,
            }))
          )
        )
      );
    // A non-auth error whose rows leave nothing unsettled is settled: there
    // is nothing to retry, so no "Retry the 0…" dialog is left behind.
    if (!r.auth && r.partial !== null && r.partial.allSettled) {
      settle(r.partial, r.partial.sentence);
      return;
    }
    writeAck(refusalSentence(r), false, r.partial, r.mayHaveApplied);
    // With per-id rows, only what is not yet settled is sent again; without
    // them nothing is known, so a retry sends every id of this attempt.
    setRetryIds(r.partial !== null ? unsettledIds(r.partial) : [...ids]);
  }, [acks, earlier, readNow, retryIds, soFar, target, unbind]);

  // Over a retry, show the merge — never the retried subset alone — and
  // credit an earlier session's lost answers the same way the ack does.
  const creditShown = (sum: UnbindSummary) =>
    earlier !== null ? creditEarlierAttempt(sum, earlier.possiblyApplied) : sum;
  const merge = (sum: UnbindSummary) =>
    creditShown(
      base !== null && target !== null
        ? combineSummaries(target.machine.deviceIds, base, sum)
        : sum
    );
  const shown: UnbindState =
    status.state === "answered"
      ? { state: "answered", summary: merge(status.summary) }
      : status.state === "refused"
        ? (() => {
            const merged =
              base !== null && target !== null
                ? mergeRefusalOver(
                    target.machine.deviceIds,
                    base,
                    status.refusal,
                    attemptIds
                  )
                : status.refusal;
            return {
              state: "refused" as const,
              refusal:
                merged.partial !== null
                  ? { ...merged, partial: creditShown(merged.partial) }
                  : merged,
            };
          })()
        : status;

  return {
    target,
    open,
    status: shown,
    busy,
    requesting,
    retryIds,
    openKey: open && target !== null ? target.machine.key : null,
    previous,
    acks,
    shownAcks,
    showAck,
    openFor,
    setOpen,
    confirm,
  };
}

/** The per-id outcome list, with coord's refusal under each failed id. */
function OutcomeRows({ summary }: { summary: UnbindSummary }) {
  return (
    <ul
      className="space-y-1 text-xs"
      data-testid="fleet-roles-remove-outcome-rows"
    >
      {summary.rows.map((r) => (
        <li
          key={r.deviceId}
          className="break-words"
          data-outcome={r.outcome}
          data-testid="fleet-roles-remove-outcome-row"
        >
          <span className="font-mono break-all">{r.deviceId}</span>:{" "}
          {rowText(r)}
          {r.error !== null && (
            <BackendErrorMessage
              error={r.error}
              className="mt-0.5"
              data-testid="fleet-roles-remove-row-error"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The dialog's result block: kept visible while anything is unsettled. */
function ResultBlock({
  status,
  previous,
}: {
  status: UnbindState;
  previous: string | null;
}) {
  const earlier = previous !== null && status.state !== "idle" && (
    <p
      className="text-[11px] break-words text-muted-foreground"
      data-testid="fleet-roles-remove-previous"
    >
      Previous attempt: {previous}
    </p>
  );
  if (status.state === "answered") {
    return (
      <div
        className="space-y-1.5 rounded-md border border-red-500/40 p-2"
        role="alert"
        data-testid="fleet-roles-remove-result"
      >
        {earlier}
        <p className="text-xs font-medium break-words">
          {status.summary.sentence}
        </p>
        <OutcomeRows summary={status.summary} />
      </div>
    );
  }
  if (status.state === "refused") {
    const { refusal } = status;
    return (
      <div
        className="space-y-1.5 rounded-md border border-red-500/40 p-2"
        role="alert"
        data-testid="fleet-roles-remove-result"
        data-refused={refusal.auth ? "auth" : "other"}
      >
        {earlier}
        <BackendErrorMessage
          error={refusal.reading}
          data-testid="fleet-roles-remove-refusal"
        />
        {refusal.mayHaveApplied && !refusal.auth && (
          <p
            className="text-xs break-words text-amber-600 dark:text-amber-500"
            data-testid="fleet-roles-remove-may-have-applied"
          >
            {MAY_HAVE_APPLIED_TEXT}
          </p>
        )}
        {refusal.partial !== null && (
          <>
            <p className="text-xs font-medium break-words">
              {refusal.partial.sentence}
            </p>
            <OutcomeRows summary={refusal.partial} />
          </>
        )}
      </div>
    );
  }
  return null;
}

/** The per-row button, and the row's live acknowledgement. */
export function RemoveMachineButton({
  machine: m,
  machines,
  roster,
  controller,
}: {
  machine: RoleMachine;
  /** Every roster row — to tell whether this is the tenant's last CI host. */
  machines: readonly RoleMachine[];
  roster: RosterCompleteness;
  controller: RemoveMachineController;
}) {
  const { openFor, busy, acks, showAck, openKey } = controller;
  const effect = removalEffect(m.deviceIds.length);
  const hasRows = m.deviceIds.length > 0;
  const open = useCallback(
    () => openFor(m, machines, roster),
    [m, machines, openFor, roster]
  );
  // The UI Bridge may hold the handler from an earlier registration: it reads
  // these refs, so it always acts on the machine as the roster now reads it
  // and on whether a removal is in flight now.
  const openRef = useRef(open);
  const effectRef = useRef(effect);
  const busyRef = useRef(busy);
  const openKeyRef = useRef(openKey);
  useEffect(() => {
    openRef.current = open;
    effectRef.current = effect;
    busyRef.current = busy;
    openKeyRef.current = openKey;
  }, [open, effect, busy, openKey]);
  // While mounted with rows, this row shows the machine's acknowledgement.
  useEffect(
    () => (hasRows ? showAck(m.key) : undefined),
    [hasRows, m.key, showAck]
  );
  const { ref } = useUIElement({
    id: `fleet-roles-remove:${m.key}`,
    label: `Remove ${m.name} from this tenant`,
    type: "button",
    customActions: {
      "remove-from-tenant": {
        id: "remove-from-tenant",
        label: "Remove from this tenant",
        // No count here: a registration can outlive a roster read, so the
        // count is in the handler's result, read when it runs.
        description:
          "Opens the confirmation that removes this tenant's binding of " +
          "every device row the roster lists for this machine; the result " +
          "names how many. Refused while a removal is in flight or any " +
          "removal dialog is open. The " +
          "removal itself needs a real click on the dialog's confirm " +
          "button, which refuses synthetic clicks.",
        // Declared, not re-derived: the action this control leads to removes
        // bindings, so an autonomous walk must exclude it.
        effect: "destructive",
        handler: async () => {
          if (busyRef.current) {
            return { opened: false, reason: "a removal is in flight" };
          }
          // Never replace an open dialog — not even this machine's own,
          // whose retry scope and typed phrase would be reset.
          if (openKeyRef.current !== null) {
            return {
              opened: false,
              reason:
                openKeyRef.current === m.key
                  ? "this machine's removal dialog is already open"
                  : "another machine's removal dialog is open",
            };
          }
          openRef.current();
          return { opened: true, effect: effectRef.current };
        },
      },
    },
  });

  if (!hasRows) return null;
  return (
    <div className="space-y-1" data-testid="fleet-roles-remove">
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={open}
        aria-label={`Remove from this tenant… (${m.name})`}
        title={`Opens a confirmation; ${effect}.`}
        data-testid="fleet-roles-remove-open"
        data-ui-bridge-id={`fleet-roles-remove:${m.key}`}
      >
        Remove from this tenant…
      </Button>
      {/* Always mounted, so a screen reader announces the text swap. */}
      <p
        className="text-[11px] break-words text-muted-foreground"
        role="status"
        data-testid="fleet-roles-remove-ack"
      >
        {acks[m.key]?.sentence ?? ""}
      </p>
    </div>
  );
}

/**
 * Removal outcomes no row is showing — the row is collapsed, the removal
 * dropped it, or the roster read is not known — so an answer is never lost
 * with the row that asked for it.
 */
export function DetachedRemovalAcks({
  controller,
}: {
  controller: RemoveMachineController;
}) {
  const detached = Object.entries(controller.acks).filter(
    ([key]) => (controller.shownAcks[key] ?? 0) === 0
  );
  return (
    <div role="status" data-testid="fleet-roles-remove-acks-detached">
      {detached.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] break-words text-muted-foreground">
          {detached.map(([key, a]) => (
            <li key={key} data-testid="fleet-roles-remove-ack-detached">
              Remove from this tenant — {a.name}: {a.sentence}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The confirm dialog, rendered from the snapshot `openFor` took. */
export function RemoveMachineFromTenantDialog({
  controller,
}: {
  controller: RemoveMachineController;
}) {
  const {
    target,
    open,
    setOpen,
    status,
    busy,
    requesting,
    retryIds,
    previous,
    confirm,
  } = controller;
  if (target === null) return null;
  const m = target.machine;
  const rows = removalRows(m);
  const liveness = livenessText(m);
  const anyListed = rows.some((r) => r.listing?.registrarListing === "listed");
  const effect = removalEffect(m.deviceIds.length);
  const retrying = retryIds !== null;

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={setOpen}
      title={`Remove ${m.name} from this tenant?`}
      description={
        <p className="break-words">
          This {effect}. Coord stops sending this machine this tenant&apos;s
          work. The device itself is not deleted, and other tenants&apos;
          bindings are untouched.
        </p>
      }
      confirmLabel={
        retrying
          ? `Retry the ${retryIds.length} device ${
              retryIds.length === 1 ? "row" : "rows"
            } not confirmed removed`
          : "Remove from this tenant"
      }
      confirmPhrase={confirmPhraseFor(m)}
      busy={busy}
      cancelDisabled={requesting}
      confirmDisabled={retrying && retryIds.length === 0}
      onConfirm={() => void confirm()}
      testId="fleet-roles-remove-dialog"
    >
      <ul className="space-y-1.5 text-xs" data-testid="fleet-roles-remove-rows">
        {rows.map((r) => (
          <li
            key={r.deviceId}
            className="break-words"
            data-testid="fleet-roles-remove-row"
            data-listing={r.listing?.registrarListing ?? "workstation"}
          >
            <span className="font-medium">{m.name}</span>{" "}
            <span className="font-mono break-all">{r.deviceId}</span>
            {r.listing?.scope ? ` · ${r.listing.scope}` : ""} · last seen{" "}
            <span
              title={r.lastSeenAt ? absoluteTime(r.lastSeenAt) : "not reported"}
              data-testid="fleet-roles-remove-row-seen"
            >
              {relativeTime(r.lastSeenAt, { absent: "not reported" })}
            </span>
            {r.listing !== null && (
              <span
                className="block text-muted-foreground"
                data-testid="fleet-roles-remove-row-listing"
              >
                {listingText(r.listing)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {liveness !== null && (
        <p
          className="break-words text-amber-600 dark:text-amber-500"
          data-testid="fleet-roles-remove-liveness"
        >
          {liveness}
        </p>
      )}
      {target.lastCiHost !== "no" && (
        <p
          className="break-words text-amber-600 dark:text-amber-500"
          data-testid="fleet-roles-remove-last-ci-host"
          data-last-ci-host={target.lastCiHost}
        >
          {target.lastCiHost === "yes"
            ? LAST_CI_HOST_TEXT
            : MAYBE_LAST_CI_HOST_TEXT}
        </p>
      )}
      {anyListed && (
        <p
          className="break-words text-amber-600 dark:text-amber-500"
          data-testid="fleet-roles-remove-still-listed"
        >
          {STILL_LISTED_TEXT}
        </p>
      )}
      {!m.hostOnly && (
        <p className="break-words" data-testid="fleet-roles-remove-workstation">
          {WORKSTATION_TEXT}{" "}
          <Link href="/runners" className="underline">
            /runners
          </Link>
          .
        </p>
      )}
      {retrying && retryIds.length > 0 && (
        <p
          className="break-words text-muted-foreground"
          data-testid="fleet-roles-remove-retry-scope"
        >
          A retry sends only the {retryIds.length} device row
          {retryIds.length === 1 ? "" : "s"} not confirmed removed.
        </p>
      )}
      <ResultBlock status={status} previous={previous} />
    </ConfirmDestructiveDialog>
  );
}
